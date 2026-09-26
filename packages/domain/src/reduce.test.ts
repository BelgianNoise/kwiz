import { describe, expect, it } from 'vitest'

import {
  buzzersLive,
  finaleRanking,
  finaleRemainingSeconds,
  finaleTurnOrder,
  finalistsAtZero,
  isLockedOut,
  lockedOutTeamIds,
  standings,
  suggestFinaleQuestions,
  suggestedPicker,
  timerFor,
  wordLengths,
} from './derive'
import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState } from './state'

/**
 * build-order's must-test list for this slice: the buzzer deny → lockout → reopen loop, the
 * timer-pause derivation, scoring in both `DO` modes, the Jeopardy turn-order rule, and the
 * finale arithmetic.
 *
 * Every fixture is a literal array. No mocks, no setup, no clock.
 */

const A = 'team-a'
const B = 'team-b'
const C = 'team-c'
const BUZZ_Q = 'q-buzz'
const FREE_Q = 'q-free'
const DO_Q = 'q-do'
const TILE_1 = 'tile-1'
const TILE_2 = 'tile-2'
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
      defaultTimerMs: null,
      config: {},
      categories: [],
      questions: [
        q({ id: FREE_Q }),
        q({ id: BUZZ_Q, position: 1, answerMethod: 'BUZZER', points: 20 }),
        q({
          id: DO_Q,
          position: 2,
          answerMethod: 'DO',
          points: 30,
          config: { scoringMode: 'WINNER_TAKES_ALL', tiePayout: 'SPLIT' },
        }),
      ],
    },
    {
      id: 'r2',
      position: 1,
      type: 'JEOPARDY',
      title: 'Board',
      defaultPoints: 20,
      defaultTimerMs: null,
      config: { valueLadder: [20] },
      categories: [{ id: 'cat', position: 0, name: 'Cat' }],
      questions: [
        q({
          id: TILE_1,
          roundId: 'r2',
          categoryId: 'cat',
          answerMethod: 'BUZZER',
          points: 20,
        }),
        q({
          id: TILE_2,
          roundId: 'r2',
          categoryId: 'cat',
          position: 1,
          answerMethod: 'BUZZER',
          points: 40,
        }),
      ],
    },
    {
      id: 'r3',
      position: 2,
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

/** `createdAt` is explicit throughout: these tests state the instant they mean. */
function run(events: [GameEvent, number][]): GameState {
  const log: LoggedEvent[] = events.map(([event, createdAt], i) => ({
    seq: i + 1,
    event,
    createdAt,
  }))
  return reduce(content, log)
}

const team = (id: string, position: number, name = id): [GameEvent, number] => [
  { type: 'TEAM_ADDED', payload: { teamId: id, name, colour: '#EF4444', position } },
  0,
]

const START: [GameEvent, number][] = [
  team(A, 0),
  team(B, 1),
  team(C, 2),
  [{ type: 'GAME_STARTED', payload: {} }, 10],
  [{ type: 'ROUND_OPENED', payload: { gameRoundId: 'r1' } }, 20],
]

const scoreOf = (state: GameState, teamId: string) =>
  state.teams.get(teamId)?.score ?? -999

// ─── the buzzer loop (D35) ───

describe('the deny → lockout → reopen loop (D35)', () => {
  const open: [GameEvent, number][] = [
    ...START,
    [
      {
        type: 'QUESTION_OPENED',
        payload: { gameQuestionId: BUZZ_Q, deadlineAt: 100_000 },
      },
      1_000,
    ],
  ]

  const buzz = (id: string, teamId: string, at: number): [GameEvent, number] => [
    {
      type: 'BUZZ_RECEIVED',
      payload: {
        buzzId: id,
        gameQuestionId: BUZZ_Q,
        teamId,
        receivedAt: at,
        offsetMs: at - 1_000,
      },
    },
    at,
  ]

  it('makes the first buzz the one awaiting adjudication', () => {
    const state = run([...open, buzz('b1', A, 2_000)])
    const play = state.questions.get(BUZZ_Q)!

    expect(play.buzzes[0]?.outcome).toBe('AWAITING')
    // The buzzers close while it is adjudicated — the room is waiting on the master.
    expect(buzzersLive(play)).toBe(false)
  })

  /** A buzz arriving mid-adjudication is recorded but never judged. */
  it('records a later buzz as NOT_FIRST rather than dropping it', () => {
    const state = run([...open, buzz('b1', A, 2_000), buzz('b2', B, 2_040)])
    const play = state.questions.get(BUZZ_Q)!

    expect(play.buzzes.map((b) => b.outcome)).toEqual(['AWAITING', 'NOT_FIRST'])
    // It is still the record behind "Team B by 0.04s", and behind any dispute.
    expect(play.buzzes[1]?.offsetMs).toBe(1_040)
  })

  it('locks the denied team out and reopens to everyone else', () => {
    const state = run([
      ...open,
      buzz('b1', A, 2_000),
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b1', accepted: false } }, 3_000],
    ])
    const play = state.questions.get(BUZZ_Q)!

    expect(lockedOutTeamIds(play)).toEqual([A])
    expect(isLockedOut(play, B)).toBe(false)
    // Reopening is implied by the denial itself — there is no reopen event.
    expect(buzzersLive(play)).toBe(true)
  })

  it('loops: a second team may buzz, be denied, and a third still gets in', () => {
    const state = run([
      ...open,
      buzz('b1', A, 2_000),
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b1', accepted: false } }, 3_000],
      buzz('b2', B, 4_000),
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b2', accepted: false } }, 5_000],
      buzz('b3', C, 6_000),
    ])
    const play = state.questions.get(BUZZ_Q)!

    expect(lockedOutTeamIds(play).sort()).toEqual([A, B])
    expect(play.buzzes.at(-1)?.outcome).toBe('AWAITING')
  })

  it('closes the buzzers for good once a team is credited', () => {
    const state = run([
      ...open,
      buzz('b1', A, 2_000),
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b1', accepted: true } }, 3_000],
    ])
    expect(buzzersLive(state.questions.get(BUZZ_Q)!)).toBe(false)
  })

  /** D35 rule 5: the master accepts they misheard, and everyone is back in. */
  it('clears every lockout on a force reopen', () => {
    const state = run([
      ...open,
      buzz('b1', A, 2_000),
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b1', accepted: false } }, 3_000],
      [{ type: 'BUZZERS_FORCE_REOPENED', payload: { gameQuestionId: BUZZ_Q } }, 4_000],
    ])
    const play = state.questions.get(BUZZ_Q)!

    expect(lockedOutTeamIds(play)).toEqual([])
    expect(buzzersLive(play)).toBe(true)
  })

  // ─── the timer pause, which has no event of its own ───

  it('pauses the timer for the adjudication interval', () => {
    const state = run([...open, buzz('b1', A, 2_000)])
    const timer = timerFor(state.questions.get(BUZZ_Q)!, 5_000)

    expect(timer?.pausedAt).toBe(2_000)
    // Paused for 3s so far, so the effective deadline has moved out by 3s.
    expect(timer?.deadlineAt).toBe(103_000)
  })

  it('resumes it, and the pushed-out deadline stays pushed out', () => {
    const state = run([
      ...open,
      buzz('b1', A, 2_000),
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b1', accepted: false } }, 3_500],
    ])
    const timer = timerFor(state.questions.get(BUZZ_Q)!, 9_000)

    expect(timer?.pausedAt).toBeNull()
    expect(timer?.deadlineAt).toBe(101_500)
  })

  /** Each round of the deny loop pauses, so the intervals sum. */
  it('accumulates pauses across the loop', () => {
    const state = run([
      ...open,
      buzz('b1', A, 2_000),
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b1', accepted: false } }, 3_000],
      buzz('b2', B, 4_000),
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b2', accepted: false } }, 6_000],
    ])
    // 1s + 2s.
    expect(timerFor(state.questions.get(BUZZ_Q)!, 9_000)?.deadlineAt).toBe(103_000)
  })

  it('has no timer at all when the question carries no deadline', () => {
    const state = run([
      ...START,
      [{ type: 'QUESTION_OPENED', payload: { gameQuestionId: BUZZ_Q } }, 1_000],
    ])
    expect(timerFor(state.questions.get(BUZZ_Q)!, 5_000)).toBeNull()
  })
})

// ─── scoring ───

describe('scoring', () => {
  const submit = (teamId: string, text: string, at: number): [GameEvent, number] => [
    {
      type: 'ANSWER_SUBMITTED',
      payload: {
        gameQuestionId: FREE_Q,
        teamId,
        text,
        fromDraft: false,
        enteredByMaster: false,
      },
    },
    at,
  ]

  const openFree: [GameEvent, number][] = [
    ...START,
    [{ type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE_Q } }, 1_000],
  ]

  it('auto-awards an exact match and sends a near-miss to the master (D22)', () => {
    const state = run([
      ...openFree,
      submit(A, ' PARIS ', 2_000),
      submit(B, 'Pariss', 2_100),
    ])
    const play = state.questions.get(FREE_Q)!

    expect(play.answers.get(A)?.verdict).toBe('AUTO_CORRECT')
    expect(scoreOf(state, A)).toBe(10)
    expect(play.answers.get(B)?.verdict).toBe('PENDING')
    expect(scoreOf(state, B)).toBe(0)
  })

  it('lets a later validation supersede an earlier one, both ways', () => {
    const validate = (accepted: boolean, at: number): [GameEvent, number] => [
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: FREE_Q, teamId: B, accepted },
      },
      at,
    ]

    expect(
      scoreOf(run([...openFree, submit(B, 'lyon', 2_000), validate(true, 3_000)]), B),
    ).toBe(10)
    expect(
      scoreOf(
        run([
          ...openFree,
          submit(B, 'lyon', 2_000),
          validate(true, 3_000),
          validate(false, 4_000),
        ]),
        B,
      ),
    ).toBe(0)
  })

  it('keeps adjustments as a separate line, and may go negative (D15, I9)', () => {
    const state = run([
      ...openFree,
      submit(A, 'paris', 2_000),
      [
        {
          type: 'SCORE_ADJUSTED',
          payload: {
            adjustmentId: 'adj1',
            teamId: A,
            delta: -25,
            reason: 'phone',
            announced: true,
          },
        },
        3_000,
      ],
    ])
    expect(scoreOf(state, A)).toBe(-15)
  })

  it('excludes a revoked adjustment but keeps the row (D41)', () => {
    const base: [GameEvent, number][] = [
      ...openFree,
      [
        {
          type: 'SCORE_ADJUSTED',
          payload: { adjustmentId: 'adj1', teamId: A, delta: 5, announced: true },
        },
        3_000,
      ],
    ]
    const revoked = run([
      ...base,
      [{ type: 'SCORE_ADJUSTMENT_REVOKED', payload: { adjustmentId: 'adj1' } }, 4_000],
    ])

    expect(scoreOf(revoked, A)).toBe(0)
    expect(revoked.adjustments).toHaveLength(1)
    expect(revoked.adjustments[0]?.delta).toBe(5)
  })

  /** I8 / D46 — the case that must be enforced rather than assumed. */
  it('strips points from an already-graded answer when the question is skipped', () => {
    const state = run([
      ...openFree,
      submit(A, 'paris', 2_000),
      [{ type: 'QUESTION_SKIPPED', payload: { gameQuestionId: FREE_Q } }, 3_000],
    ])

    expect(scoreOf(state, A)).toBe(0)
    // The verdict is retained: the team did answer, and the record should say so.
    expect(state.questions.get(FREE_Q)?.answers.get(A)?.verdict).toBe('AUTO_CORRECT')
  })

  describe('DO questions', () => {
    const openDo: [GameEvent, number][] = [
      ...START,
      [{ type: 'QUESTION_OPENED', payload: { gameQuestionId: DO_Q } }, 1_000],
    ]

    it('pays a winner in full and resolves everyone else to zero', () => {
      const state = run([
        ...openDo,
        [
          {
            type: 'DO_WINNERS_SET',
            payload: { gameQuestionId: DO_Q, teamIds: [A], tiePayout: 'FULL' },
          },
          2_000,
        ],
      ])
      expect([scoreOf(state, A), scoreOf(state, B), scoreOf(state, C)]).toEqual([
        30, 0, 0,
      ])
      expect(state.questions.get(DO_Q)?.answers.get(B)?.verdict).toBe('DENIED')
    })

    it('splits a tie using integers only (D24)', () => {
      const state = run([
        ...openDo,
        [
          {
            type: 'DO_WINNERS_SET',
            payload: { gameQuestionId: DO_Q, teamIds: [A, B, C], tiePayout: 'SPLIT' },
          },
          2_000,
        ],
      ])
      // 30 / 3 exactly; and nothing anywhere is fractional.
      expect([scoreOf(state, A), scoreOf(state, B), scoreOf(state, C)]).toEqual([
        10, 10, 10,
      ])
    })

    it('floors an uneven split rather than inventing a decimal', () => {
      const state = run([
        ...openDo,
        [
          {
            type: 'DO_WINNERS_SET',
            payload: { gameQuestionId: DO_Q, teamIds: [A, B], tiePayout: 'SPLIT' },
          },
          2_000,
        ],
      ])
      expect(scoreOf(state, A)).toBe(15)
    })

    it('pays every winner in full when configured to (D23)', () => {
      const state = run([
        ...openDo,
        [
          {
            type: 'DO_WINNERS_SET',
            payload: { gameQuestionId: DO_Q, teamIds: [A, B], tiePayout: 'FULL' },
          },
          2_000,
        ],
      ])
      expect([scoreOf(state, A), scoreOf(state, B)]).toEqual([30, 30])
    })

    it('handles the explicit "nobody got it" (D23)', () => {
      const state = run([
        ...openDo,
        [
          {
            type: 'DO_WINNERS_SET',
            payload: { gameQuestionId: DO_Q, teamIds: [], tiePayout: 'FULL' },
          },
          2_000,
        ],
      ])
      expect([scoreOf(state, A), scoreOf(state, B), scoreOf(state, C)]).toEqual([0, 0, 0])
    })

    it('clamps per-team scores to 0…points (D24)', () => {
      const state = run([
        ...openDo,
        [
          {
            type: 'DO_SCORES_SET',
            payload: {
              gameQuestionId: DO_Q,
              scores: [
                { teamId: A, score: 999 },
                { teamId: B, score: -5 },
                { teamId: C, score: 12 },
              ],
            },
          },
          2_000,
        ],
      ])
      expect([scoreOf(state, A), scoreOf(state, B), scoreOf(state, C)]).toEqual([
        30, 0, 12,
      ])
    })
  })
})

// ─── standings (D32) ───

describe('standings', () => {
  it('shares a rank on a tie and skips the next (D32)', () => {
    const state = run([
      ...START,
      [{ type: 'QUESTION_OPENED', payload: { gameQuestionId: DO_Q } }, 1_000],
      [
        {
          type: 'DO_SCORES_SET',
          payload: {
            gameQuestionId: DO_Q,
            scores: [
              { teamId: A, score: 20 },
              { teamId: B, score: 20 },
              { teamId: C, score: 5 },
            ],
          },
        },
        2_000,
      ],
    ])

    expect(standings(state).map((s) => [s.teamId, s.rank, s.tied])).toEqual([
      [A, 1, true],
      [B, 1, true],
      [C, 3, false],
    ])
  })
})

// ─── Jeopardy turn order (D30) ───

describe('Jeopardy turn order (D30)', () => {
  const openBoard: [GameEvent, number][] = [
    ...START,
    [{ type: 'ROUND_OPENED', payload: { gameRoundId: 'r2' } }, 100],
  ]

  it('gives the first pick to the lowest score', () => {
    const state = run([
      ...openBoard,
      [
        {
          type: 'SCORE_ADJUSTED',
          payload: { adjustmentId: 'a1', teamId: A, delta: 50, announced: true },
        },
        200,
      ],
      [
        {
          type: 'SCORE_ADJUSTED',
          payload: { adjustmentId: 'a2', teamId: B, delta: 10, announced: true },
        },
        210,
      ],
    ])
    // C is on 0.
    expect(suggestedPicker(state, 'r2').teamId).toBe(C)
  })

  it('hands the next pick to whoever answered correctly', () => {
    const state = run([
      ...openBoard,
      [{ type: 'QUESTION_OPENED', payload: { gameQuestionId: TILE_1 } }, 300],
      [
        {
          type: 'BUZZ_RECEIVED',
          payload: {
            buzzId: 'b1',
            gameQuestionId: TILE_1,
            teamId: B,
            receivedAt: 400,
            offsetMs: 100,
          },
        },
        400,
      ],
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b1', accepted: true } }, 500],
    ])
    expect(suggestedPicker(state, 'r2').teamId).toBe(B)
  })

  it('falls back to the lowest score when nobody was credited', () => {
    const state = run([
      ...openBoard,
      [
        {
          type: 'SCORE_ADJUSTED',
          payload: { adjustmentId: 'a1', teamId: A, delta: 50, announced: true },
        },
        200,
      ],
      [
        {
          type: 'SCORE_ADJUSTED',
          payload: { adjustmentId: 'a2', teamId: B, delta: 10, announced: true },
        },
        210,
      ],
      [{ type: 'QUESTION_OPENED', payload: { gameQuestionId: TILE_1 } }, 300],
      [
        {
          type: 'BUZZ_RECEIVED',
          payload: {
            buzzId: 'b1',
            gameQuestionId: TILE_1,
            teamId: B,
            receivedAt: 400,
            offsetMs: 100,
          },
        },
        400,
      ],
      [{ type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'b1', accepted: false } }, 500],
    ])
    expect(suggestedPicker(state, 'r2').teamId).toBe(C)
  })

  /** A tie for lowest is a decision, not a derivation: the master arbitrates it. */
  it('reports a tie for the master to break rather than guessing', () => {
    const state = run(openBoard)
    const picker = suggestedPicker(state, 'r2')

    expect(picker.teamId).toBeNull()
    expect(picker.tiedTeamIds.sort()).toEqual([A, B, C].sort())
  })
})

// ─── DSMTW_FINALE arithmetic (D50–D58) ───

describe('DSMTW_FINALE clocks (D52)', () => {
  /** A: 100 pts → 100s, B: 60 → 60s, C: 40 → 40s at 1 s/point. */
  const setup: [GameEvent, number][] = [
    ...START,
    [{ type: 'QUESTION_OPENED', payload: { gameQuestionId: DO_Q } }, 100],
    [
      {
        type: 'DO_SCORES_SET',
        payload: {
          gameQuestionId: DO_Q,
          scores: [
            { teamId: A, score: 30 },
            { teamId: B, score: 20 },
            { teamId: C, score: 10 },
          ],
        },
      },
      200,
    ],
    [{ type: 'ROUND_OPENED', payload: { gameRoundId: 'r3' } }, 300],
    [
      { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 2, penaltySeconds: 20 } },
      310,
    ],
    [{ type: 'FINALISTS_SET', payload: { teamIds: [A, B, C] } }, 320],
    [{ type: 'QUESTION_OPENED', payload: { gameQuestionId: FIN_Q } }, 330],
  ]

  it('fixes each bank from the score at FINALISTS_SET (D55)', () => {
    const state = run(setup)
    // 30/20/10 points at 2 s/point.
    expect(state.finale.startingSeconds.get(A)).toBe(60)
    expect(state.finale.startingSeconds.get(B)).toBe(40)
    expect(state.finale.startingSeconds.get(C)).toBe(20)
  })

  it('drains only the team on turn, by elapsed time', () => {
    const state = run([
      ...setup,
      [{ type: 'TURN_STARTED', payload: { teamId: C } }, 1_000],
    ])

    // 10s into C's turn.
    expect(finaleRemainingSeconds(state, C, 11_000)).toBe(10)
    // Nobody else's clock is running.
    expect(finaleRemainingSeconds(state, A, 11_000)).toBe(60)
  })

  it('charges every OTHER finalist the penalty on a correct keyword', () => {
    const state = run([
      ...setup,
      [{ type: 'TURN_STARTED', payload: { teamId: C } }, 1_000],
      [{ type: 'KEYWORD_MARKED', payload: { gameKeywordId: KW(0), teamId: C } }, 2_000],
    ])

    // C found it, so C pays nothing — but its own turn has run 1s.
    expect(finaleRemainingSeconds(state, C, 2_000)).toBe(19)
    expect(finaleRemainingSeconds(state, A, 2_000)).toBe(40)
    expect(finaleRemainingSeconds(state, B, 2_000)).toBe(20)
  })

  /** D41 has to reverse **time** here, not just a score. */
  it('returns the penalty to every team when a mark is un-marked', () => {
    const state = run([
      ...setup,
      [{ type: 'TURN_STARTED', payload: { teamId: C } }, 1_000],
      [{ type: 'KEYWORD_MARKED', payload: { gameKeywordId: KW(0), teamId: C } }, 2_000],
      [{ type: 'KEYWORD_UNMARKED', payload: { gameKeywordId: KW(0) } }, 3_000],
    ])

    expect(finaleRemainingSeconds(state, A, 3_000)).toBe(60)
    expect(finaleRemainingSeconds(state, B, 3_000)).toBe(40)
  })

  it('charges nothing for a keyword revealed unguessed', () => {
    const state = run([
      ...setup,
      [{ type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: FIN_Q } }, 2_000],
    ])
    expect(finaleRemainingSeconds(state, A, 2_000)).toBe(60)
  })

  it('never goes below zero (D56 sets no floor, but a clock cannot be negative)', () => {
    const state = run([
      ...setup,
      [{ type: 'TURN_STARTED', payload: { teamId: C } }, 1_000],
    ])
    expect(finaleRemainingSeconds(state, C, 999_000)).toBe(0)
  })

  it('orders turns by fewest seconds, and recomputes as clocks drain', () => {
    const before = run(setup)
    expect(finaleTurnOrder(before, FIN_Q, 330)).toEqual([C, B, A])

    // Two keywords for C costs A and B 40s each: A 60→20, B 40→0.
    const after = run([
      ...setup,
      [{ type: 'TURN_STARTED', payload: { teamId: C } }, 1_000],
      [{ type: 'KEYWORD_MARKED', payload: { gameKeywordId: KW(0), teamId: C } }, 1_100],
      [{ type: 'KEYWORD_MARKED', payload: { gameKeywordId: KW(1), teamId: C } }, 1_200],
      [{ type: 'TURN_ENDED', payload: { teamId: C, reason: 'PASSED' } }, 1_300],
    ])
    // B is now on zero, so it is cheapest; C has passed, so it is out of the order.
    expect(finaleTurnOrder(after, FIN_Q, 1_300)).toEqual([B, A])
  })

  /** A team can cross zero while NOT on turn — someone else's correct guess does it. */
  it('detects a team taken to zero off-turn', () => {
    const state = run([
      ...setup,
      [{ type: 'TURN_STARTED', payload: { teamId: A } }, 1_000],
      [{ type: 'KEYWORD_MARKED', payload: { gameKeywordId: KW(0), teamId: A } }, 1_100],
    ])
    // C had 20s and loses 20 to A's keyword, while A was the one playing.
    expect(finaleRemainingSeconds(state, C, 1_100)).toBe(0)
    expect(finalistsAtZero(state, 1_100)).toContain(C)
  })

  /** I22: an eliminated team accrues nothing further. */
  it('stops charging a team once it is eliminated', () => {
    const state = run([
      ...setup,
      [{ type: 'TURN_STARTED', payload: { teamId: A } }, 1_000],
      [{ type: 'KEYWORD_MARKED', payload: { gameKeywordId: KW(0), teamId: A } }, 1_100],
      [{ type: 'TEAM_ELIMINATED', payload: { teamId: C, at: 1_100 } }, 1_200],
      // A second keyword must not push C's clock below zero or charge it again.
      [{ type: 'KEYWORD_MARKED', payload: { gameKeywordId: KW(1), teamId: A } }, 1_300],
    ])

    expect(finaleRemainingSeconds(state, C, 1_400)).toBe(0)
    // B is still in, so it pays for both.
    expect(finaleRemainingSeconds(state, B, 1_400)).toBe(0)
  })
})

describe('the finale ranking (D51)', () => {
  const eliminate = (teamId: string, at: number): [GameEvent, number] => [
    { type: 'TEAM_ELIMINATED', payload: { teamId, at } },
    at,
  ]

  const base: [GameEvent, number][] = [
    ...START,
    [{ type: 'ROUND_OPENED', payload: { gameRoundId: 'r3' } }, 300],
    [
      { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 1, penaltySeconds: 20 } },
      310,
    ],
    [{ type: 'FINALISTS_SET', payload: { teamIds: [A, B, C] } }, 320],
  ]

  it('puts the survivor first and reverses the elimination order behind them', () => {
    const state = run([...base, eliminate(C, 1_000), eliminate(B, 2_000)])
    // Last out ranks above first out.
    expect(finaleRanking(state)).toEqual([[A], [B], [C]])
  })

  /** Simultaneous elimination shares a rank, consistent with D32 everywhere else. */
  it('shares a rank when two teams go out on the same keyword', () => {
    const state = run([...base, eliminate(B, 1_000), eliminate(C, 1_000)])
    const ranking = finaleRanking(state)

    expect(ranking[0]).toEqual([A])
    expect(ranking[1]?.sort()).toEqual([B, C].sort())
    expect(ranking).toHaveLength(2)
  })

  /**
   * The degenerate case the simulation surfaced: equal banks and a high penalty can take every
   * finalist out at once. There is then **no winner**, and first place is shared.
   */
  it('yields a shared first place and no winner when everyone goes out together', () => {
    const state = run([
      ...base,
      eliminate(A, 1_000),
      eliminate(B, 1_000),
      eliminate(C, 1_000),
    ])
    const ranking = finaleRanking(state)

    expect(ranking).toHaveLength(1)
    expect(ranking[0]?.sort()).toEqual([A, B, C].sort())
  })
})

describe('suggestFinaleQuestions (D58)', () => {
  /**
   * conventions §8.1's sensitivity table. The point of showing this at all is that **a fourfold
   * penalty change swings the answer from 5 questions to 17** — nobody intuits that.
   */
  it.each([
    [[170, 155, 145, 20], 20, 5],
    [[170, 155, 145, 20], 5, 17],
    [[170, 155], 20, 7],
    [[120, 120, 120, 120, 120, 120, 120, 120], 20, 4],
    [[120, 120, 120, 120, 120, 120, 120, 120], 5, 11],
    [[200, 180, 150, 120, 100, 80], 10, 10],
  ])('banks %j at %is → %i questions', (banks, penalty, expected) => {
    expect(suggestFinaleQuestions(banks, penalty)).toBe(expected)
  })

  it('needs only one question when there is already a single finalist', () => {
    expect(suggestFinaleQuestions([100], 20)).toBe(1)
  })

  it('stops rather than looping forever when the penalty drains nothing', () => {
    expect(suggestFinaleQuestions([100, 100], 0)).toBe(61)
  })
})

describe('wordLengths (D53)', () => {
  it.each([
    ['Thriller', [8]],
    ['i like cows', [1, 4, 4]],
    ['Billie Jean', [6, 4]],
    ['324 metres', [3, 6]],
  ])('%o → %j', (keyword, expected) => {
    expect(wordLengths(keyword)).toEqual(expected)
  })

  it('counts characters, not UTF-16 code units', () => {
    expect(wordLengths('café')).toEqual([4])
  })

  it('keeps punctuation with its word, so the tile matches the revealed text', () => {
    expect(wordLengths('Bad!')).toEqual([4])
  })

  it('collapses stray whitespace rather than producing a zero-width word', () => {
    expect(wordLengths('  i   like  cows ')).toEqual([1, 4, 4])
  })
})

// ─── replay determinism, the domain half of I15 ───

describe('reduce is deterministic', () => {
  it('produces identical state from the same log, twice', () => {
    const events: [GameEvent, number][] = [
      ...START,
      [{ type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE_Q } }, 1_000],
      [
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
        2_000,
      ],
      [
        {
          type: 'SCORE_ADJUSTED',
          payload: { adjustmentId: 'a1', teamId: B, delta: 3, announced: false },
        },
        3_000,
      ],
    ]

    // Maps do not compare with toEqual by identity, so serialise the parts that matter.
    const shape = (state: GameState) =>
      JSON.stringify({
        teams: [...state.teams.values()],
        answers: [...state.questions].map(([id, play]) => [
          id,
          [...play.answers.values()],
        ]),
        adjustments: state.adjustments,
        seq: state.seq,
      })

    expect(shape(run(events))).toBe(shape(run(events)))
  })
})
