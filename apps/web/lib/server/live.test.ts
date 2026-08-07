import { appendAndProject, questionDrafts, teamDrafts } from '@kwiz/db'
import { seedGame, type SeededGame } from '@kwiz/db/test-support'
import type { AudienceView, GameEvent, MainScreenView, PlayerView } from '@kwiz/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { runAction } from './actions'
import { runJoin } from './join'
import { publishState, stateFrame, type CommandContext } from './service'
import { createTestRuntime, recordingSubscriber, type TestRuntime } from './test-runtime'

/**
 * build-order slice 3's must-test list: **reconnect, cross-game isolation with two live games, submit
 * idempotency**. Range requests are in `attachments.test.ts`.
 *
 * Everything here goes through the real action layer against a real database, because that is where
 * the interesting failures live — a guard that works in `decide` and is never reached, a push that
 * goes to the wrong game, a draft that survives a submission.
 */

let runtime: TestRuntime
let one: SeededGame
let two: SeededGame

/** Teams through the log, so `GameState` has them — direct rows would be invisible to the reducer. */
function seedLiveGame(target: TestRuntime): SeededGame {
  const seed = seedGame(target.database, { withTeams: false })
  const events: GameEvent[] = [
    {
      type: 'TEAM_ADDED',
      payload: {
        teamId: seed.teamA,
        name: 'Quizzly Bears',
        colour: '#EF4444',
        position: 0,
      },
    },
    {
      type: 'TEAM_ADDED',
      payload: {
        teamId: seed.teamB,
        name: 'Norfolk & Chance',
        colour: '#22D3EE',
        position: 1,
      },
    },
    { type: 'GAME_STARTED', payload: {} },
  ]
  appendAndProject(target.database, seed.gameId, events)
  return seed
}

const context = (gameId: string, now = 10_000): CommandContext => ({
  runtime,
  gameId,
  now,
})

function act(
  gameId: string,
  path: string,
  body: unknown = {},
  deviceToken: string | null = null,
  now = 10_000,
) {
  return runAction({
    runtime,
    gameId,
    segments: path.split('/'),
    body,
    deviceToken,
    now,
  })
}

beforeEach(() => {
  runtime = createTestRuntime()
  one = seedLiveGame(runtime)
  two = seedLiveGame(runtime)
})

// ─── the projection registry (PRD 1 §6.4) ───

describe('the live projection', () => {
  it('loads by replay on first access and answers only for the game asked for', () => {
    expect(runtime.registry.loaded()).toEqual([])

    const state = runtime.registry.get(one.gameId)
    expect(state?.teams.size).toBe(2)
    expect(runtime.registry.loaded()).toEqual([one.gameId])
    expect(runtime.registry.get('no-such-game')).toBeUndefined()
  })

  it('catches up incrementally, and a restart recovers the same state', () => {
    const before = runtime.registry.get(one.gameId)?.seq
    act(one.gameId, `questions/${one.questionId}/open`)
    const after = runtime.registry.get(one.gameId)
    expect(after?.seq).toBe((before ?? 0) + 1)

    // D4: eviction is a restart in miniature — the state comes back from the log alone.
    runtime.registry.evict(one.gameId)
    expect(runtime.registry.loaded()).not.toContain(one.gameId)
    const reloaded = runtime.registry.get(one.gameId)
    expect(reloaded?.seq).toBe(after?.seq)
    expect(reloaded?.questions.get(one.questionId)?.state).toBe('OPEN')
  })

  it('evicts a finished game only once nobody is watching', () => {
    runtime.registry.get(one.gameId)
    expect(runtime.registry.evictIfFinished(one.gameId, false)).toBe(false)

    act(one.gameId, 'finish')
    // Its stream stays open (§3.4), so a watching screen keeps the leaderboard.
    expect(runtime.registry.evictIfFinished(one.gameId, true)).toBe(false)
    expect(runtime.registry.evictIfFinished(one.gameId, false)).toBe(true)
    expect(runtime.registry.loaded()).not.toContain(one.gameId)
  })
})

// ─── cross-game isolation (D21) ───

describe('two live games', () => {
  it('keeps events, scores and pushes to the game they belong to', () => {
    act(one.gameId, `questions/${one.questionId}/open`)
    act(one.gameId, 'adjust-score', { teamId: one.teamA, delta: 25, announced: true })

    const first = runtime.registry.get(one.gameId)
    const second = runtime.registry.get(two.gameId)
    expect(first?.teams.get(one.teamA)?.score).toBe(25)
    expect(second?.teams.get(two.teamA)?.score).toBe(0)
    expect(second?.questions.get(two.questionId)?.state).toBe('PENDING')
    // `seq` is per-game and both are mid-single-digits, which is exactly why a `Last-Event-ID` may
    // never be compared across games.
    expect(first?.seq).not.toBe(second?.seq)
  })

  it('pushes each game only to its own subscribers', () => {
    const screenOne = recordingSubscriber(one.gameId, 'MAIN_SCREEN')
    const screenTwo = recordingSubscriber(two.gameId, 'MAIN_SCREEN')
    runtime.transport.subscribe(screenOne)
    runtime.transport.subscribe(screenTwo)

    act(one.gameId, 'scoreboard', { shown: true })

    expect(screenOne.frames).toHaveLength(1)
    expect(screenTwo.frames).toHaveLength(0)
    const frame = screenOne.frames[0]
    expect(frame?.kind).toBe('state')
    // The id carries the game, so the client's next `Last-Event-ID` cannot be misread.
    if (frame?.kind === 'state') expect(frame.id.startsWith(`${one.gameId}:`)).toBe(true)
  })

  it('refuses a device token from the other game', () => {
    const joined = runJoin(runtime, {
      code: gameCode(one),
      teamId: one.teamA,
      now: 1_000,
    })
    expect(joined.ok).toBe(true)
    if (!joined.ok || !joined.data) throw new Error('expected a join')

    const wrongGame = act(
      two.gameId,
      'submit',
      { gameQuestionId: two.questionId, text: 'paris' },
      joined.data.deviceToken,
    )
    expect(wrongGame).toMatchObject({ ok: false, error: 'UNKNOWN_DEVICE' })
  })
})

// ─── reconnect (protocol §3.2) ───

describe('reconnect', () => {
  it('sends the current view, and nothing when the client is already at that seq', () => {
    const state = runtime.registry.get(one.gameId)
    if (!state) throw new Error('expected a state')

    const screen = recordingSubscriber(one.gameId, 'MAIN_SCREEN')
    const frame = stateFrame(context(one.gameId), state, screen)
    expect(frame.id).toBe(`${one.gameId}:${state.seq}`)

    // The whole of reconnection: whole, idempotent views mean there is no replay to get wrong, and
    // `Last-Event-ID` only ever decides whether the first frame can be skipped.
    const view = mainScreen(frame.data)
    expect(view.teams.map((team) => team.name)).toEqual([
      'Quizzly Bears',
      'Norfolk & Chance',
    ])
  })

  it('re-sends a view whose seq has not changed, because a draft can change it (D45)', () => {
    const joined = runJoin(runtime, {
      code: gameCode(one),
      teamId: one.teamA,
      now: 1_000,
    })
    if (!joined.ok || !joined.data) throw new Error('expected a join')
    act(one.gameId, `questions/${one.questionId}/open`)

    const phone = recordingSubscriber(one.gameId, 'PLAYER', one.teamA)
    runtime.transport.subscribe(phone)
    const seqBefore = runtime.registry.get(one.gameId)?.seq

    act(
      one.gameId,
      'draft',
      { gameQuestionId: one.questionId, text: 'par' },
      joined.data.deviceToken,
    )

    // No event was appended — a draft is not a game fact (protocol §4.8) — yet the team's phones must
    // see the text, so the push cannot be suppressed as "already current".
    expect(runtime.registry.get(one.gameId)?.seq).toBe(seqBefore)
    expect(phone.frames).toHaveLength(1)
    const frame = phone.frames[0]
    if (frame?.kind !== 'state') throw new Error('expected a state frame')
    const view = player(frame.data)
    expect(view.stage.kind === 'QUESTION' && view.stage.myAnswer?.text).toBe('par')
  })
})

// ─── joining (D20) ───

describe('join', () => {
  it('issues a device token and refuses the team once it is at the cap', () => {
    runtime = createTestRuntime({ KWIZ_MAX_DEVICES_PER_TEAM: '1' })
    one = seedLiveGame(runtime)

    const first = runJoin(runtime, { code: gameCode(one), teamId: one.teamA, now: 1_000 })
    if (!first.ok || !first.data) throw new Error('expected a join')
    expect(first.data.deviceToken).toHaveLength(43)

    const second = runJoin(runtime, {
      code: gameCode(one),
      teamId: one.teamA,
      now: 2_000,
    })
    expect(second).toMatchObject({ ok: false, error: 'TEAM_FULL' })
    // The other teams travel with the refusal so the UI can offer them rather than dead-ending.
    expect(second).toMatchObject({ detail: { otherTeams: [{ id: one.teamB }] } })
  })

  it('refuses an unknown code', () => {
    expect(
      runJoin(runtime, { code: 'ZZZZZZ', teamId: one.teamA, now: 1_000 }),
    ).toMatchObject({
      ok: false,
      error: 'GAME_NOT_FOUND',
    })
  })
})

// ─── submission finality through the whole stack (D43, D8) ───

describe('submit', () => {
  let token: string

  beforeEach(() => {
    const joined = runJoin(runtime, {
      code: gameCode(one),
      teamId: one.teamA,
      now: 1_000,
    })
    if (!joined.ok || !joined.data) throw new Error('expected a join')
    token = joined.data.deviceToken
    act(one.gameId, `questions/${one.questionId}/open`)
  })

  it('is idempotent for the same value and rejects a different one', () => {
    const first = act(
      one.gameId,
      'submit',
      { gameQuestionId: one.questionId, text: 'Radiohead' },
      token,
    )
    expect(first.ok).toBe(true)

    const retry = act(
      one.gameId,
      'submit',
      { gameQuestionId: one.questionId, text: 'radiohead ' },
      token,
    )
    expect(retry.ok).toBe(true)

    const conflict = act(
      one.gameId,
      'submit',
      { gameQuestionId: one.questionId, text: 'Radio Head' },
      token,
    )
    expect(conflict).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED' })
    expect(conflict.ok ? null : conflict.detail).toMatchObject({
      answer: { text: 'Radiohead' },
    })

    // Exactly one event, whatever the phones did.
    const submissions = runtime.registry
      .get(one.gameId)
      ?.questions.get(one.questionId)?.answers
    expect(submissions?.size).toBe(1)
  })

  it('deletes the draft it supersedes, so lock cannot commit a stale one', () => {
    act(one.gameId, 'draft', { gameQuestionId: one.questionId, text: 'par' }, token)
    expect(teamDrafts(runtime.database, one.gameId, one.teamA).size).toBe(1)

    act(one.gameId, 'submit', { gameQuestionId: one.questionId, text: 'paris' }, token)
    expect(teamDrafts(runtime.database, one.gameId, one.teamA).size).toBe(0)
    expect(questionDrafts(runtime.database, one.questionId)).toEqual([])
  })

  it('refuses a draft once the team has submitted', () => {
    act(one.gameId, 'submit', { gameQuestionId: one.questionId, text: 'paris' }, token)
    expect(
      act(one.gameId, 'draft', { gameQuestionId: one.questionId, text: 'lyon' }, token),
    ).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED' })
  })

  it('needs the device header, and rejects a token nobody issued', () => {
    expect(
      act(one.gameId, 'submit', { gameQuestionId: one.questionId, text: 'paris' }, null),
    ).toMatchObject({ ok: false, error: 'UNKNOWN_DEVICE' })
    expect(
      act(
        one.gameId,
        'submit',
        { gameQuestionId: one.questionId, text: 'paris' },
        'made-up',
      ),
    ).toMatchObject({ ok: false, error: 'UNKNOWN_DEVICE' })
  })

  it('commits an outstanding draft at lock, marked as unconfirmed (D26)', () => {
    const second = runJoin(runtime, {
      code: gameCode(one),
      teamId: one.teamB,
      now: 1_500,
    })
    if (!second.ok || !second.data) throw new Error('expected a join')

    act(one.gameId, 'submit', { gameQuestionId: one.questionId, text: 'paris' }, token)
    act(
      one.gameId,
      'draft',
      { gameQuestionId: one.questionId, text: 'lyon' },
      second.data.deviceToken,
    )

    act(one.gameId, `questions/${one.questionId}/lock`)

    const answers = runtime.registry
      .get(one.gameId)
      ?.questions.get(one.questionId)?.answers
    expect(answers?.get(one.teamA)?.isDraft).toBe(false)
    expect(answers?.get(one.teamB)?.isDraft).toBe(true)
    expect(answers?.get(one.teamB)?.text).toBe('lyon')

    // Spent, so they go. A draft outliving its lock would keep appearing as a team's in-progress
    // text on a closed question — including an empty one, which is never committed because an
    // empty draft is not an answer.
    expect(questionDrafts(runtime.database, one.questionId)).toEqual([])
  })
})

// ─── the action boundary ───

describe('the action boundary', () => {
  it('rejects an unknown path and a malformed body without touching the game', () => {
    expect(act(one.gameId, 'not-an-action')).toMatchObject({
      ok: false,
      error: 'VALIDATION_ERROR',
    })
    expect(act(one.gameId, 'scoreboard', { shown: 'yes' })).toMatchObject({
      ok: false,
      error: 'VALIDATION_ERROR',
    })
    expect(act('no-such-game', 'finish')).toMatchObject({
      ok: false,
      error: 'GAME_NOT_FOUND',
    })

    // Nothing was appended by any of the three.
    expect(runtime.registry.get(one.gameId)?.scoreboardShown).toBe(false)
  })

  it('distinguishes break/end from break', () => {
    act(one.gameId, 'break', { durationMs: 60_000 }, null, 20_000)
    expect(runtime.registry.get(one.gameId)?.break?.resumesAt).toBe(80_000)
    act(one.gameId, 'break/end')
    expect(runtime.registry.get(one.gameId)?.break).toBeNull()
  })

  it('publishes a notice only to the audiences that should hear it', () => {
    const screen = recordingSubscriber(one.gameId, 'MAIN_SCREEN')
    const control = recordingSubscriber(one.gameId, 'MASTER_CONTROL')
    const phone = recordingSubscriber(one.gameId, 'PLAYER', one.teamA)
    for (const subscriber of [screen, control, phone])
      runtime.transport.subscribe(subscriber)

    act(one.gameId, 'adjust-score', { teamId: one.teamA, delta: 5, announced: true })

    const notices = (frames: typeof screen.frames) =>
      frames.filter((f) => f.kind === 'notice')
    expect(notices(screen.frames)).toHaveLength(1)
    expect(notices(control.frames)).toHaveLength(1)
    // A phone gets the new score in its `state` frame, but not the banner (D25 is a room moment).
    expect(notices(phone.frames)).toHaveLength(0)
    expect(phone.frames.filter((f) => f.kind === 'state')).toHaveLength(1)
  })

  it('publishes on demand without a command, which is what a fresh connection needs', () => {
    const screen = recordingSubscriber(one.gameId, 'MAIN_SCREEN')
    runtime.transport.subscribe(screen)
    publishState(context(one.gameId))
    expect(screen.frames).toHaveLength(1)
  })
})

/**
 * Narrowing a pushed view by **shape, not by assertion**: `attention` only exists on master control
 * and `team` only on a player, so the union discriminates itself (protocol §5).
 */
function mainScreen(view: AudienceView): MainScreenView {
  if ('attention' in view || 'team' in view)
    throw new Error('expected a main-screen view')
  return view
}

function player(view: AudienceView): PlayerView {
  if (!('team' in view)) throw new Error('expected a player view')
  return view
}

/** The code the seeded game was given; `seedGame` generates one per game (data model §6.1). */
function gameCode(seed: SeededGame): string {
  const state = runtime.registry.get(seed.gameId)
  if (!state) throw new Error('expected a game')
  return state.code
}
