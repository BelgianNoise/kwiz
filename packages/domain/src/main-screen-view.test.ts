import { describe, expect, it } from 'vitest'

import { decide } from './decide'
import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState, QuestionContent } from './state'
import { toMainScreenView } from './views'

/**
 * The fields PRD 4 needs beyond what slice 2 built against protocol §5.2.
 *
 * Same story as slice 5's `master-control-view.test.ts`: the first shape was faithful to the spec
 * and internally consistent, and it still could not answer questions the surface has to ask — what
 * quiz is this, how much of the timer is left *as a proportion*, did that team move up, is this
 * standing final, and who won the finale with how long on the clock. Every one of these is a clause
 * in PRD 4 that nothing could have rendered.
 */

const A = 'team-a'
const B = 'team-b'
const C = 'team-c'
const Q1 = 'q1'
const Q2 = 'q2'
const FIN = 'q-finale'

const question = (
  over: Partial<QuestionContent> & Pick<QuestionContent, 'id' | 'position'>,
): QuestionContent => ({
  roundId: 'r1',
  categoryId: null,
  prompt: `prompt ${over.id}`,
  answerMethod: 'FREE_TEXT',
  points: 10,
  timerMs: null,
  masterNotes: null,
  config: {},
  acceptedAnswers: ['yes'],
  options: [],
  keywords: [],
  media: [],
  ...over,
})

const content: GameContent = {
  gameId: 'g',
  quizName: 'Pub Quiz #4',
  code: '7KMQ2X',
  defaultPlayerLocale: 'en',
  rounds: [
    {
      id: 'r1',
      position: 0,
      type: 'QUESTION_SET',
      title: 'Music',
      defaultPoints: 10,
      defaultTimerMs: null,
      config: {},
      categories: [],
      questions: [question({ id: Q1, position: 0 }), question({ id: Q2, position: 1 })],
    },
    {
      id: 'r2',
      position: 1,
      type: 'DSMTW_FINALE',
      title: 'Finale',
      defaultPoints: 0,
      defaultTimerMs: null,
      config: { secondsPerPoint: 1, penaltySeconds: 20 },
      categories: [],
      questions: [
        question({
          id: FIN,
          roundId: 'r2',
          position: 0,
          answerMethod: 'KEYWORDS',
          acceptedAnswers: [],
          keywords: [{ id: 'kw', position: 0, text: 'thriller', wordLengths: [8] }],
        }),
      ],
    },
  ],
}

const NOW = 100_000

const run = (events: GameEvent[]): GameState =>
  reduce(
    content,
    events.map((event, i): LoggedEvent => ({
      seq: i + 1,
      event,
      createdAt: 1_000 + i * 100,
    })),
  )

const team = (teamId: string, name: string, position: number): GameEvent => ({
  type: 'TEAM_ADDED',
  payload: { teamId, name, colour: '#EF4444', position },
})

const LIVE: GameEvent[] = [
  team(A, 'Quizzly Bears', 0),
  team(B, 'The Quizinart', 1),
  team(C, 'Norfolk & Chance', 2),
  { type: 'GAME_STARTED', payload: {} },
  { type: 'ROUND_OPENED', payload: { gameRoundId: 'r1' } },
]

/** A signed adjustment, which is the cheapest way to move a team's rank in a fixture. */
const adjust = (teamId: string, delta: number, adjustmentId: string): GameEvent => ({
  type: 'SCORE_ADJUSTED',
  payload: { adjustmentId, teamId, delta, announced: true },
})

describe('the main screen view', () => {
  it('names the quiz, for §4’s title', () => {
    expect(toMainScreenView(run(LIVE), NOW).quizName).toBe('Pub Quiz #4')
  })
})

/**
 * §7 — *"a depleting ring plus the number"*. `deadlineAt` alone gives a client the number and not
 * the proportion, so the ring had nothing to draw an arc from.
 */
describe('the timer’s span', () => {
  it('carries the full duration alongside the deadline', () => {
    const state = run([
      ...LIVE,
      {
        type: 'QUESTION_OPENED',
        payload: { gameQuestionId: Q1, deadlineAt: 1_500 + 30_000 },
      },
    ])

    const stage = toMainScreenView(state, NOW).stage
    expect(stage.kind).toBe('QUESTION')
    if (stage.kind !== 'QUESTION') return
    // `QUESTION_OPENED` is the sixth event, so `openedAt` is 1_500.
    expect(stage.question.timer?.durationMs).toBe(30_000)
  })

  /**
   * Pauses extend `deadlineAt` (D35) and deliberately do **not** grow the span: a ring whose total
   * grew mid-question would visibly jump *backwards* on every deny loop.
   */
  it('does not grow the span when adjudication pauses the clock', () => {
    const buzzer = question({ id: Q1, position: 0, answerMethod: 'BUZZER' })
    const events: GameEvent[] = [
      ...LIVE,
      {
        type: 'QUESTION_OPENED',
        payload: { gameQuestionId: Q1, deadlineAt: 1_500 + 30_000 },
      },
      {
        type: 'BUZZ_RECEIVED',
        payload: {
          buzzId: 'b1',
          gameQuestionId: Q1,
          teamId: A,
          offsetMs: 4_210,
          receivedAt: 1_500 + 4_210,
        },
      },
    ]
    const state = reduce(
      { ...content, rounds: [{ ...content.rounds[0]!, questions: [buzzer] }] },
      events.map((event, i): LoggedEvent => ({
        seq: i + 1,
        event,
        createdAt: 1_000 + i * 100,
      })),
    )

    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'QUESTION') throw new Error(`expected QUESTION, got ${stage.kind}`)
    expect(stage.question.timer?.durationMs).toBe(30_000)
    expect(stage.question.timer?.pausedAt).not.toBeNull()
    // The deadline *has* moved, which is the pause itself.
    expect(stage.question.timer?.deadlineAt).toBeGreaterThan(1_500 + 30_000)
  })
})

/**
 * §10 — *"rank movement since the last leaderboard"*. The cheapest drama available, and the thing
 * that makes a leaderboard a moment rather than a table. It needs a baseline, and a baseline is not
 * derivable from scores: two teams can swap twice between showings and end where they started.
 */
describe('rank movement', () => {
  const shown: GameEvent = { type: 'SCOREBOARD_TOGGLED', payload: { shown: true } }
  const hidden: GameEvent = { type: 'SCOREBOARD_TOGGLED', payload: { shown: false } }

  it('is null on the first leaderboard of a game, because nothing has moved yet', () => {
    const state = run([...LIVE, adjust(A, 10, 'adj-1'), shown])
    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'LEADERBOARD') throw new Error(`got ${stage.kind}`)
    expect(stage.standings.every((s) => s.movement === null)).toBe(true)
  })

  it('measures the second leaderboard against the first', () => {
    const state = run([
      ...LIVE,
      adjust(A, 30, 'adj-1'),
      adjust(B, 20, 'adj-2'),
      adjust(C, 10, 'adj-3'),
      // First showing: A 1st, B 2nd, C 3rd.
      shown,
      hidden,
      // C overtakes both.
      adjust(C, 40, 'adj-4'),
      shown,
    ])

    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'LEADERBOARD') throw new Error(`got ${stage.kind}`)
    const movement = new Map(stage.standings.map((s) => [s.teamId, s.movement]))
    expect(movement.get(C)).toBe(2)
    expect(movement.get(A)).toBe(-1)
    expect(movement.get(B)).toBe(-1)
  })

  it('reports a held place as 0, which is a different statement from “unknown”', () => {
    const state = run([...LIVE, adjust(A, 10, 'adj-1'), shown, hidden, shown])
    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'LEADERBOARD') throw new Error(`got ${stage.kind}`)
    expect(stage.standings.every((s) => s.movement === 0)).toBe(true)
  })

  /** PRD 2 §11.2 allows a team in at any status, and it was in no previous leaderboard. */
  it('is null for a team that joined after the last leaderboard', () => {
    const state = run([
      ...LIVE,
      adjust(A, 10, 'adj-1'),
      shown,
      hidden,
      team('late', 'Late Arrivals', 3),
      shown,
    ])

    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'LEADERBOARD') throw new Error(`got ${stage.kind}`)
    expect(stage.standings.find((s) => s.teamId === 'late')?.movement).toBeNull()
    expect(stage.standings.find((s) => s.teamId === A)?.movement).toBe(0)
  })

  /** Hiding the board is not a showing, so it must not become the next baseline. */
  it('does not take a baseline from hiding the board', () => {
    const state = run([
      ...LIVE,
      adjust(A, 30, 'adj-1'),
      // First showing: A 1st on 30, B and C tied 2nd on 0.
      shown,
      // Scores move *while* it is up, then it comes down and goes back up. The arrows must still be
      // measured against the first showing, not against the moment it was dismissed.
      adjust(B, 50, 'adj-2'),
      hidden,
      shown,
    ])

    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'LEADERBOARD') throw new Error(`got ${stage.kind}`)
    // 2nd (shared) → 1st. If hiding had taken a baseline this would read 0, because B was already
    // top by the time the board came down.
    expect(stage.standings.find((s) => s.teamId === B)?.movement).toBe(1)
  })
})

/**
 * §3's table puts a leaderboard **between rounds**, and §4's waiting screen is for before the game
 * starts. `ROUND_CLOSED` leaves `currentRoundId` pointing at the closed round on purpose — PRD 3's
 * timeline is still about it — so without tracking the close, the room saw that round's *intro*
 * again in the gap before the next one opened.
 */
describe('the gap between rounds', () => {
  it('shows a leaderboard headed AFTER ROUND n, not the finished round’s intro', () => {
    const state = run([...LIVE, { type: 'ROUND_CLOSED', payload: { gameRoundId: 'r1' } }])

    const stage = toMainScreenView(state, NOW).stage
    expect(stage.kind).toBe('LEADERBOARD')
    if (stage.kind !== 'LEADERBOARD') return
    expect(stage.afterRoundNumber).toBe(1)
  })

  it('reads CURRENT SCORES when the master pushes the board mid-round', () => {
    const state = run([...LIVE, { type: 'SCOREBOARD_TOGGLED', payload: { shown: true } }])
    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'LEADERBOARD') throw new Error(`got ${stage.kind}`)
    // `null` is what makes the heading `CURRENT SCORES`: the round is not over.
    expect(stage.afterRoundNumber).toBeNull()
  })

  it('goes back to the round intro when the round is reopened', () => {
    const state = run([
      ...LIVE,
      { type: 'ROUND_CLOSED', payload: { gameRoundId: 'r1' } },
      { type: 'ROUND_OPENED', payload: { gameRoundId: 'r1' } },
    ])
    expect(toMainScreenView(state, NOW).stage.kind).toBe('ROUND_INTRO')
  })
})

/**
 * §10's `scores provisional · 3 answers still being checked`.
 *
 * protocol §5.2 originally forbade any pending-validation information on this view. Resolved by
 * scope: a *standing* may say it is provisional, because the room must not be told a standing is
 * final when it isn't; a *question* still carries nothing about the master's queue.
 */
describe('provisional standings', () => {
  const unjudged: GameEvent[] = [
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
    {
      type: 'ANSWER_SUBMITTED',
      payload: {
        gameQuestionId: Q1,
        teamId: A,
        text: 'maybe',
        fromDraft: false,
        enteredByMaster: false,
      },
    },
  ]

  it('is null when there is nothing outstanding', () => {
    const state = run([...LIVE, { type: 'ROUND_CLOSED', payload: { gameRoundId: 'r1' } }])
    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'LEADERBOARD') throw new Error(`got ${stage.kind}`)
    // Not `{ questions: 0 }` — a zero renders as "0 answers still being checked" the first time
    // someone forgets to guard it, ten metres from a paying audience.
    expect(stage.provisional).toBeNull()
  })

  it('counts the questions with an unjudged answer', () => {
    const state = run([
      ...LIVE,
      ...unjudged,
      { type: 'ROUND_CLOSED', payload: { gameRoundId: 'r1' } },
    ])
    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'LEADERBOARD') throw new Error(`got ${stage.kind}`)
    expect(stage.provisional).toEqual({ questions: 1 })
  })

  it('says nothing about the master’s queue on the question stage itself', () => {
    const state = run([...LIVE, ...unjudged])
    const stage = toMainScreenView(state, NOW).stage
    if (stage.kind !== 'QUESTION') throw new Error(`got ${stage.kind}`)
    expect(JSON.stringify(stage.question)).not.toContain('provisional')
    expect(JSON.stringify(stage.question)).not.toContain('pending')
  })
})

/**
 * §10.2 / D51 — after a finale the ranking came from **survival**, so the screen carries two tabs:
 * `RESULT` decides the game, `POINTS` keeps the pre-finale totals, which are still interesting
 * because the team that scored highest is often not the one that won.
 */
describe('the FINISHED screen after a finale', () => {
  const finale: GameEvent[] = [
    team(A, 'Quizzly Bears', 0),
    team(B, 'The Quizinart', 1),
    team(C, 'Norfolk & Chance', 2),
    team('late', 'Late Arrivals', 3),
    { type: 'GAME_STARTED', payload: {} },
    adjust(A, 138, 'adj-a'),
    adjust(B, 155, 'adj-b'),
    adjust(C, 104, 'adj-c'),
    adjust('late', 12, 'adj-late'),
    { type: 'ROUND_OPENED', payload: { gameRoundId: 'r2' } },
    { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 1, penaltySeconds: 20 } },
    { type: 'FINALISTS_SET', payload: { teamIds: [A, B, C] } },
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: FIN } },
    { type: 'TEAM_ELIMINATED', payload: { teamId: A, at: 50_000 } },
    { type: 'TEAM_ELIMINATED', payload: { teamId: B, at: 60_000 } },
    { type: 'FINALE_ENDED', payload: { ranking: [[C], [B], [A]] } },
    { type: 'GAME_FINISHED', payload: {} },
  ]

  it('ranks by survival, with the survivor’s remaining seconds and the others’ instants', () => {
    const stage = toMainScreenView(run(finale), NOW).stage
    expect(stage.kind).toBe('FINISHED')
    if (stage.kind !== 'FINISHED') return

    const rows = stage.finale ?? []
    expect(rows.slice(0, 3).map((row) => row.teamId)).toEqual([C, B, A])
    // "won with 41 seconds left" is the story, so the survivor carries a bank and no instant.
    expect(rows[0]?.secondsLeft).not.toBeNull()
    expect(rows[0]?.eliminatedAt).toBeNull()
    // The eliminated carry the instant and no bank — theirs ran out, which is why they are here.
    expect(rows[1]?.eliminatedAt).toBe(60_000)
    expect(rows[1]?.secondsLeft).toBeNull()
  })

  it('lists non-finalists below, numbered on and labelled as not eliminated', () => {
    const stage = toMainScreenView(run(finale), NOW).stage
    if (stage.kind !== 'FINISHED') throw new Error(`got ${stage.kind}`)

    const rows = stage.finale ?? []
    expect(rows.map((row) => row.finalist)).toEqual([true, true, true, false])
    const last = rows.at(-1)
    expect(last?.teamId).toBe('late')
    // §10.2's `5 ● Late Arrivals` — continuing the numbering, and with nothing that reads as an
    // elimination.
    expect(last?.rank).toBe(4)
    expect(last?.eliminatedAt).toBeNull()
  })

  it('shares a rank when two finalists go out together, and skips the next number (D51, D32)', () => {
    const together = run([
      ...finale.slice(0, -2),
      { type: 'FINALE_ENDED', payload: { ranking: [[C], [A, B]] } },
      { type: 'GAME_FINISHED', payload: {} },
    ])

    const stage = toMainScreenView(together, NOW).stage
    if (stage.kind !== 'FINISHED') throw new Error(`got ${stage.kind}`)
    const rows = stage.finale ?? []
    expect(rows.slice(0, 3).map((row) => row.rank)).toEqual([1, 2, 2])
    // Two teams occupied rank 2, so the non-finalist is 4th, not 3rd.
    expect(rows[3]?.rank).toBe(4)
  })

  it('defaults to RESULT, and keeps the points standings for the other tab', () => {
    const stage = toMainScreenView(run(finale), NOW).stage
    if (stage.kind !== 'FINISHED') throw new Error(`got ${stage.kind}`)
    expect(stage.tab).toBe('RESULT')
    // The team that scored highest is not the one that won — which is exactly why §10.2 keeps it.
    expect(stage.standings[0]?.teamId).toBe(B)
  })

  it('follows the master to the POINTS tab', () => {
    const stage = toMainScreenView(
      run([...finale, { type: 'FINISHED_TAB_SET', payload: { tab: 'POINTS' } }]),
      NOW,
    ).stage
    if (stage.kind !== 'FINISHED') throw new Error(`got ${stage.kind}`)
    expect(stage.tab).toBe('POINTS')
  })

  it('offers no tabs at all when the game ended without a finale', () => {
    const stage = toMainScreenView(
      run([...LIVE, { type: 'GAME_FINISHED', payload: {} }]),
      NOW,
    ).stage
    if (stage.kind !== 'FINISHED') throw new Error(`got ${stage.kind}`)
    // `null` rather than an empty array: there is no finale to show a tab *for*.
    expect(stage.finale).toBeNull()
  })
})

/** The tabs are switched from control, and only exist once there is a `FINISHED` screen. */
describe('SET_FINISHED_TAB', () => {
  it('is refused while the game is still running', () => {
    const result = decide(run(LIVE), { type: 'SET_FINISHED_TAB', tab: 'POINTS' }, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    // Not `GAME_NOT_LIVE`: `LIVE` is precisely the status this one rejects.
    expect(result.error).toBe('GAME_NOT_FINISHED')
  })

  it('is a no-op when the room is already on that tab', () => {
    const finished = run([...LIVE, { type: 'GAME_FINISHED', payload: {} }])
    const result = decide(finished, { type: 'SET_FINISHED_TAB', tab: 'RESULT' }, NOW)
    expect(result).toMatchObject({ ok: true, events: [] })
  })

  it('appends the switch once the game has ended', () => {
    const finished = run([...LIVE, { type: 'GAME_FINISHED', payload: {} }])
    const result = decide(finished, { type: 'SET_FINISHED_TAB', tab: 'POINTS' }, NOW)
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: 'FINISHED_TAB_SET', payload: { tab: 'POINTS' } }],
    })
  })
})

/**
 * §6.1 — the equaliser's one job is to prove sound is *playing*, and its going still is the
 * "no sound" signal. The `<audio>` element is on the master's desk (PRD 3 §5.1), so this is the one
 * main-screen field that is not a function of `GameState`.
 */
describe('the audio playback mirror', () => {
  const withAudio: GameContent = {
    ...content,
    rounds: [
      {
        ...content.rounds[0]!,
        questions: [
          question({
            id: Q1,
            position: 0,
            media: [
              {
                id: 'media-1',
                kind: 'AUDIO',
                position: 0,
                durationMs: 134_000,
                showOnPlayerDevices: false,
                originalName: 'kid-a.mp3',
                sizeBytes: 2_100_000,
              },
            ],
          }),
        ],
      },
    ],
  }

  const events: GameEvent[] = [
    ...LIVE,
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
  ]

  const state = (): GameState =>
    reduce(
      withAudio,
      events.map((event, i): LoggedEvent => ({
        seq: i + 1,
        event,
        createdAt: 1_000 + i * 100,
      })),
    )

  it('is absent before the master has touched the transport', () => {
    const stage = toMainScreenView(state(), NOW).stage
    if (stage.kind !== 'QUESTION') throw new Error(`got ${stage.kind}`)
    expect(stage.question).not.toHaveProperty('playback')
  })

  it('carries the instant and the offset, never a position to be ticked', () => {
    const stage = toMainScreenView(state(), NOW, '', {
      mediaId: 'media-1',
      playingSince: 90_000,
      positionMs: 4_000,
    }).stage
    if (stage.kind !== 'QUESTION') throw new Error(`got ${stage.kind}`)
    expect(stage.question.playback).toEqual({
      mediaId: 'media-1',
      playingSince: 90_000,
      positionMs: 4_000,
    })
  })

  /**
   * A mirror left over from the previous question would animate an equaliser over silence — the
   * exact failure §6.1's stillness is supposed to be a signal for.
   */
  it('is dropped when it belongs to another question’s media', () => {
    const stage = toMainScreenView(state(), NOW, '', {
      mediaId: 'media-from-the-last-round',
      playingSince: 90_000,
      positionMs: 4_000,
    }).stage
    if (stage.kind !== 'QUESTION') throw new Error(`got ${stage.kind}`)
    expect(stage.question).not.toHaveProperty('playback')
  })
})
