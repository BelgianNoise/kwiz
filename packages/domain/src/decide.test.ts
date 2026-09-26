import { describe, expect, it } from 'vitest'

import type { Command } from './commands'
import { decide, eliminationInstant, type Decision } from './decide'
import { currentFinaleTurn, finaleRanking, finaleRemainingSeconds } from './derive'
import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState } from './state'

/**
 * build-order slice 3's must-test list, as far as it is decidable without a server: submission
 * idempotency and the first-write-wins rejection (D43), the buzzer loop's guards (D35), the
 * open-question guard on a break, `DO` clamping (D24), and every finale refusal (D50).
 *
 * The driver below **is** the server loop — decide, append, fold — in six lines and with no mocks.
 * That is the point of keeping the decisions pure: the same function the route handler calls is
 * exercised here against a literal event list.
 */

const A = 'team-a'
const B = 'team-b'
const C = 'team-c'
const FREE_Q = 'q-free'
const MC_Q = 'q-mc'
const BUZZ_Q = 'q-buzz'
const DO_Q = 'q-do'
const FIN_Q = 'fin-q'
const KW = (n: number) => `kw-${n}`

const q = (over: Partial<GameContent['rounds'][0]['questions'][0]>) => ({
  id: 'x',
  roundId: 'r1',
  categoryId: null,
  position: 0,
  prompt: 'P',
  answerMethod: 'FREE_TEXT' as const,
  points: 10,
  timerMs: null,
  masterNotes: null,
  config: {},
  acceptedAnswers: ['paris'],
  options: [],
  keywords: [],
  media: [],
  ...over,
})

const content: GameContent = {
  gameId: 'g',
  quizName: 'Q',
  code: 'KWIZ01',
  defaultPlayerLocale: 'en',
  mainScreenColourScheme: 'BROADCAST',
  mainScreenTypography: 'IMPACT',
  rounds: [
    {
      id: 'r1',
      position: 0,
      type: 'QUESTION_SET',
      title: 'R1',
      defaultPoints: 10,
      defaultTimerMs: 30_000,
      config: {},
      categories: [],
      questions: [
        q({ id: FREE_Q }),
        q({
          id: MC_Q,
          position: 1,
          answerMethod: 'MULTIPLE_CHOICE',
          options: [
            { id: 'opt-a', position: 0, text: 'A', isCorrect: true },
            { id: 'opt-b', position: 1, text: 'B', isCorrect: false },
          ],
        }),
        q({ id: BUZZ_Q, position: 2, answerMethod: 'BUZZER', points: 20, timerMs: null }),
        q({
          id: DO_Q,
          position: 3,
          answerMethod: 'DO',
          points: 30,
          config: { scoringMode: 'WINNER_TAKES_ALL', tiePayout: 'SPLIT' },
        }),
      ],
    },
    {
      id: 'r3',
      position: 1,
      type: 'DSMTW_FINALE',
      title: 'Finale',
      defaultPoints: 0,
      defaultTimerMs: null,
      config: { secondsPerPoint: 1, penaltySeconds: 20 },
      categories: [],
      questions: [
        q({
          id: FIN_Q,
          roundId: 'r3',
          answerMethod: 'KEYWORDS',
          keywords: [0, 1, 2].map((n) => ({
            id: KW(n),
            position: n,
            text: `kw ${n}`,
            wordLengths: [2, 1],
          })),
        }),
      ],
    },
  ],
}

/** Decide → append → fold. The same order PRD 1 §6.4 specifies, with the clock passed in. */
function driver(seed: GameEvent[] = []) {
  const log: LoggedEvent[] = seed.map((event, index) => ({
    seq: index + 1,
    event,
    createdAt: 1000 + index,
  }))
  let state = reduce(content, log)

  return {
    get state(): GameState {
      return state
    },
    act(command: Command, now = 10_000): Decision {
      const decision = decide(state, command, now)
      if (decision.ok) {
        for (const event of decision.events) {
          log.push({ seq: log.length + 1, event, createdAt: now })
        }
        state = reduce(content, log)
      }
      return decision
    },
  }
}

const team = (id: string, position: number): GameEvent => ({
  type: 'TEAM_ADDED',
  payload: { teamId: id, name: id, colour: '#EF4444', position },
})

const LIVE: GameEvent[] = [
  team(A, 0),
  team(B, 1),
  team(C, 2),
  { type: 'GAME_STARTED', payload: {} },
  { type: 'ROUND_OPENED', payload: { gameRoundId: 'r1' } },
]

/**
 * Narrowing by throwing rather than by asserting a type: a wrong outcome fails the test *here*, with
 * the decision in the message, instead of somewhere further down as `undefined`.
 */
function refusal(decision: Decision) {
  if (decision.ok) {
    throw new Error(`expected a refusal, got ${JSON.stringify(decision.events)}`)
  }
  return decision
}

function accepted(decision: Decision) {
  if (!decision.ok) throw new Error(`expected acceptance, got ${decision.error}`)
  return decision
}

// ─── joining (D20) ───

describe('join', () => {
  it('refuses a team at the device cap and offers the others', () => {
    const game = driver([
      ...LIVE,
      {
        type: 'DEVICE_JOINED',
        payload: { deviceId: 'd1', teamId: A, deviceToken: 't1' },
      },
    ])

    const denied = refusal(
      game.act({
        type: 'JOIN',
        teamId: A,
        deviceId: 'd2',
        deviceToken: 't2',
        maxDevicesPerTeam: 1,
      }),
    )
    expect(denied.error).toBe('TEAM_FULL')
    // The UI has to be able to offer the alternatives, so they travel with the refusal (D20).
    expect(denied.detail).toEqual({
      otherTeams: [
        { id: B, name: B, colour: '#EF4444', full: false },
        { id: C, name: C, colour: '#EF4444', full: false },
      ],
    })
  })

  it('announces a team once, not once per phone', () => {
    const game = driver(LIVE)

    const first = accepted(
      game.act({
        type: 'JOIN',
        teamId: A,
        deviceId: 'd1',
        deviceToken: 't1',
        maxDevicesPerTeam: 3,
      }),
    )
    expect(first.notices).toEqual([{ kind: 'TEAM_JOINED', teamId: A }])

    const second = accepted(
      game.act({
        type: 'JOIN',
        teamId: A,
        deviceId: 'd2',
        deviceToken: 't2',
        maxDevicesPerTeam: 3,
      }),
    )
    expect(second.notices).toEqual([])
  })

  it('refuses a finished game', () => {
    const game = driver([...LIVE, { type: 'GAME_FINISHED', payload: {} }])
    expect(
      refusal(
        game.act({
          type: 'JOIN',
          teamId: A,
          deviceId: 'd1',
          deviceToken: 't1',
          maxDevicesPerTeam: 3,
        }),
      ).error,
    ).toBe('GAME_NOT_JOINABLE')
  })

  it('refuses a switch into a full team, and is a no-op onto the same team', () => {
    const game = driver([
      ...LIVE,
      {
        type: 'DEVICE_JOINED',
        payload: { deviceId: 'd1', teamId: A, deviceToken: 't1' },
      },
      {
        type: 'DEVICE_JOINED',
        payload: { deviceId: 'd2', teamId: B, deviceToken: 't2' },
      },
    ])

    expect(
      refusal(
        game.act({
          type: 'SWITCH_TEAM',
          deviceId: 'd1',
          toTeamId: B,
          maxDevicesPerTeam: 1,
        }),
      ).error,
    ).toBe('TEAM_FULL')

    expect(
      accepted(
        game.act({
          type: 'SWITCH_TEAM',
          deviceId: 'd1',
          toTeamId: A,
          maxDevicesPerTeam: 3,
        }),
      ).events,
    ).toEqual([])

    expect(
      refusal(
        game.act({
          type: 'SWITCH_TEAM',
          deviceId: 'd9',
          toTeamId: A,
          maxDevicesPerTeam: 3,
        }),
      ).error,
    ).toBe('UNKNOWN_DEVICE')
  })

  // P2 #11 — SWITCH_TEAM had no status guard at all, unlike JOIN just above.
  it('refuses to switch teams on a finished game, mirroring JOIN', () => {
    const game = driver([
      ...LIVE,
      {
        type: 'DEVICE_JOINED',
        payload: { deviceId: 'd1', teamId: A, deviceToken: 't1' },
      },
      { type: 'GAME_FINISHED', payload: {} },
    ])

    expect(
      refusal(
        game.act({
          type: 'SWITCH_TEAM',
          deviceId: 'd1',
          toTeamId: B,
          maxDevicesPerTeam: 3,
        }),
      ).error,
    ).toBe('GAME_NOT_JOINABLE')
  })
})

// ─── submission finality (D43, protocol §7.3) ───

describe('submit', () => {
  const open = (): ReturnType<typeof driver> => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    return game
  }

  it('accepts the first submission', () => {
    const game = open()
    const decision = accepted(
      game.act({
        type: 'SUBMIT_ANSWER',
        gameQuestionId: FREE_Q,
        teamId: A,
        text: 'paris',
      }),
    )
    expect(decision.events).toEqual([
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: FREE_Q,
          teamId: A,
          text: 'paris',
          fromDraft: false,
          enteredByMaster: false,
        },
      },
    ])
  })

  it('is a no-op for the same value — the D8 retry', () => {
    const game = open()
    game.act({ type: 'SUBMIT_ANSWER', gameQuestionId: FREE_Q, teamId: A, text: 'Paris' })

    const retry = accepted(
      game.act({
        type: 'SUBMIT_ANSWER',
        gameQuestionId: FREE_Q,
        teamId: A,
        text: ' paris ',
      }),
    )
    // `ok` with nothing appended: a retry after a lost response must not count as a second
    // submission, and it must not read as an error either.
    expect(retry.events).toEqual([])
  })

  it('rejects a different value and returns the canonical answer (D43)', () => {
    const game = open()
    game.act({
      type: 'SUBMIT_ANSWER',
      gameQuestionId: FREE_Q,
      teamId: A,
      text: 'Radiohead',
    })

    const denied = refusal(
      game.act({
        type: 'SUBMIT_ANSWER',
        gameQuestionId: FREE_Q,
        teamId: A,
        text: 'Radio Head',
      }),
    )
    expect(denied.error).toBe('ALREADY_SUBMITTED')
    // The second device's UI has to be able to say "your team answered: Radiohead" — a player who
    // saw their text vanish with no explanation assumes the app lost it.
    expect(denied.detail).toMatchObject({ answer: { text: 'Radiohead', optionId: null } })
  })

  it('accepts a late submission while the question is still open (D8)', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    expect(game.state.questions.get(FREE_Q)?.deadlineAt).toBe(31_000)

    // Well past the deadline, and the server does not care: only the master locking it stops
    // submissions.
    const late = accepted(
      game.act(
        { type: 'SUBMIT_ANSWER', gameQuestionId: FREE_Q, teamId: A, text: 'paris' },
        99_000,
      ),
    )
    expect(late.events).toHaveLength(1)
  })

  it('rejects once locked, but a retry of an accepted answer still reports ok', () => {
    const game = open()
    game.act({ type: 'SUBMIT_ANSWER', gameQuestionId: FREE_Q, teamId: A, text: 'paris' })
    game.act({ type: 'LOCK_QUESTION', gameQuestionId: FREE_Q, drafts: [] })

    expect(
      refusal(
        game.act({
          type: 'SUBMIT_ANSWER',
          gameQuestionId: FREE_Q,
          teamId: B,
          text: 'lyon',
        }),
      ).error,
    ).toBe('QUESTION_LOCKED')

    // Team A's phone retrying after the lock: their submission landed, so this is not an error.
    expect(
      accepted(
        game.act({
          type: 'SUBMIT_ANSWER',
          gameQuestionId: FREE_Q,
          teamId: A,
          text: 'paris',
        }),
      ).events,
    ).toEqual([])
  })

  it('refuses a question that is not open, and one that takes no typed answer', () => {
    const game = driver(LIVE)
    expect(
      refusal(
        game.act({
          type: 'SUBMIT_ANSWER',
          gameQuestionId: FREE_Q,
          teamId: A,
          text: 'paris',
        }),
      ).error,
    ).toBe('QUESTION_NOT_OPEN')

    game.act({ type: 'OPEN_QUESTION', gameQuestionId: BUZZ_Q }, 1_000)
    expect(
      refusal(
        game.act({
          type: 'SUBMIT_ANSWER',
          gameQuestionId: BUZZ_Q,
          teamId: A,
          text: 'shouted',
        }),
      ).error,
    ).toBe('VALIDATION_ERROR')
  })

  it('refuses an option that belongs to another question', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: MC_Q }, 1_000)
    expect(
      refusal(
        game.act({
          type: 'SUBMIT_ANSWER',
          gameQuestionId: MC_Q,
          teamId: A,
          selectedOptionId: 'opt-elsewhere',
        }),
      ).error,
    ).toBe('VALIDATION_ERROR')
  })

  it('lets the master overwrite a submitted answer (D47)', () => {
    const game = open()
    game.act({ type: 'SUBMIT_ANSWER', gameQuestionId: FREE_Q, teamId: A, text: 'lyon' })

    const decision = accepted(
      game.act({
        type: 'SUBMIT_FOR_TEAM',
        gameQuestionId: FREE_Q,
        teamId: A,
        text: 'paris',
      }),
    )
    expect(decision.events[0]?.payload).toMatchObject({ enteredByMaster: true })
    expect(game.state.teams.get(A)?.score).toBe(10)
  })

  /**
   * `SUBMIT_ANSWER` already refuses `BUZZER`/`DO` — nothing is typed on those, they score by
   * adjudication or by the master's own dedicated verdict. `SUBMIT_FOR_TEAM` had no matching
   * guard, so a request that never goes through the control desk (which offers no proxy input
   * on these question types) could still leave a ghost `PENDING` row with nothing to judge —
   * the same shape ISSUE-1 found, on a question type ISSUE-5's fix does not otherwise reach.
   */
  it('refuses a proxy submission against a question that takes no typed answer', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: BUZZ_Q }, 1_000)

    expect(
      refusal(
        game.act({
          type: 'SUBMIT_FOR_TEAM',
          gameQuestionId: BUZZ_Q,
          teamId: A,
          text: 'da vinci',
        }),
      ).error,
    ).toBe('VALIDATION_ERROR')
    expect(game.state.questions.get(BUZZ_Q)?.answers.has(A)).toBe(false)
  })

  /**
   * A device submitting after the whole game ended is not D8's "phone that woke up late" — that
   * is a bound on *state*, not on *time*, and it was entirely absent before. Without it a device
   * could go on submitting indefinitely once the master had finished or abandoned the game.
   */
  it('refuses a submission once the game is no longer live', () => {
    const game = open()
    accepted(game.act({ type: 'FINISH_GAME' }))
    expect(
      refusal(
        game.act({ type: 'SUBMIT_ANSWER', gameQuestionId: FREE_Q, teamId: A, text: 'x' }),
      ).error,
    ).toBe('GAME_NOT_LIVE')
  })

  /**
   * D47's own rationale is a live-play mitigation for a team's phone that cannot reach the server
   * *while the question is open* — the bound has to be the same as an ordinary submission's, not
   * looser. Before this, `SUBMIT_FOR_TEAM` was legal against `LOCKED`/`REVEALED`/`SCORED`, silently
   * changing a team's score with no new `QUESTION_SCORED` event to say it happened.
   */
  it('refuses a proxy submission once the question is no longer open', () => {
    const game = open()
    game.act({ type: 'LOCK_QUESTION', gameQuestionId: FREE_Q, drafts: [] })

    expect(
      refusal(
        game.act({
          type: 'SUBMIT_FOR_TEAM',
          gameQuestionId: FREE_Q,
          teamId: A,
          text: 'paris',
        }),
      ).error,
    ).toBe('QUESTION_LOCKED')
  })

  /**
   * Stress-testing findings, ISSUE-5 — round-2's API-driven pass found `SUBMIT_FOR_TEAM` with
   * `text: ''` accepted outright, silently creating a `NO_ANSWER` row with no feedback. The
   * control desk's own `ProxyAnswer` already disables `[Save it]` on blank text, so this closes
   * the same gap at the command layer — a scripted request bypasses the UI, and did.
   *
   * No text and no option is not an answer, it is nothing at all — `LOCK_QUESTION`'s draft
   * commitment already treats an empty draft the same way (the `describe('lock', …)` block
   * below).
   */
  it.each(['SUBMIT_ANSWER', 'SUBMIT_FOR_TEAM'] as const)(
    'refuses %s with no text and no selected option',
    (type) => {
      const game = open()
      expect(
        refusal(game.act({ type, gameQuestionId: FREE_Q, teamId: A, text: '' })).error,
      ).toBe('VALIDATION_ERROR')
      expect(
        refusal(game.act({ type, gameQuestionId: FREE_Q, teamId: A, text: '   ' })).error,
      ).toBe('VALIDATION_ERROR')
      expect(refusal(game.act({ type, gameQuestionId: FREE_Q, teamId: A })).error).toBe(
        'VALIDATION_ERROR',
      )
      // Nothing was appended — a rejected submission must not leave a ghost row behind, which is
      // the whole reason ISSUE-5 mattered: a `NO_ANSWER` row that reads as a deliberate answer.
      expect(game.state.questions.get(FREE_Q)?.answers.has(A)).toBe(false)
    },
  )

  it('still accepts a multiple-choice submission that carries an option but no text', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: MC_Q }, 1_000)
    // MC never sends `text` at all — only `selectedOptionId` — so the empty-submission guard
    // must not mistake "no text" for "no answer" here.
    const decision = accepted(
      game.act({
        type: 'SUBMIT_ANSWER',
        gameQuestionId: MC_Q,
        teamId: A,
        selectedOptionId: 'opt-a',
      }),
    )
    expect(decision.events).toHaveLength(1)
  })
})

// ─── draft commitment at lock (protocol §4.3, D26) ───

describe('lock', () => {
  it('commits a draft only for a team that never submitted, before the lock', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    game.act({ type: 'SUBMIT_ANSWER', gameQuestionId: FREE_Q, teamId: A, text: 'paris' })

    const decision = accepted(
      game.act({
        type: 'LOCK_QUESTION',
        gameQuestionId: FREE_Q,
        drafts: [
          { teamId: A, text: 'stale draft', selectedOptionId: null },
          { teamId: B, text: 'lyon', selectedOptionId: null },
          // An empty draft is not an answer, and would otherwise create a NO_ANSWER row that
          // reads as if the team submitted nothing on purpose.
          { teamId: C, text: '', selectedOptionId: null },
        ],
      }),
    )

    expect(decision.events).toEqual([
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: FREE_Q,
          teamId: B,
          text: 'lyon',
          fromDraft: true,
          enteredByMaster: false,
        },
      },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE_Q } },
    ])
    // D26's "not confirmed by team" marker comes from `fromDraft`.
    expect(game.state.questions.get(FREE_Q)?.answers.get(B)?.isDraft).toBe(true)
    expect(game.state.questions.get(FREE_Q)?.answers.get(A)?.text).toBe('paris')
    expect(game.state.questions.get(FREE_Q)?.answers.has(C)).toBe(false)
  })

  it('is idempotent, and refuses a question that never opened', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    game.act({ type: 'LOCK_QUESTION', gameQuestionId: FREE_Q, drafts: [] })

    expect(
      accepted(game.act({ type: 'LOCK_QUESTION', gameQuestionId: FREE_Q, drafts: [] }))
        .events,
    ).toEqual([])
    expect(
      refusal(game.act({ type: 'LOCK_QUESTION', gameQuestionId: MC_Q, drafts: [] }))
        .error,
    ).toBe('QUESTION_NOT_OPEN')
  })
})

// ─── question flow ───

describe('question flow', () => {
  it('computes an advisory deadline from the question, then the round default (I12)', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 5_000)
    // 30 s comes from the round, since the question sets no timer of its own.
    expect(game.state.questions.get(FREE_Q)?.deadlineAt).toBe(35_000)
  })

  it('refuses a second open question until the first is settled', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    expect(refusal(game.act({ type: 'OPEN_QUESTION', gameQuestionId: MC_Q })).error).toBe(
      'QUESTION_STILL_OPEN',
    )
  })

  it('will not reveal an open question — it has to be locked first', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    expect(
      refusal(game.act({ type: 'REVEAL_QUESTION', gameQuestionId: FREE_Q })).error,
    ).toBe('QUESTION_NOT_OPEN')
  })

  it('skips from PENDING and from OPEN, but never afterwards (D46)', () => {
    const game = driver(LIVE)
    expect(
      accepted(game.act({ type: 'SKIP_QUESTION', gameQuestionId: MC_Q })).events,
    ).toHaveLength(1)

    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    game.act({ type: 'LOCK_QUESTION', gameQuestionId: FREE_Q, drafts: [] })
    expect(
      refusal(game.act({ type: 'SKIP_QUESTION', gameQuestionId: FREE_Q })).error,
    ).toBe('QUESTION_NOT_OPEN')
  })

  it('refuses everything once the game is finished', () => {
    const game = driver([...LIVE, { type: 'GAME_FINISHED', payload: {} }])
    expect(
      refusal(game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q })).error,
    ).toBe('GAME_NOT_LIVE')
  })

  /**
   * The symmetric half of "refuses a second open question until the first is settled" above.
   * Without this, `ROUND_CLOSED` cleared `currentQuestionId` (see `reduce.ts`) but left the
   * question's own `play.state` at `OPEN` — invisible to `OPEN_QUESTION`'s guard, which reads
   * only through `currentQuestionId`. A team could still submit or buzz against the abandoned
   * question while a new one opened in the next round, both live at once.
   */
  it('refuses to close a round with a question still open', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    expect(refusal(game.act({ type: 'CLOSE_ROUND', gameRoundId: 'r1' })).error).toBe(
      'QUESTION_STILL_OPEN',
    )

    // Locked is fine, mirroring `OPEN_ROUND`'s own guard — nothing is waiting on input.
    game.act({ type: 'LOCK_QUESTION', gameQuestionId: FREE_Q, drafts: [] })
    expect(accepted(game.act({ type: 'CLOSE_ROUND', gameRoundId: 'r1' })).events).toEqual(
      [{ type: 'ROUND_CLOSED', payload: { gameRoundId: 'r1' } }],
    )
  })
})

/**
 * PRD 3 §1.1 lists ending and abandoning as the two genuinely irreversible acts, framed as a true
 * emergency stop — which only holds if neither is blockable by "there's an open question".
 */
describe('ending the game is an emergency stop, not another lifecycle guard', () => {
  it('finishes and abandons mid-question, unlike every other round/question transition', () => {
    const finishing = driver(LIVE)
    finishing.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    expect(accepted(finishing.act({ type: 'FINISH_GAME' })).events).toEqual([
      { type: 'GAME_FINISHED', payload: {} },
    ])

    const abandoning = driver(LIVE)
    abandoning.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    expect(accepted(abandoning.act({ type: 'ABANDON_GAME' })).events).toEqual([
      { type: 'GAME_ABANDONED', payload: {} },
    ])
  })
})

// ─── the buzzer loop (D35) ───

describe('buzz', () => {
  const buzzing = () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: BUZZ_Q }, 1_000)
    return game
  }

  const buzz = (teamId: string, buzzId: string, receivedAt: number): Command => ({
    type: 'BUZZ',
    buzzId,
    gameQuestionId: BUZZ_Q,
    teamId,
    receivedAt,
  })

  it('records the offset from the question opening, and sounds only for the room', () => {
    const game = buzzing()
    const decision = accepted(game.act(buzz(A, 'bz-1', 5_210), 5_210))
    expect(decision.events[0]?.payload).toMatchObject({ offsetMs: 4_210 })
    // P3: the buzz sound is a MAIN_SCREEN notice. Twenty phones buzzing is the failure D27 avoids.
    expect(decision.notices).toEqual([{ kind: 'BUZZ', teamId: A }])
  })

  it('records a second buzz during adjudication, and ignores a double tap', () => {
    const game = buzzing()
    game.act(buzz(A, 'bz-1', 5_000), 5_000)
    expect(accepted(game.act(buzz(B, 'bz-2', 5_040), 5_040)).events).toHaveLength(1)
    expect(game.state.questions.get(BUZZ_Q)?.buzzes.at(-1)?.outcome).toBe('NOT_FIRST')

    // A's phone retrying while the master is still judging.
    expect(accepted(game.act(buzz(A, 'bz-3', 5_100), 5_100)).events).toEqual([])
  })

  it('credits the team on accept — the adjudication is the scoring', () => {
    const game = buzzing()
    game.act(buzz(A, 'bz-1', 5_000), 5_000)
    game.act({ type: 'ADJUDICATE_BUZZ', buzzId: 'bz-1', accepted: true }, 6_000)

    // PRD 1 §8.4: for a buzzer question the master accepts or denies the spoken answer, and D35
    // says an accepted team is credited. Nothing was typed, so no other event could do it.
    expect(game.state.teams.get(A)?.score).toBe(20)
    expect(game.state.questions.get(BUZZ_Q)?.answers.get(A)?.verdict).toBe('ACCEPTED')
    // And the question is now closed to further buzzing.
    expect(refusal(game.act(buzz(B, 'bz-2', 7_000), 7_000)).error).toBe(
      'BUZZERS_NOT_LIVE',
    )
  })

  it('locks the denied team out, reopens for the rest, and force-reopens for everyone', () => {
    const game = buzzing()
    game.act(buzz(A, 'bz-1', 5_000), 5_000)
    game.act({ type: 'ADJUDICATE_BUZZ', buzzId: 'bz-1', accepted: false }, 6_000)

    expect(game.state.teams.get(A)?.score).toBe(0)
    expect(refusal(game.act(buzz(A, 'bz-2', 7_000), 7_000)).error).toBe('TEAM_LOCKED_OUT')
    // Reopening on deny is automatic — B needs no second master click to buzz.
    expect(accepted(game.act(buzz(B, 'bz-3', 7_100), 7_100)).events).toHaveLength(1)

    game.act({ type: 'ADJUDICATE_BUZZ', buzzId: 'bz-3', accepted: false }, 8_000)
    // Rule 5: the master misheard, so everyone is back in.
    expect(
      accepted(game.act({ type: 'REOPEN_BUZZERS', gameQuestionId: BUZZ_Q }, 9_000))
        .events,
    ).toHaveLength(1)
    expect(accepted(game.act(buzz(A, 'bz-4', 9_500), 9_500)).events).toHaveLength(1)
  })

  it('is a no-op on a second adjudication and refuses a skipped question', () => {
    const game = buzzing()
    game.act(buzz(A, 'bz-1', 5_000), 5_000)
    game.act({ type: 'ADJUDICATE_BUZZ', buzzId: 'bz-1', accepted: true }, 6_000)
    expect(
      accepted(game.act({ type: 'ADJUDICATE_BUZZ', buzzId: 'bz-1', accepted: false }))
        .events,
    ).toEqual([])

    const skipped = driver(LIVE)
    skipped.act({ type: 'OPEN_QUESTION', gameQuestionId: BUZZ_Q }, 1_000)
    skipped.act(buzz(B, 'bz-9', 2_000), 2_000)
    skipped.act({ type: 'SKIP_QUESTION', gameQuestionId: BUZZ_Q }, 3_000)
    expect(
      refusal(skipped.act({ type: 'ADJUDICATE_BUZZ', buzzId: 'bz-9', accepted: true }))
        .error,
    ).toBe('QUESTION_NOT_OPEN')
  })

  /** Same reasoning as `SUBMIT_ANSWER`: a buzz after the game ended is not a late arrival. */
  it('refuses a buzz once the game is no longer live', () => {
    const game = buzzing()
    accepted(game.act({ type: 'ABANDON_GAME' }))
    expect(refusal(game.act(buzz(A, 'bz-1', 5_000))).error).toBe('GAME_NOT_LIVE')
  })
})

// ─── reviewing an answer (D42, D40) ───

describe('reviewing an answer', () => {
  const answered = (): ReturnType<typeof driver> => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
    game.act({ type: 'SUBMIT_ANSWER', gameQuestionId: FREE_Q, teamId: A, text: 'paris' })
    return game
  }

  /*
   * P2 #9 — the one deliberately unguarded action here: PRD 2 §13.1's post-game review grid
   * must keep working after the game finishes.
   */
  it('validates an answer even after the game finishes (PRD 2 §13.1)', () => {
    const game = answered()
    accepted(game.act({ type: 'FINISH_GAME' }))

    expect(
      accepted(
        game.act({
          type: 'VALIDATE_ANSWER',
          gameQuestionId: FREE_Q,
          teamId: A,
          accepted: true,
        }),
      ).events,
    ).toEqual([
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: FREE_Q, teamId: A, accepted: true },
      },
    ])
  })

  // P2 #9 — unlike VALIDATE_ANSWER just above, spotlighting has no post-game life of its own
  // (PRD 3 §5.3) and must refuse once the game is no longer live.
  it('refuses to spotlight an answer once the game is no longer live', () => {
    const game = answered()
    accepted(game.act({ type: 'FINISH_GAME' }))

    expect(
      refusal(
        game.act({
          type: 'SPOTLIGHT_ANSWER',
          gameQuestionId: FREE_Q,
          teamId: A,
          spotlit: true,
        }),
      ).error,
    ).toBe('GAME_NOT_LIVE')
  })
})

// ─── DO scoring (D23, D24) ───

describe('DO scoring', () => {
  const doQuestion = () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: DO_Q }, 1_000)
    game.act({ type: 'LOCK_QUESTION', gameQuestionId: DO_Q, drafts: [] })
    return game
  }

  it('takes the payout from the authored config, never the request (D23)', () => {
    const game = doQuestion()
    const decision = accepted(
      game.act({ type: 'SET_DO_WINNERS', gameQuestionId: DO_Q, teamIds: [A, B] }),
    )
    expect(decision.events[0]?.payload).toMatchObject({ tiePayout: 'SPLIT' })
    // 30 points split two ways, integers only.
    expect(game.state.teams.get(A)?.score).toBe(15)
    expect(game.state.teams.get(C)?.score).toBe(0)
  })

  it('rejects a per-team score outside 0…points rather than clamping it silently', () => {
    const game = doQuestion()
    const denied = refusal(
      game.act({
        type: 'SET_DO_SCORES',
        gameQuestionId: DO_Q,
        scores: [{ teamId: A, score: 31 }],
      }),
    )
    expect(denied.error).toBe('SCORE_OUT_OF_RANGE')
    expect(denied.detail).toEqual({ teamId: A, max: 30 })
  })

  /**
   * Slice 9's review finding: `DO_WINNERS_SET` resolved every team but left the question
   * `LOCKED`, so `attention` stayed `SCORE_DO` and the master had no route onward but the
   * timeline strip. The verdict completes the question — `DO` has no reveal beat.
   */
  it('completes the question when the winners are set', () => {
    const game = doQuestion()
    const decision = accepted(
      game.act({ type: 'SET_DO_WINNERS', gameQuestionId: DO_Q, teamIds: [A] }),
    )
    expect(decision.events.map((event) => event.type)).toEqual([
      'DO_WINNERS_SET',
      'QUESTION_SCORED',
    ])
    expect(game.state.questions.get(DO_Q)?.state).toBe('SCORED')
  })

  it('nobody-got-it completes the question too — [] still resolves every team (D23)', () => {
    const game = doQuestion()
    const decision = accepted(
      game.act({ type: 'SET_DO_WINNERS', gameQuestionId: DO_Q, teamIds: [] }),
    )
    expect(decision.events.map((event) => event.type)).toContain('QUESTION_SCORED')
    expect(game.state.questions.get(DO_Q)?.state).toBe('SCORED')
  })

  it('a partial PER_TEAM_SCORE save holds the desk; completing it closes the question', () => {
    const game = doQuestion()

    // One of three teams scored: real state ("1 of 3 scored"), so the desk persists.
    const partial = accepted(
      game.act({
        type: 'SET_DO_SCORES',
        gameQuestionId: DO_Q,
        scores: [{ teamId: A, score: 6 }],
      }),
    )
    expect(partial.events.map((event) => event.type)).toEqual(['DO_SCORES_SET'])
    expect(game.state.questions.get(DO_Q)?.state).toBe('LOCKED')

    // The rest: coverage complete, so the question completes with the save.
    const completing = accepted(
      game.act({
        type: 'SET_DO_SCORES',
        gameQuestionId: DO_Q,
        scores: [
          { teamId: B, score: 0 },
          { teamId: C, score: 10 },
        ],
      }),
    )
    expect(completing.events.map((event) => event.type)).toEqual([
      'DO_SCORES_SET',
      'QUESTION_SCORED',
    ])
    expect(game.state.questions.get(DO_Q)?.state).toBe('SCORED')
  })

  it('refuses to open a question in a round the master has ended', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_ROUND', gameRoundId: 'r1' }, 1_000)
    game.act({ type: 'CLOSE_ROUND', gameRoundId: 'r1' }, 2_000)

    const denied = refusal(game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }))
    expect(denied.error).toBe('ROUND_CLOSED')
  })

  it('refuses DO scoring against a question that is not a DO', () => {
    const game = driver(LIVE)
    expect(
      refusal(game.act({ type: 'SET_DO_WINNERS', gameQuestionId: FREE_Q, teamIds: [] }))
        .error,
    ).toBe('VALIDATION_ERROR')
  })
})

// ─── pacing ───

describe('pacing', () => {
  it('refuses a break over an open question (protocol §4.5)', () => {
    const game = driver(LIVE)
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)

    expect(refusal(game.act({ type: 'START_BREAK', durationMs: 60_000 })).error).toBe(
      'QUESTION_STILL_OPEN',
    )

    // Locked is fine: nothing is waiting on input.
    game.act({ type: 'LOCK_QUESTION', gameQuestionId: FREE_Q, drafts: [] })
    expect(
      accepted(game.act({ type: 'START_BREAK', durationMs: 60_000 }, 20_000)).events,
    ).toHaveLength(1)
    expect(game.state.break?.resumesAt).toBe(80_000)
  })

  it('extends a break by re-starting it, and ends only on the master', () => {
    const game = driver([
      ...LIVE,
      { type: 'BREAK_STARTED', payload: { durationMs: 60_000 } },
    ])
    game.act({ type: 'START_BREAK', durationMs: 120_000 }, 30_000)
    expect(game.state.break?.resumesAt).toBe(150_000)

    expect(accepted(game.act({ type: 'END_BREAK' })).events).toHaveLength(1)
    // A countdown reaching zero changes nothing server-side (D8), so a second end is a no-op.
    expect(accepted(game.act({ type: 'END_BREAK' })).events).toEqual([])
  })

  // P2 #9 — symmetric with START_BREAK's own guard: a stray END_BREAK against a game that
  // ended mid-break must refuse, not append a BREAK_ENDED after the fact.
  it('refuses to end a break once the game is no longer live', () => {
    const game = driver([
      ...LIVE,
      { type: 'BREAK_STARTED', payload: { durationMs: 60_000 } },
      { type: 'GAME_FINISHED', payload: {} },
    ])
    expect(refusal(game.act({ type: 'END_BREAK' })).error).toBe('GAME_NOT_LIVE')
  })

  it('appends PICKER_ASSIGNED even when it only confirms the rule (D30)', () => {
    const game = driver(LIVE)
    expect(
      accepted(game.act({ type: 'ASSIGN_PICKER', teamId: B, reason: 'RULE' })).events,
    ).toEqual([{ type: 'PICKER_ASSIGNED', payload: { teamId: B, reason: 'RULE' } }])
  })

  it('adjusts a score at any time, and suppresses only the banner (D25)', () => {
    const game = driver([...LIVE, { type: 'GAME_FINISHED', payload: {} }])

    const announced = accepted(
      game.act({
        type: 'ADJUST_SCORE',
        adjustmentId: 'adj-1',
        teamId: A,
        delta: -5,
        reason: 'heckling',
        announced: true,
      }),
    )
    expect(announced.notices).toEqual([
      { kind: 'SCORE_ADJUSTED', teamId: A, delta: -5, reason: 'heckling' },
    ])

    const quiet = accepted(
      game.act({
        type: 'ADJUST_SCORE',
        adjustmentId: 'adj-2',
        teamId: A,
        delta: 5,
        announced: false,
      }),
    )
    expect(quiet.notices).toEqual([])
    // The row exists either way, so the audit trail stays complete.
    expect(game.state.adjustments).toHaveLength(2)

    accepted(game.act({ type: 'REVOKE_ADJUSTMENT', adjustmentId: 'adj-1' }))
    expect(
      accepted(game.act({ type: 'REVOKE_ADJUSTMENT', adjustmentId: 'adj-1' })).events,
    ).toEqual([])
    expect(game.state.teams.get(A)?.score).toBe(5)
  })
})

// ─── setup-only actions ───

describe('setup-only actions', () => {
  it('refuses a code regeneration once the game is live', () => {
    const game = driver(LIVE)
    expect(refusal(game.act({ type: 'REGENERATE_CODE', code: 'ABCDEF' })).error).toBe(
      'NOT_IN_SETUP',
    )
  })

  it('configures the finale in SETUP only (D54)', () => {
    const setup = driver([team(A, 0)])
    expect(
      accepted(
        setup.act({ type: 'CONFIGURE_FINALE', secondsPerPoint: 2, penaltySeconds: 20 }),
      ).events,
    ).toHaveLength(1)

    const live = driver(LIVE)
    expect(
      refusal(
        live.act({ type: 'CONFIGURE_FINALE', secondsPerPoint: 2, penaltySeconds: 20 }),
      ).error,
    ).toBe('NOT_IN_SETUP')
  })
})

// ─── DSMTW_FINALE (D50) ───

describe('finale', () => {
  /** Two finalists with 100 and 40 second banks, the finale round open and its question live. */
  const finale = () => {
    const game = driver([
      team(A, 0),
      team(B, 1),
      team(C, 2),
      { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 1, penaltySeconds: 20 } },
      { type: 'GAME_STARTED', payload: {} },
      {
        type: 'SCORE_ADJUSTED',
        payload: { adjustmentId: 'a1', teamId: A, delta: 100, announced: false },
      },
      {
        type: 'SCORE_ADJUSTED',
        payload: { adjustmentId: 'a2', teamId: B, delta: 40, announced: false },
      },
      { type: 'ROUND_OPENED', payload: { gameRoundId: 'r3' } },
    ])
    return game
  }

  it('needs two finalists, and fixes the selection once made (D55)', () => {
    const game = finale()
    expect(refusal(game.act({ type: 'SET_FINALISTS', teamIds: [A] })).error).toBe(
      'TOO_FEW_FINALISTS',
    )
    accepted(game.act({ type: 'SET_FINALISTS', teamIds: [A, B] }))
    expect(game.state.finale.startingSeconds.get(A)).toBe(100)

    expect(refusal(game.act({ type: 'SET_FINALISTS', teamIds: [A, C] })).error).toBe(
      'FINALISTS_ALREADY_SET',
    )
  })

  it('refuses finale actions outside a finale round', () => {
    const game = driver(LIVE)
    expect(refusal(game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })).error).toBe(
      'NOT_A_FINALE_ROUND',
    )
    expect(refusal(game.act({ type: 'PASS_TURN' })).error).toBe('NO_TURN_ACTIVE')
  })

  it('treats starting another team’s turn as a pass', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    game.act({ type: 'START_TURN', teamId: A }, 10_000)

    const decision = accepted(game.act({ type: 'START_TURN', teamId: B }, 25_000))
    expect(decision.events).toEqual([
      { type: 'TURN_ENDED', payload: { teamId: A, reason: 'PASSED' } },
      { type: 'TURN_STARTED', payload: { teamId: B } },
    ])
    // A was charged the 15 seconds they used.
    expect(finaleRemainingSeconds(game.state, A, 25_000)).toBe(85)
  })

  /**
   * The bug this guards: `currentFinaleTurn` finds "the last turn with no `endedAt`" with no
   * question scoping, so a team mid-turn when the master locks the question — the common case,
   * since being mid-turn usually means they just found the deciding keyword — left a dangling
   * open turn. `START_TURN`'s own no-op guard then treated the next start by that same team as a
   * repeat of an already-running turn, and the stale `turnStartedAt` kept draining their clock
   * with no new `TURN_STARTED` event — breaking D52's "a restart mid-turn recovers every clock
   * exactly" the moment there was no restart to trigger the recovery.
   */
  it('ends the active turn when the question locks, so it cannot drain into the next one (D52)', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    game.act({ type: 'START_TURN', teamId: A }, 10_000)

    const decision = accepted(
      game.act({ type: 'LOCK_QUESTION', gameQuestionId: FIN_Q, drafts: [] }, 25_000),
    )
    expect(decision.events).toEqual([
      { type: 'TURN_ENDED', payload: { teamId: A, reason: 'QUESTION_CLOSED' } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FIN_Q } },
    ])
    // A was charged the 15 seconds their turn actually ran, not left ticking.
    expect(finaleRemainingSeconds(game.state, A, 25_000)).toBe(85)
    expect(currentFinaleTurn(game.state)).toBeUndefined()

    // The turn is genuinely closed, so restarting the same team is a real start — not the no-op a
    // dangling turn would have produced, which is the whole point of the fix.
    const restart = accepted(game.act({ type: 'START_TURN', teamId: A }, 30_000))
    expect(restart.events).toEqual([{ type: 'TURN_STARTED', payload: { teamId: A } }])
  })

  /**
   * P2 #12 — `REVEAL_QUESTION` and `REVEAL_KEYWORDS` are coupled in both directions so the two
   * REVEALED-ish facts on a finale question can never diverge, whichever command a client sends.
   */
  describe('a finale question is REVEALED together with its keywords', () => {
    const lockedFinale = () => {
      const game = finale()
      game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
      game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
      game.act({ type: 'LOCK_QUESTION', gameQuestionId: FIN_Q, drafts: [] }, 20_000)
      return game
    }

    it('REVEAL_QUESTION also reveals the keywords', () => {
      const game = lockedFinale()
      expect(
        accepted(game.act({ type: 'REVEAL_QUESTION', gameQuestionId: FIN_Q })).events,
      ).toEqual([
        { type: 'QUESTION_REVEALED', payload: { gameQuestionId: FIN_Q } },
        { type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: FIN_Q } },
      ])
    })

    it("REVEAL_KEYWORDS — PRD 3 §10.5's actual [Reveal remaining] button — also reveals the question", () => {
      const game = lockedFinale()
      expect(
        accepted(game.act({ type: 'REVEAL_KEYWORDS', gameQuestionId: FIN_Q })).events,
      ).toEqual([
        { type: 'QUESTION_REVEALED', payload: { gameQuestionId: FIN_Q } },
        { type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: FIN_Q } },
      ])
    })

    it("REVEAL_KEYWORDS refuses an open question, mirroring REVEAL_QUESTION's own bound", () => {
      const game = finale()
      game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
      game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
      expect(
        refusal(game.act({ type: 'REVEAL_KEYWORDS', gameQuestionId: FIN_Q })).error,
      ).toBe('QUESTION_NOT_OPEN')
    })

    it('REVEAL_KEYWORDS a second time, once already REVEALED, only re-reveals keywords', () => {
      const game = lockedFinale()
      accepted(game.act({ type: 'REVEAL_QUESTION', gameQuestionId: FIN_Q }))
      expect(
        accepted(game.act({ type: 'REVEAL_KEYWORDS', gameQuestionId: FIN_Q })).events,
      ).toEqual([{ type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: FIN_Q } }])
    })

    it('REVEAL_QUESTION on an ordinary (non-finale) question never adds KEYWORDS_REVEALED', () => {
      const game = driver(LIVE)
      game.act({ type: 'OPEN_QUESTION', gameQuestionId: FREE_Q }, 1_000)
      game.act({ type: 'LOCK_QUESTION', gameQuestionId: FREE_Q, drafts: [] }, 2_000)
      expect(
        accepted(game.act({ type: 'REVEAL_QUESTION', gameQuestionId: FREE_Q })).events,
      ).toEqual([{ type: 'QUESTION_REVEALED', payload: { gameQuestionId: FREE_Q } }])
    })
  })

  /** D46's other question-ending transition gets the same handover treatment as a lock. */
  it('also ends the active turn when the question is skipped', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    game.act({ type: 'START_TURN', teamId: B }, 10_000) // B has a 40 s bank

    const decision = accepted(
      game.act({ type: 'SKIP_QUESTION', gameQuestionId: FIN_Q }, 18_000),
    )
    expect(decision.events).toEqual([
      { type: 'TURN_ENDED', payload: { teamId: B, reason: 'QUESTION_CLOSED' } },
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: FIN_Q } },
    ])
    expect(currentFinaleTurn(game.state)).toBeUndefined()
  })

  it('marks a keyword for the team on turn, idempotently, and refuses a second team', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    game.act({ type: 'START_TURN', teamId: A }, 10_000)

    accepted(game.act({ type: 'MARK_KEYWORD', gameKeywordId: KW(0) }, 12_000))
    // Every *other* remaining finalist loses the penalty; the finder is not charged.
    expect(finaleRemainingSeconds(game.state, B, 12_000)).toBe(20)
    expect(
      accepted(game.act({ type: 'MARK_KEYWORD', gameKeywordId: KW(0) }, 13_000)).events,
    ).toEqual([])

    game.act({ type: 'START_TURN', teamId: B }, 14_000)
    expect(
      refusal(game.act({ type: 'MARK_KEYWORD', gameKeywordId: KW(0) }, 15_000)).error,
    ).toBe('KEYWORD_ALREADY_MARKED')

    // Un-marking gives the time back — D41 reversing time, not just a score.
    accepted(game.act({ type: 'UNMARK_KEYWORD', gameKeywordId: KW(0) }, 16_000))
    expect(finaleRemainingSeconds(game.state, B, 16_000)).toBe(38)
  })

  it('needs a turn to mark against', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    expect(refusal(game.act({ type: 'MARK_KEYWORD', gameKeywordId: KW(0) })).error).toBe(
      'NO_TURN_ACTIVE',
    )
  })

  it('eliminates on turn at the instant the clock actually ran out', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    game.act({ type: 'START_TURN', teamId: B }, 20_000) // B has 40 s

    // Control notices at 61 s of turn, a second late. The server recomputes the instant.
    const decision = accepted(game.act({ type: 'ELIMINATE_TEAM', teamId: B }, 81_000))
    expect(decision.events).toEqual([
      { type: 'TURN_ENDED', payload: { teamId: B, reason: 'ELIMINATED' } },
      { type: 'TEAM_ELIMINATED', payload: { teamId: B, at: 60_000 } },
    ])
    expect(game.state.teams.get(B)?.eliminatedAt).toBe(60_000)
  })

  it('ignores an elimination for a team still above zero', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    game.act({ type: 'START_TURN', teamId: A }, 10_000)

    // A stale observation from a slow browser is accepted and ignored, not reported as an error
    // the master can do anything about.
    expect(
      accepted(game.act({ type: 'ELIMINATE_TEAM', teamId: A }, 11_000)).events,
    ).toEqual([])
  })

  it('eliminates a waiting team at the penalty that took them to zero (off turn)', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    game.act({ type: 'START_TURN', teamId: A }, 10_000)

    // Two marks by A cost B 40 s — B's whole bank — while B was waiting, not on turn.
    game.act({ type: 'MARK_KEYWORD', gameKeywordId: KW(0) }, 12_000)
    game.act({ type: 'MARK_KEYWORD', gameKeywordId: KW(1) }, 14_000)
    expect(finaleRemainingSeconds(game.state, B, 14_000)).toBe(0)

    const decision = accepted(game.act({ type: 'ELIMINATE_TEAM', teamId: B }, 20_000))
    // The instant is the mark that crossed them, not when control noticed — and B was not on turn,
    // so no turn ends.
    expect(decision.events).toEqual([
      { type: 'TEAM_ELIMINATED', payload: { teamId: B, at: 14_000 } },
    ])
    expect(eliminationInstant(game.state, B, 20_000)).toBe(14_000)
  })

  it('ends the finale when one finalist is left, with the ranking the deriver produced', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    game.act({ type: 'START_TURN', teamId: B }, 20_000)
    game.act({ type: 'ELIMINATE_TEAM', teamId: B }, 81_000)

    const expected = finaleRanking(game.state)
    expect(expected).toEqual([[A], [B]])

    const decision = accepted(game.act({ type: 'END_FINALE' }, 82_000))
    expect(decision.events).toEqual([
      { type: 'FINALE_ENDED', payload: { ranking: [[A], [B]] } },
    ])
    // Recorded once, and never a second time.
    expect(accepted(game.act({ type: 'END_FINALE' }, 83_000)).events).toEqual([])
  })

  it('does nothing while two finalists are still in', () => {
    const game = finale()
    game.act({ type: 'SET_FINALISTS', teamIds: [A, B] })
    game.act({ type: 'OPEN_QUESTION', gameQuestionId: FIN_Q }, 10_000)
    expect(accepted(game.act({ type: 'END_FINALE' })).events).toEqual([])
  })
})

/**
 * PRD 2 §11.2 — a table arriving mid-game. Legal at **every** status, which is the whole point:
 * PRD 1 does not block late joins, so the gate is a dialog that shows what they missed, not a
 * refusal here.
 */
describe('adding a team', () => {
  it('appends at the end and writes no adjustment when no opening score is given', () => {
    const game = driver(LIVE)
    const decision = accepted(
      game.act({
        type: 'ADD_TEAM',
        teamId: 'team-d',
        name: 'Late Arrivals',
        colour: '#A78BFA',
      }),
    )

    expect(decision.events).toEqual([
      {
        type: 'TEAM_ADDED',
        // Position is explicit and appended — never insertion order (CLAUDE.md §2.7).
        payload: {
          teamId: 'team-d',
          name: 'Late Arrivals',
          colour: '#A78BFA',
          position: 3,
        },
      },
    ])
    expect(game.state.teams.get('team-d')?.score).toBe(0)
  })

  /**
   * §11.2's inline generosity is an **ordinary** adjustment (D15), not a magic opening balance — so
   * it appears in the audit trail and can be revoked (D41) like anything else.
   */
  it('writes the opening score as a normal, silent, revocable adjustment', () => {
    const game = driver(LIVE)
    const decision = accepted(
      game.act({
        type: 'ADD_TEAM',
        teamId: 'team-d',
        name: 'Late Arrivals',
        colour: '#A78BFA',
        startingScore: {
          adjustmentId: 'adj-1',
          delta: 70,
          reason: 'joined during round 2',
        },
      }),
    )

    expect(decision.events[1]).toEqual({
      type: 'SCORE_ADJUSTED',
      payload: {
        adjustmentId: 'adj-1',
        teamId: 'team-d',
        delta: 70,
        reason: 'joined during round 2',
        // The room does not need a banner about bookkeeping for a team that just walked in.
        announced: false,
      },
    })
    expect(game.state.teams.get('team-d')?.score).toBe(70)

    accepted(game.act({ type: 'REVOKE_ADJUSTMENT', adjustmentId: 'adj-1' }))
    expect(game.state.teams.get('team-d')?.score).toBe(0)
  })

  it('writes no adjustment for a zero opening score', () => {
    const game = driver(LIVE)
    const decision = accepted(
      game.act({
        type: 'ADD_TEAM',
        teamId: 'team-d',
        name: 'Late Arrivals',
        colour: '#A78BFA',
        startingScore: { adjustmentId: 'adj-1', delta: 0, reason: 'joined late' },
      }),
    )
    expect(decision.events).toHaveLength(1)
  })

  /** The same retry rule submission has (D8): a doubted network must not produce a second table. */
  it('is idempotent on the same team id', () => {
    const game = driver(LIVE)
    game.act({ type: 'ADD_TEAM', teamId: 'team-d', name: 'Late', colour: '#A78BFA' })
    expect(
      accepted(
        game.act({ type: 'ADD_TEAM', teamId: 'team-d', name: 'Late', colour: '#A78BFA' }),
      ).events,
    ).toEqual([])
  })
})

describe('renaming a team', () => {
  /** §13.4 — a misspelled name is worth fixing after the night is over, so there is no status gate. */
  it('is allowed once the game has finished', () => {
    const game = driver([...LIVE, { type: 'GAME_FINISHED', payload: {} }])
    accepted(game.act({ type: 'UPDATE_TEAM', teamId: A, name: 'The Correct Name' }))
    expect(game.state.teams.get(A)?.name).toBe('The Correct Name')
  })

  it('does nothing when neither field is given, and refuses an unknown team', () => {
    const game = driver(LIVE)
    expect(accepted(game.act({ type: 'UPDATE_TEAM', teamId: A })).events).toEqual([])
    expect(game.act({ type: 'UPDATE_TEAM', teamId: 'nope', name: 'x' })).toMatchObject({
      ok: false,
      error: 'TEAM_NOT_FOUND',
    })
  })
})
