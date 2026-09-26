import { describe, expect, it } from 'vitest'

import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState } from './state'
import { toMainScreenView, toMasterControlView, toPlayerView } from './views'

/**
 * protocol §6.2 — **the sentinel leak test.**
 *
 * Field-by-field assertions only check the fields someone thought to check. A leak arrives through
 * a field nobody remembered: a nested object, a debug addition, a spread that picked up too much.
 *
 * So the primary defence is this — build a game whose secrets are distinctive strings, then assert
 * those strings appear **nowhere** in the serialised payload. It catches any path, however nested.
 *
 * **Add a sentinel when you add a secret.**
 *
 * *"A secret"* means something that must not cross an **audience boundary** — not every new payload
 * field. Slice 5 added eleven fields to `MasterControlView` (`timeline`, `adjustments`, `break`,
 * `scoreboardShown`, `controlScreens`, `finaleRanking`, `advance`, `missed`, `spotlit`,
 * `failsPreflight`, `clocks[].eliminatedAt`) and none of them appears below, which is correct: every
 * one is built only by `toMasterControlView`, the audience this table calls *"always allowed"*. The
 * table is not kept in lockstep with the master view, and does not need to be — what it guards is
 * the two filters that face a room and a phone. A field reaching **those** needs a row here.
 */

const SENTINELS = {
  correctAnswer: 'ZZ_SECRET_CORRECT_ANSWER_ZZ',
  masterNotes: 'ZZ_SECRET_MASTER_NOTES_ZZ',
  teamBAnswer: 'ZZ_SECRET_TEAM_B_ANSWER_ZZ',
  unopenedTile: 'ZZ_SECRET_UNOPENED_TILE_PROMPT_ZZ',
  finaleKeyword: 'ZZ_SECRET_UNMARKED_KEYWORD_ZZ',
} as const

const TEAM_A = 'team-a'
const TEAM_B = 'team-b'
const Q_FREE = 'q-free'
const Q_MC = 'q-mc'
const TILE = 'q-tile'
const Q_FINALE = 'q-finale'
const KEYWORD = 'kw-0'
const OPTION_CORRECT = 'opt-correct'

const question = (over: Partial<GameContent['rounds'][0]['questions'][0]>) => ({
  id: 'x',
  roundId: 'r1',
  categoryId: null,
  position: 0,
  prompt: 'A prompt',
  answerMethod: 'FREE_TEXT' as const,
  points: 10,
  timerMs: null,
  masterNotes: SENTINELS.masterNotes,
  config: {},
  acceptedAnswers: [SENTINELS.correctAnswer],
  options: [],
  keywords: [],
  media: [],
  ...over,
})

const content: GameContent = {
  gameId: 'game-1',
  quizName: 'Quiz',
  code: 'KWIZ01',
  defaultPlayerLocale: 'en',
  mainScreenColourScheme: 'BROADCAST',
  mainScreenTypography: 'IMPACT',
  rounds: [
    {
      id: 'r1',
      position: 0,
      type: 'QUESTION_SET',
      title: 'Round 1',
      defaultPoints: 10,
      defaultTimerMs: null,
      config: {},
      categories: [],
      questions: [
        question({ id: Q_FREE }),
        question({
          id: Q_MC,
          position: 1,
          answerMethod: 'MULTIPLE_CHOICE',
          options: [
            { id: 'opt-wrong', position: 0, text: 'Wrong', isCorrect: false },
            {
              id: OPTION_CORRECT,
              position: 1,
              text: SENTINELS.correctAnswer,
              isCorrect: true,
            },
          ],
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
      categories: [{ id: 'cat-1', position: 0, name: 'Category' }],
      questions: [
        // Never opened, so its prompt must never leave MASTER_CONTROL (invariant 5).
        question({
          id: TILE,
          roundId: 'r2',
          categoryId: 'cat-1',
          answerMethod: 'BUZZER',
          prompt: SENTINELS.unopenedTile,
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
        question({
          id: Q_FINALE,
          roundId: 'r3',
          answerMethod: 'KEYWORDS',
          keywords: [
            {
              id: KEYWORD,
              position: 0,
              text: SENTINELS.finaleKeyword,
              wordLengths: [3, 4],
            },
          ],
        }),
      ],
    },
  ],
}

let seq = 0
const log = (events: GameEvent[]): LoggedEvent[] =>
  events.map((event) => ({ seq: ++seq, event, createdAt: 1_000 + seq }))

const SETUP: GameEvent[] = [
  {
    type: 'TEAM_ADDED',
    payload: { teamId: TEAM_A, name: 'A', colour: '#EF4444', position: 0 },
  },
  {
    type: 'TEAM_ADDED',
    payload: { teamId: TEAM_B, name: 'B', colour: '#22D3EE', position: 1 },
  },
  { type: 'GAME_STARTED', payload: {} },
  { type: 'ROUND_OPENED', payload: { gameRoundId: 'r1' } },
]

const ANSWERS: GameEvent[] = [
  {
    type: 'ANSWER_SUBMITTED',
    payload: {
      gameQuestionId: Q_FREE,
      teamId: TEAM_A,
      text: 'team a guess',
      fromDraft: false,
      enteredByMaster: false,
    },
  },
  {
    type: 'ANSWER_SUBMITTED',
    payload: {
      gameQuestionId: Q_FREE,
      teamId: TEAM_B,
      // Team B's own words — never for A's eyes, in any state (invariant 3).
      text: SENTINELS.teamBAnswer,
      fromDraft: false,
      enteredByMaster: false,
    },
  },
]

/** The five question states, each reached by driving the real events. */
function gameAt(state: 'PENDING' | 'OPEN' | 'LOCKED' | 'REVEALED' | 'SCORED'): GameState {
  seq = 0
  const events: GameEvent[] = [...SETUP]

  // PENDING means the master has not opened it: nothing is the current question, so the prompt
  // cannot be in a view at all (invariant 6).
  if (state === 'PENDING') return reduce(content, log(events))

  events.push(
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q_FREE } },
    ...ANSWERS,
  )
  if (state === 'OPEN') return reduce(content, log(events))

  events.push({ type: 'QUESTION_LOCKED', payload: { gameQuestionId: Q_FREE } })
  if (state === 'LOCKED') return reduce(content, log(events))

  events.push({ type: 'QUESTION_REVEALED', payload: { gameQuestionId: Q_FREE } })
  // Spotlighting is the master's explicit act of pushing an answer to the room (D40) — and A's
  // answer being spotlit must still never expose B's.
  events.push({
    type: 'ANSWER_SPOTLIT',
    payload: { gameQuestionId: Q_FREE, teamId: TEAM_A, spotlit: true },
  })
  if (state === 'REVEALED') return reduce(content, log(events))

  events.push({ type: 'QUESTION_SCORED', payload: { gameQuestionId: Q_FREE } })
  return reduce(content, log(events))
}

const NOW = 5_000

const serialise = (
  audience: 'MAIN_SCREEN' | 'PLAYER_A' | 'PLAYER_B',
  state: GameState,
): string => {
  if (audience === 'MAIN_SCREEN') return JSON.stringify(toMainScreenView(state, NOW))
  return JSON.stringify(
    toPlayerView(state, audience === 'PLAYER_A' ? TEAM_A : TEAM_B, NOW),
  )
}

const STATES = ['PENDING', 'OPEN', 'LOCKED', 'REVEALED', 'SCORED'] as const
const AUDIENCES = ['MAIN_SCREEN', 'PLAYER_A', 'PLAYER_B'] as const

/**
 * The machine-readable form of PRD 1 §7's table. `true` means the secret must **not** appear.
 */
function forbiddenIn(
  audience: (typeof AUDIENCES)[number],
  state: (typeof STATES)[number],
): (keyof typeof SENTINELS)[] {
  const beforeReveal = state === 'PENDING' || state === 'OPEN' || state === 'LOCKED'
  const forbidden: (keyof typeof SENTINELS)[] = [
    // Always forbidden to both audiences, in every state.
    'masterNotes',
    'unopenedTile',
    'finaleKeyword',
  ]

  if (beforeReveal) forbidden.push('correctAnswer')

  // Team B's answer: forbidden to the room before REVEALED, and to player A *always*.
  if (audience === 'PLAYER_A') forbidden.push('teamBAnswer')
  else if (audience === 'MAIN_SCREEN' && beforeReveal) forbidden.push('teamBAnswer')

  return forbidden
}

describe('no secret reaches an audience that may not see it', () => {
  for (const state of STATES) {
    for (const audience of AUDIENCES) {
      const forbidden = forbiddenIn(audience, state)

      it.each(forbidden)(`${audience} at ${state} never leaks %s`, (secret) => {
        expect(serialise(audience, gameAt(state))).not.toContain(SENTINELS[secret])
      })
    }
  }
})

/**
 * The complement matters just as much: **a filter that returns nothing satisfies the table above
 * trivially.** These assert each secret does appear once it is permitted.
 */
describe('the permitted direction', () => {
  it('gives the room the correct answer at REVEALED', () => {
    expect(serialise('MAIN_SCREEN', gameAt('REVEALED'))).toContain(
      SENTINELS.correctAnswer,
    )
  })

  it('gives a player the correct answer at REVEALED', () => {
    expect(serialise('PLAYER_A', gameAt('REVEALED'))).toContain(SENTINELS.correctAnswer)
  })

  it('gives team B its own answer, in every state it has one', () => {
    for (const state of ['OPEN', 'LOCKED', 'REVEALED', 'SCORED'] as const) {
      expect(serialise('PLAYER_B', gameAt(state))).toContain(SENTINELS.teamBAnswer)
    }
  })

  /**
   * `PENDING` is excluded deliberately: nothing is the current question then, so there is no
   * question detail to carry notes — which is itself the reason the room cannot see a prompt at
   * that point (invariant 6).
   */
  it('gives the master everything, in every state with a live question', () => {
    for (const state of ['OPEN', 'LOCKED', 'REVEALED', 'SCORED'] as const) {
      const json = JSON.stringify(toMasterControlView(gameAt(state), NOW))
      expect(json).toContain(SENTINELS.masterNotes)
      expect(json).toContain(SENTINELS.correctAnswer)
    }
  })

  it('has no question detail at all while PENDING', () => {
    expect(toMasterControlView(gameAt('PENDING'), NOW).question).toBeNull()
  })

  it('gives the master an unopened tile prompt, which no one else may have', () => {
    const state = gameAt('OPEN')
    // The board only appears while a Jeopardy round is current, so drive to one.
    const withBoard = reduce(content, [
      ...log([...SETUP]),
      {
        seq: 99,
        event: { type: 'ROUND_CLOSED', payload: { gameRoundId: 'r1' } },
        createdAt: 9_000,
      },
      {
        seq: 100,
        event: { type: 'ROUND_OPENED', payload: { gameRoundId: 'r2' } },
        createdAt: 9_001,
      },
    ])

    expect(JSON.stringify(toMasterControlView(withBoard, NOW))).toContain(
      SENTINELS.unopenedTile,
    )
    // …and still not to the room, now that the board is actually on screen.
    expect(JSON.stringify(toMainScreenView(withBoard, NOW))).not.toContain(
      SENTINELS.unopenedTile,
    )
    expect(JSON.stringify(toPlayerView(withBoard, TEAM_A, NOW))).not.toContain(
      SENTINELS.unopenedTile,
    )
    expect(state.status).toBe('LIVE')
  })
})

/**
 * The Jeopardy board is mirrored to player devices (D16) precisely because it carries no question
 * text — so the board's own shape is worth asserting, not just the absence of a sentinel.
 */
describe('the Jeopardy board carries no prompt key at all', () => {
  const withBoard = reduce(content, [
    ...log([...SETUP]),
    {
      seq: 98,
      event: { type: 'ROUND_OPENED', payload: { gameRoundId: 'r2' } },
      createdAt: 9_000,
    },
  ])

  it.each(['MAIN_SCREEN', 'PLAYER_A'] as const)(
    '%s board tiles have no `prompt`',
    (audience) => {
      const view: {
        stage: { kind: string; board?: { tiles: Record<string, unknown>[] } }
      } = JSON.parse(serialise(audience, withBoard))
      expect(view.stage.kind).toBe('JEOPARDY_BOARD')
      for (const tile of view.stage.board?.tiles ?? []) {
        expect(Object.keys(tile)).not.toContain('prompt')
      }
    },
  )
})

/**
 * D53 / invariant 8 — the finale case. An unmarked keyword's payload carries the **shape** and no
 * `text` key whatsoever; blurring transmitted text in CSS would be a leak, not a filter.
 */
describe('finale keyword text', () => {
  const openFinale: GameEvent[] = [
    ...SETUP,
    { type: 'ROUND_OPENED', payload: { gameRoundId: 'r3' } },
    { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 1, penaltySeconds: 20 } },
    { type: 'FINALISTS_SET', payload: { teamIds: [TEAM_A, TEAM_B] } },
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q_FINALE } },
  ]

  /*
   * **Both audiences, every assertion.** The room and a phone funnel through the same `finaleView`,
   * so asserting only `MAIN_SCREEN` is correct-by-construction rather than proven — and PRD 5 §10.1
   * puts these tiles on a phone a metre from four people's faces, which is where a leak would
   * actually be read.
   */
  it('is absent — not empty, absent — while unmarked, to the room and to a phone', () => {
    seq = 0
    const state = reduce(content, log([...openFinale]))

    for (const audience of ['MAIN_SCREEN', 'PLAYER_A'] as const) {
      const view: { stage: { finale?: { keywords: Record<string, unknown>[] } } } =
        JSON.parse(serialise(audience, state))

      const keyword = view.stage.finale?.keywords[0]
      expect(keyword, audience).toBeDefined()
      expect(Object.keys(keyword ?? {}), audience).not.toContain('text')
      // The shape is what both get instead.
      expect(keyword?.wordLengths, audience).toEqual([3, 4])
    }
  })

  it('appears to the room and to a phone once marked', () => {
    seq = 0
    const state = reduce(
      content,
      log([
        ...openFinale,
        { type: 'TURN_STARTED', payload: { teamId: TEAM_A } },
        { type: 'KEYWORD_MARKED', payload: { gameKeywordId: KEYWORD, teamId: TEAM_A } },
      ]),
    )
    expect(serialise('MAIN_SCREEN', state)).toContain(SENTINELS.finaleKeyword)
    expect(serialise('PLAYER_A', state)).toContain(SENTINELS.finaleKeyword)
  })

  /** A revoked mark must take the text back off the wire (D41 reversing more than a score). */
  it('disappears again when the mark is revoked', () => {
    seq = 0
    const state = reduce(
      content,
      log([
        ...openFinale,
        { type: 'TURN_STARTED', payload: { teamId: TEAM_A } },
        { type: 'KEYWORD_MARKED', payload: { gameKeywordId: KEYWORD, teamId: TEAM_A } },
        { type: 'KEYWORD_UNMARKED', payload: { gameKeywordId: KEYWORD } },
      ]),
    )
    expect(serialise('MAIN_SCREEN', state)).not.toContain(SENTINELS.finaleKeyword)
    expect(serialise('PLAYER_A', state)).not.toContain(SENTINELS.finaleKeyword)
  })

  /**
   * The master reads the keywords off the turn desk in order to mark them — that is what
   * `FinaleTurnDetail.keywords` is for (protocol §5.5), and it is the one place keyword text is
   * transmitted before marking.
   */
  it('is visible to the master once a turn is running', () => {
    seq = 0
    const state = reduce(
      content,
      log([...openFinale, { type: 'TURN_STARTED', payload: { teamId: TEAM_A } }]),
    )
    const view = toMasterControlView(state, NOW)

    expect(view.attention.kind).toBe('FINALE_TURN')
    expect(JSON.stringify(view)).toContain(SENTINELS.finaleKeyword)
  })
})

/** MULTIPLE_CHOICE: the options are sent while OPEN, but never which one is correct (invariant 2). */
describe('option correctness', () => {
  const openMc = (): GameState => {
    seq = 0
    return reduce(
      content,
      log([...SETUP, { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q_MC } }]),
    )
  }

  it.each(['MAIN_SCREEN', 'PLAYER_A'] as const)(
    '%s options carry no isCorrect flag',
    (audience) => {
      const view: { stage: { question?: { options?: Record<string, unknown>[] } } } =
        JSON.parse(serialise(audience, openMc()))
      const options = view.stage.question?.options ?? []
      expect(options.length).toBe(2)
      for (const option of options) {
        expect(Object.keys(option)).not.toContain('isCorrect')
      }
    },
  )

  it('sends isCorrect to the master, and only to the master', () => {
    const json = JSON.stringify(toMasterControlView(openMc(), NOW))
    expect(json).toContain('isCorrect')
  })
})
