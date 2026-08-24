import { describe, expect, it } from 'vitest'

import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState } from './state'
import { attention, toMasterControlView } from './views'

/**
 * PRD 3 §3.1 — **exactly one** attention state is active, and which one is game logic, computed
 * here rather than by the client inspecting state and guessing.
 *
 * The priority order is the interesting part, so most of these set up two competing conditions and
 * assert which wins. Anything lower appears only as a count, never as a second call to action.
 */

const A = 'a'
const B = 'b'
const FREE = 'q-free'
const BUZZ = 'q-buzz'
const DO = 'q-do'
const PER_TEAM = 'q-do-per-team'
const TILE = 'tile'
const FIN = 'fin'

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
  code: 'K',
  defaultPlayerLocale: 'en',
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
        q({ id: FREE }),
        q({ id: BUZZ, position: 1, answerMethod: 'BUZZER' }),
        q({
          id: DO,
          position: 2,
          answerMethod: 'DO',
          config: { scoringMode: 'WINNER_TAKES_ALL', tiePayout: 'FULL' },
        }),
        q({
          id: PER_TEAM,
          position: 3,
          answerMethod: 'DO',
          points: 10,
          config: { scoringMode: 'PER_TEAM_SCORE', tiePayout: 'FULL' },
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
      categories: [{ id: 'cat', position: 0, name: 'C' }],
      questions: [
        q({ id: TILE, roundId: 'r2', categoryId: 'cat', answerMethod: 'BUZZER' }),
      ],
    },
    {
      id: 'r3',
      position: 2,
      type: 'DSMTW_FINALE',
      title: 'F',
      defaultPoints: 0,
      defaultTimerMs: null,
      config: { secondsPerPoint: 1, penaltySeconds: 20 },
      categories: [],
      questions: [
        q({
          id: FIN,
          roundId: 'r3',
          answerMethod: 'KEYWORDS',
          keywords: [{ id: 'kw', position: 0, text: 'k', wordLengths: [1] }],
        }),
      ],
    },
  ],
}

const run = (events: GameEvent[]): GameState =>
  reduce(
    content,
    events.map((event, i): LoggedEvent => ({
      seq: i + 1,
      event,
      createdAt: 1_000 + i * 100,
    })),
  )

const SETUP: GameEvent[] = [
  {
    type: 'TEAM_ADDED',
    payload: { teamId: A, name: 'A', colour: '#EF4444', position: 0 },
  },
  {
    type: 'TEAM_ADDED',
    payload: { teamId: B, name: 'B', colour: '#22D3EE', position: 1 },
  },
  { type: 'GAME_STARTED', payload: {} },
  { type: 'ROUND_OPENED', payload: { gameRoundId: 'r1' } },
]

const NOW = 9_000
const kindOf = (state: GameState) => attention(state, NOW).kind

const buzzOn = (gameQuestionId: string, teamId: string): GameEvent => ({
  type: 'BUZZ_RECEIVED',
  payload: { buzzId: 'b1', gameQuestionId, teamId, receivedAt: 2_000, offsetMs: 500 },
})

const pendingAnswer = (gameQuestionId: string, teamId: string): GameEvent => ({
  type: 'ANSWER_SUBMITTED',
  payload: {
    gameQuestionId,
    teamId,
    // A non-match, so it lands on PENDING and needs the master (D22).
    text: 'not the answer',
    fromDraft: false,
    enteredByMaster: false,
  },
})

describe('each state is reachable', () => {
  /**
   * Found by driving the desk: a game with no round open returned no suggestion at all, so the
   * master was shown a leaderboard and **nothing that could open the first round**.
   */
  it('suggests NEXT_ROUND on a live game with no round open', () => {
    const state = run([SETUP[0]!, SETUP[1]!, { type: 'GAME_STARTED', payload: {} }])
    const result = attention(state, NOW)
    expect(result.kind === 'ADVANCE' && result.suggestion).toBe('NEXT_ROUND')
    // …and the view names which one, since `round` is null and cannot carry it.
    expect(toMasterControlView(state, NOW).nextRoundId).toBe('r1')
  })

  it('is NONE before the game starts', () => {
    expect(kindOf(run([SETUP[0]!, SETUP[1]!]))).toBe('NONE')
  })

  it('is ADJUDICATE_BUZZ while a buzz waits', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: BUZZ } },
      buzzOn(BUZZ, A),
    ])
    const result = attention(state, NOW)

    expect(result.kind).toBe('ADJUDICATE_BUZZ')
    if (result.kind !== 'ADJUDICATE_BUZZ') return
    expect(result.buzz.teamName).toBe('A')
    // Stated explicitly to the master rather than left to be inferred (D35).
    expect(result.buzz.timerPaused).toBe(true)
    // The reference answer is there for adjudication, on a question where nothing was typed.
    expect(result.referenceAnswer).toBe('paris')
  })

  it('is SCORE_DO once a DO question is locked', () => {
    expect(
      kindOf(
        run([
          ...SETUP,
          { type: 'QUESTION_OPENED', payload: { gameQuestionId: DO } },
          { type: 'QUESTION_LOCKED', payload: { gameQuestionId: DO } },
        ]),
      ),
    ).toBe('SCORE_DO')
  })

  /**
   * Protocol §5.5's `DoScoringDetail` — without this a master-control client cannot tell
   * `WINNER_TAKES_ALL` from `PER_TEAM_SCORE`, or the payout, from the pushed view at all (PRD 3
   * §8 needs two visually distinct desks driven by exactly this distinction).
   */
  it('SCORE_DO carries everything §8 needs to render either desk', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: DO } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: DO } },
    ])
    const result = attention(state, NOW)
    if (result.kind !== 'SCORE_DO')
      throw new Error(`expected SCORE_DO, got ${result.kind}`)

    expect(result.gameQuestionId).toBe(DO)
    expect(result.points).toBe(10)
    expect(result.scoringMode).toBe('WINNER_TAKES_ALL')
    expect(result.tiePayout).toBe('FULL')
    // MASTER_CONTROL / CONFIG only (PRD 1 §7 invariant 7) — carried through unconditionally here
    // because `attention()` is never reachable from a PLAYER or MAIN_SCREEN view.
    expect(result.masterNotes).toBeNull()
    // Unscored — every team is `null`, not `0` (D24: empty and zero look different).
    expect(result.teams).toEqual([
      { teamId: A, name: 'A', colour: '#EF4444', score: null },
      { teamId: B, name: 'B', colour: '#22D3EE', score: null },
    ])
  })

  /** D24's progressive `PER_TEAM_SCORE` save — "1 of 4 scored" is a real, server-tracked state. */
  it('SCORE_DO reflects a partial PER_TEAM_SCORE save without assuming completeness', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: PER_TEAM } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: PER_TEAM } },
      {
        type: 'DO_SCORES_SET',
        payload: { gameQuestionId: PER_TEAM, scores: [{ teamId: A, score: 6 }] },
      },
    ])
    const result = attention(state, NOW)
    if (result.kind !== 'SCORE_DO')
      throw new Error(`expected SCORE_DO, got ${result.kind}`)

    expect(result.scoringMode).toBe('PER_TEAM_SCORE')
    expect(result.teams).toEqual([
      { teamId: A, name: 'A', colour: '#EF4444', score: 6 },
      // B has not been scored yet — still `null`, not `0`.
      { teamId: B, name: 'B', colour: '#22D3EE', score: null },
    ])
  })

  /**
   * Slice 9's review finding, at the attention layer: a saved verdict used to leave the
   * question `LOCKED` and the master stranded on a finished desk with no route onward but the
   * timeline strip. Resolution completes the question (`QUESTION_SCORED`), and `SCORE_DO`
   * stands down.
   */
  it('SCORE_DO stands down once every team has an outcome', () => {
    const result = attention(
      run([
        ...SETUP,
        { type: 'QUESTION_OPENED', payload: { gameQuestionId: PER_TEAM } },
        { type: 'QUESTION_LOCKED', payload: { gameQuestionId: PER_TEAM } },
        {
          type: 'DO_SCORES_SET',
          payload: { gameQuestionId: PER_TEAM, scores: [{ teamId: A, score: 6 }] },
        },
        {
          type: 'DO_SCORES_SET',
          payload: {
            gameQuestionId: PER_TEAM,
            scores: [
              { teamId: A, score: 6 },
              { teamId: B, score: 0 },
            ],
          },
        },
        { type: 'QUESTION_SCORED', payload: { gameQuestionId: PER_TEAM } },
      ]),
      NOW,
    )
    expect(result.kind).not.toBe('SCORE_DO')
    expect(result.kind === 'ADVANCE' && result.suggestion).toBe('NEXT_QUESTION')
  })

  /**
   * The other half of the same review finding: ending a round early must never point pacing
   * into what was just ended. With unplayed questions left in a *closed* round, the desk offers
   * the next round rather than a `[Next question]` that would reopen ended gameplay.
   */
  it('suggests NEXT_ROUND for a closed current round with questions still pending', () => {
    const result = attention(
      run([...SETUP, { type: 'ROUND_CLOSED', payload: { gameRoundId: 'r1' } }]),
      NOW,
    )
    expect(result.kind === 'ADVANCE' && result.suggestion).toBe('NEXT_ROUND')
  })

  it('is BREAK_TIE_FOR_PICK when the board is stalled on equal scores', () => {
    expect(
      kindOf(run([...SETUP, { type: 'ROUND_OPENED', payload: { gameRoundId: 'r2' } }])),
    ).toBe('BREAK_TIE_FOR_PICK')
  })

  it('is PICK_FINALISTS when a finale round opens with nobody selected', () => {
    const state = run([
      ...SETUP,
      { type: 'ROUND_OPENED', payload: { gameRoundId: 'r3' } },
      { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 2, penaltySeconds: 20 } },
    ])
    const result = attention(state, NOW)

    expect(result.kind).toBe('PICK_FINALISTS')
    if (result.kind !== 'PICK_FINALISTS') return
    // Descending score order, so deselecting the bottom few is a two-second job (D55).
    expect(result.candidates.map((c) => c.teamId)).toEqual([A, B])
    // `seconds` makes a 0s row visible while choosing (D56).
    expect(result.candidates[0]?.seconds).toBe(0)
  })

  it('is FINALE_TURN once a turn is running', () => {
    expect(
      kindOf(
        run([
          ...SETUP,
          { type: 'ROUND_OPENED', payload: { gameRoundId: 'r3' } },
          {
            type: 'FINALE_CONFIGURED',
            payload: { secondsPerPoint: 1, penaltySeconds: 20 },
          },
          { type: 'FINALISTS_SET', payload: { teamIds: [A, B] } },
          { type: 'QUESTION_OPENED', payload: { gameQuestionId: FIN } },
          { type: 'TURN_STARTED', payload: { teamId: A } },
        ]),
      ),
    ).toBe('FINALE_TURN')
  })

  /**
   * P2 #13 — protocol §5.5's `FinaleTurnDetail` carries `prompt`, `masterNotes`,
   * `questionNumber` and `questionTotal` so the master desk can render "Q1 of 1" without a
   * second lookup; the pushed view had omitted all four.
   */
  /**
   * §10.5 stops the clocks while nobody is on turn, so the desk between turns is the same screen
   * with the clock not running. Before slice 5 this was unrepresentable — `FINALE_TURN` needed an
   * active turn — so a freshly opened finale question fell through to the *question* desk, which
   * drew a proxy-answer control for a round nobody types in, and nothing could start the first turn.
   */
  it('is FINALE_TURN between turns too, naming who goes next', () => {
    const state = run([
      ...SETUP,
      { type: 'ROUND_OPENED', payload: { gameRoundId: 'r3' } },
      { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 1, penaltySeconds: 20 } },
      { type: 'FINALISTS_SET', payload: { teamIds: [A, B] } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FIN } },
    ])

    const result = attention(state, NOW)
    expect(result.kind).toBe('FINALE_TURN')
    if (result.kind !== 'FINALE_TURN') return
    expect(result.currentTeamId).toBeNull()
    expect(result.turnStartedAt).toBeNull()
    // Whoever the fewest-seconds rule puts first — which is what `[Start <team>]` starts.
    expect(result.nextTeamId).not.toBeNull()
    // §10.2's `out 21:03` needs the instant, not just the fact.
    expect(result.clocks.every((clock) => clock.eliminatedAt === null)).toBe(true)
  })

  it("FINALE_TURN carries the prompt and the question's position in the round", () => {
    const state = run([
      ...SETUP,
      { type: 'ROUND_OPENED', payload: { gameRoundId: 'r3' } },
      { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 1, penaltySeconds: 20 } },
      { type: 'FINALISTS_SET', payload: { teamIds: [A, B] } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FIN } },
      { type: 'TURN_STARTED', payload: { teamId: A } },
    ])
    const result = attention(state, NOW)
    if (result.kind !== 'FINALE_TURN')
      throw new Error(`expected FINALE_TURN, got ${result.kind}`)

    expect(result.prompt).toBe('P')
    expect(result.masterNotes).toBeNull()
    // The finale round in this fixture has exactly one question.
    expect(result.questionNumber).toBe(1)
    expect(result.questionTotal).toBe(1)
  })

  it('is VALIDATE_QUESTION when an answer needs a human', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      pendingAnswer(FREE, A),
    ])
    const result = attention(state, NOW)

    expect(result.kind).toBe('VALIDATE_QUESTION')
    if (result.kind !== 'VALIDATE_QUESTION') return
    // All teams together, so an inconsistent pair is hard to miss (PRD 3 §6.1).
    expect(result.items).toHaveLength(1)
  })

  it('is ADVANCE when nothing is wrong', () => {
    expect(
      kindOf(
        run([
          ...SETUP,
          { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
          { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE } },
        ]),
      ),
    ).toBe('ADVANCE')
  })

  /**
   * `LOCK` was missing from the suggestion union until slice 5, so an open question — the most
   * common state in a game — suggested `NEXT_QUESTION`, pointing the master past the thing the room
   * is currently answering.
   */
  it('suggests LOCK while a question is open, not NEXT_QUESTION', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
    ])
    const result = attention(state, NOW)
    expect(result.kind === 'ADVANCE' && result.suggestion).toBe('LOCK')
  })

  it('suggests REVEAL on a locked question and NEXT_QUESTION once revealed', () => {
    const locked = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE } },
    ])
    const revealed = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE } },
      { type: 'QUESTION_REVEALED', payload: { gameQuestionId: FREE } },
    ])

    const a = attention(locked, NOW)
    const b = attention(revealed, NOW)
    expect(a.kind === 'ADVANCE' && a.suggestion).toBe('REVEAL')
    expect(b.kind === 'ADVANCE' && b.suggestion).toBe('NEXT_QUESTION')
  })
})

describe('priority when conditions compete (PRD 3 §3.1)', () => {
  /** 1 beats 6: the room is silent and waiting; nothing outranks that. */
  it('puts ADJUDICATE_BUZZ above VALIDATE_QUESTION', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: BUZZ } },
      pendingAnswer(BUZZ, B),
      buzzOn(BUZZ, A),
    ])
    expect(kindOf(state)).toBe('ADJUDICATE_BUZZ')
  })

  /** 2 beats 5: once clocks are running, picking finalists is long settled. */
  it('puts FINALE_TURN above PICK_FINALISTS', () => {
    const state = run([
      ...SETUP,
      { type: 'ROUND_OPENED', payload: { gameRoundId: 'r3' } },
      { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 1, penaltySeconds: 20 } },
      { type: 'FINALISTS_SET', payload: { teamIds: [A, B] } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FIN } },
      { type: 'TURN_STARTED', payload: { teamId: A } },
    ])
    expect(kindOf(state)).toBe('FINALE_TURN')
  })

  /** 3 beats 6: teams are watching for a verdict on the challenge that just ended. */
  it('puts SCORE_DO above VALIDATE_QUESTION', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      pendingAnswer(FREE, A),
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: DO } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: DO } },
    ])
    expect(kindOf(state)).toBe('SCORE_DO')
    // …and the outstanding validation is still surfaced, but only as a count.
    expect(state.questions.get(FREE)?.answers.get(A)?.verdict).toBe('PENDING')
  })

  /** 6 beats 7: scores are not honest yet, even though nothing is blocked. */
  it('puts VALIDATE_QUESTION above ADVANCE', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      pendingAnswer(FREE, A),
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE } },
    ])
    expect(kindOf(state)).toBe('VALIDATE_QUESTION')
  })

  it('drops to ADVANCE once every answer is judged', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      pendingAnswer(FREE, A),
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE } },
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: FREE, teamId: A, accepted: false },
      },
    ])
    expect(kindOf(state)).toBe('ADVANCE')
  })

  /**
   * PRD 3 §11.2: *"while on break, `attention` stays `NONE`, so control shows the leaderboard"*.
   * Before slice 5 nothing here looked at the break at all, so an interval with unplayed questions
   * left still read as `ADVANCE` — a call to action pointed at a room that is at the bar.
   */
  it('drops to NONE during a break rather than urging the master on', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE } },
      { type: 'BREAK_STARTED', payload: { durationMs: 300_000 } },
    ])
    expect(kindOf(state)).toBe('NONE')

    // …and it is exactly a suspension: ending the break restores the same call to action.
    const resumed = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE } },
      { type: 'BREAK_STARTED', payload: { durationMs: 300_000 } },
      { type: 'BREAK_ENDED', payload: {} },
    ])
    expect(kindOf(resumed)).toBe('ADVANCE')
  })

  /**
   * The five urgent states keep their place: a break is refused while a question is `OPEN` (§11.2),
   * so `SCORE_DO` is the only one that can co-occur — and a room watching for a verdict outranks an
   * interval that has already started.
   */
  it('keeps SCORE_DO above a break', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: DO } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: DO } },
      { type: 'BREAK_STARTED', payload: { durationMs: 300_000 } },
    ])
    expect(kindOf(state)).toBe('SCORE_DO')
  })

  /** A skipped question awards nothing and needs nothing — it must not hold the master. */
  it('does not ask for validation on a skipped question', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      pendingAnswer(FREE, A),
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: FREE } },
    ])
    expect(kindOf(state)).not.toBe('VALIDATE_QUESTION')
  })
})

/**
 * PRD 3 §6.2's sweep, and D6's original promise: *"at the end of a `QUESTION_SET` round, the admin
 * is shown each question with each team's answer"*.
 *
 * Until slice 5 this did not exist. `attention` looked only at the current question, so an answer
 * deferred in question 1 became unreachable from the desk the moment question 2 opened — while
 * `pendingValidationCount` went on counting it, with nothing that could ever clear it.
 */
describe('the round-end validation sweep (§6.2)', () => {
  const deferredThenMovedOn: GameEvent[] = [
    ...SETUP,
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
    pendingAnswer(FREE, A),
    { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE } },
    { type: 'QUESTION_REVEALED', payload: { gameQuestionId: FREE } },
  ]

  it('comes back to an earlier question once the master is no longer mid-question', () => {
    const state = run([
      ...deferredThenMovedOn,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: BUZZ } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: BUZZ } },
      { type: 'QUESTION_REVEALED', payload: { gameQuestionId: BUZZ } },
    ])

    const result = attention(state, NOW)
    expect(result.kind).toBe('VALIDATE_QUESTION')
    if (result.kind !== 'VALIDATE_QUESTION') return
    // The earliest one still owed a verdict, so the sweep walks the quiz in play order.
    expect(result.gameQuestionId).toBe(FREE)
    expect(result.items).toHaveLength(1)
  })

  it('still surfaces it after the round has closed', () => {
    const state = run([
      ...deferredThenMovedOn,
      { type: 'ROUND_CLOSED', payload: { gameRoundId: 'r1' } },
    ])
    expect(kindOf(state)).toBe('VALIDATE_QUESTION')
  })

  /**
   * The rule that keeps the sweep from being a nuisance: an `OPEN` or `LOCKED` current question
   * means the master is working, and being pulled back to round 1 mid-question is worse than the
   * deferral it is trying to fix.
   */
  it('does not pull the master backwards while a question is open', () => {
    const state = run([
      ...deferredThenMovedOn,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: BUZZ } },
    ])
    const result = attention(state, NOW)
    expect(result.kind).toBe('ADVANCE')
    // …and the outstanding one is still counted, which is how it stays impossible to forget.
    expect(toMasterControlView(state, NOW).pendingValidationCount).toBe(1)
  })

  /**
   * The dead end, and the reason `advance` is on the view unconditionally.
   *
   * `VALIDATE_QUESTION` outranks `ADVANCE` and correctly sweeps the whole quiz, but the desk's way
   * forward was read from `timeline` — the **current round**. Once this round had no unplayed
   * question left and an earlier deferral was still outstanding, there was nothing to offer and no
   * `ADVANCE` state to fall back to, so the sweep rendered with no primary action at all. §6.2
   * promises the opposite: *"blocking the master from moving on would be the one thing worse than
   * provisional scores."*
   */
  it('still says how to move on while the sweep holds the attention zone', () => {
    const state = run([
      ...SETUP,
      // Every question in round 1 played, one of them with a verdict never given.
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      pendingAnswer(FREE, A),
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: FREE } },
      { type: 'QUESTION_REVEALED', payload: { gameQuestionId: FREE } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: BUZZ } },
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: BUZZ } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: DO } },
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: DO } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: PER_TEAM } },
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: PER_TEAM } },
    ])

    const view = toMasterControlView(state, NOW)
    // The sweep still has the zone, which is right — the verdict is still owed.
    expect(view.attention.kind).toBe('VALIDATE_QUESTION')
    // …and the desk is still told what advancing does, which is what unsticks it.
    expect(view.advance).toBe('NEXT_ROUND')
    expect(view.nextRoundId).toBe('r2')
    // Nothing left in this round to open, which is exactly the case that used to dead-end.
    expect(view.timeline.some((entry) => entry.state === 'PENDING')).toBe(false)
  })

  it('prefers the current question when both are owed a verdict', () => {
    const state = run([
      ...deferredThenMovedOn,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: BUZZ } },
      pendingAnswer(BUZZ, B),
    ])
    const result = attention(state, NOW)
    expect(result.kind === 'VALIDATE_QUESTION' && result.gameQuestionId).toBe(BUZZ)
    // `remainingQuestions` is what §6.2's "question 2 of 3" progress is built from.
    expect(result.kind === 'VALIDATE_QUESTION' && result.remainingQuestions).toBe(1)
  })

  it('does not ask for validation on a skipped question', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: FREE } },
      pendingAnswer(FREE, A),
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: FREE } },
    ])
    expect(kindOf(state)).not.toBe('VALIDATE_QUESTION')
  })
})
