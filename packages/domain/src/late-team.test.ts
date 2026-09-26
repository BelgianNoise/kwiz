import { describe, expect, it } from 'vitest'

import type { GameEvent } from './events/payload'
import { missedSoFar } from './late-team'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent } from './state'

/**
 * PRD 2 §11.2 / O5 — the arithmetic a master is not asked to do in a noisy room.
 *
 * The numbers matter because they change a decision: whether to give a late team an opening score,
 * and how much. Getting them wrong is invisible until the end of the night, when a team turns out
 * to have been unable to win.
 */

const q = (id: string, position: number, points: number) => ({
  id,
  roundId: 'r1',
  categoryId: null,
  position,
  prompt: id,
  answerMethod: 'FREE_TEXT' as const,
  points,
  timerMs: null,
  masterNotes: null,
  config: {},
  acceptedAnswers: ['x'],
  options: [],
  keywords: [],
  media: [],
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
      questions: [q('q1', 0, 10), q('q2', 1, 20), q('q3', 2, 30)],
    },
    {
      // Its questions award seconds, not points (D51), so they must contribute nothing.
      id: 'r2',
      position: 1,
      type: 'DSMTW_FINALE',
      title: 'Finale',
      defaultPoints: 0,
      defaultTimerMs: null,
      config: { secondsPerPoint: 1, penaltySeconds: 20 },
      categories: [],
      questions: [
        {
          ...q('fin', 0, 100),
          roundId: 'r2',
          answerMethod: 'KEYWORDS' as const,
          keywords: [0, 1, 2, 3, 4].map((n) => ({
            id: `kw-${n}`,
            position: n,
            text: `kw ${n}`,
            wordLengths: [2],
          })),
        },
      ],
    },
  ],
}

const state = (events: GameEvent[]) =>
  reduce(
    content,
    events.map((event, index): LoggedEvent => ({
      seq: index + 1,
      event,
      createdAt: 1000 + index,
    })),
  )

const played = (id: string): GameEvent[] => [
  { type: 'QUESTION_OPENED', payload: { gameQuestionId: id } },
  { type: 'QUESTION_LOCKED', payload: { gameQuestionId: id } },
]

describe('what a late team has missed', () => {
  it('is nothing before anything has been played', () => {
    expect(missedSoFar(state([{ type: 'GAME_STARTED', payload: {} }]))).toMatchObject({
      questions: 0,
      points: 0,
      maximumPossible: 60,
      maximumPossibleForOthers: 60,
      suggestedStartingScore: 0,
    })
  })

  it('counts closed questions and their points, and lowers only the newcomer’s ceiling', () => {
    const current = state([
      { type: 'GAME_STARTED', payload: {} },
      ...played('q1'),
      ...played('q2'),
    ])

    expect(missedSoFar(current)).toMatchObject({
      questions: 2,
      points: 30,
      // They can still reach q3 only…
      maximumPossible: 30,
      // …while everyone else could have had all three.
      maximumPossibleForOthers: 60,
      // §11.2 — half of what they missed, rounded down.
      suggestedStartingScore: 15,
    })
  })

  it('does not count an open question as missed — it is still answerable', () => {
    const current = state([
      { type: 'GAME_STARTED', payload: {} },
      ...played('q1'),
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q2' } },
    ])

    expect(missedSoFar(current)).toMatchObject({ questions: 1, points: 10 })
  })

  /**
   * A skipped question (D46) is unreachable for **everyone**, so it must come off both ceilings.
   * Counting it against the newcomer alone would report a gap that does not exist and push a master
   * toward compensating for nothing.
   */
  it('treats a skipped question as lost to the whole room, not just the newcomer', () => {
    const current = state([
      { type: 'GAME_STARTED', payload: {} },
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: 'q3' } },
    ])

    const result = missedSoFar(current)
    expect(result.questions).toBe(1)
    expect(result.maximumPossible).toBe(30)
    expect(result.maximumPossibleForOthers).toBe(30)
  })

  /** D51 — a finale question awards seconds. Counting its points would invent a debt. */
  it('ignores the finale entirely', () => {
    const current = state([
      { type: 'GAME_STARTED', payload: {} },
      ...played('q1'),
      ...played('fin'),
    ])

    const result = missedSoFar(current)
    // Two questions are closed, but only `q1` was worth anything.
    expect(result.questions).toBe(2)
    expect(result.points).toBe(10)
    expect(result.maximumPossibleForOthers).toBe(60)
  })
})
