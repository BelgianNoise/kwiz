import { describe, expect, it } from 'vitest'

import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState } from './state'
import { attention } from './views'

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
