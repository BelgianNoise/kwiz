import { describe, expect, it } from 'vitest'

import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import { toGameReview } from './review'
import type { GameContent, GameState } from './state'

/**
 * PRD 2 §13 — the review, built from a literal event list because the whole point of the domain
 * being pure is that a played game is an array (CLAUDE.md §2.1). Nothing here mocks a database.
 *
 * The rules worth pinning: what counts as a **correction**, that a team who answered nothing still
 * gets a cell, and §13.2's three distinct keyword states.
 */

const A = 'team-a'
const B = 'team-b'
const Q1 = 'q1'
const Q2 = 'q2'
const F1 = 'f1'
const K = ['k1', 'k2', 'k3', 'k4', 'k5']

const content: GameContent = {
  gameId: 'g',
  quizName: 'Pub Quiz',
  code: 'KWIZ01',
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
      questions: [
        {
          id: Q1,
          roundId: 'r1',
          categoryId: null,
          position: 0,
          prompt: 'Who released "Kid A"?',
          answerMethod: 'FREE_TEXT' as const,
          points: 10,
          timerMs: null,
          masterNotes: null,
          config: {},
          acceptedAnswers: ['radiohead', 'kid a'],
          options: [],
          keywords: [],
          media: [],
        },
        {
          id: Q2,
          roundId: 'r1',
          categoryId: null,
          position: 1,
          prompt: 'Which band?',
          answerMethod: 'MULTIPLE_CHOICE' as const,
          points: 20,
          timerMs: null,
          masterNotes: null,
          config: {},
          acceptedAnswers: [],
          options: [
            { id: 'o1', position: 0, text: 'Blur', isCorrect: false },
            { id: 'o2', position: 1, text: 'Radiohead', isCorrect: true },
          ],
          keywords: [],
          media: [],
        },
      ],
    },
    {
      id: 'r2',
      position: 1,
      type: 'DSMTW_FINALE',
      title: 'What do you know about…',
      defaultPoints: 0,
      defaultTimerMs: null,
      config: {},
      categories: [],
      questions: [
        {
          id: F1,
          roundId: 'r2',
          categoryId: null,
          position: 0,
          prompt: 'Michael Jackson',
          answerMethod: 'KEYWORDS' as const,
          points: 0,
          timerMs: null,
          masterNotes: null,
          config: {},
          acceptedAnswers: [],
          options: [],
          keywords: K.map((id, position) => ({
            id,
            position,
            text: `keyword ${position}`,
            wordLengths: [7, 1],
          })),
          media: [],
        },
      ],
    },
  ],
}

let seq = 0
const run = (events: GameEvent[]): GameState => {
  seq = 0
  return reduce(
    content,
    events.map((event): LoggedEvent => {
      seq += 1
      return { seq, event, createdAt: 1_000 + seq * 1_000 }
    }),
  )
}

const SETUP: GameEvent[] = [
  {
    type: 'TEAM_ADDED',
    payload: { teamId: A, name: 'Quizzly', colour: '#EF4444', position: 0 },
  },
  {
    type: 'TEAM_ADDED',
    payload: { teamId: B, name: 'Norfolk', colour: '#22D3EE', position: 1 },
  },
  { type: 'GAME_STARTED', payload: {} },
  { type: 'ROUND_OPENED', payload: { gameRoundId: 'r1' } },
  { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
]

const answer = (teamId: string, text: string): GameEvent => ({
  type: 'ANSWER_SUBMITTED',
  payload: { gameQuestionId: Q1, teamId, text, fromDraft: false, enteredByMaster: false },
})

const validate = (teamId: string, accepted: boolean): GameEvent => ({
  type: 'ANSWER_VALIDATED',
  payload: { gameQuestionId: Q1, teamId, accepted },
})

const NOW = 900_000

describe('the review grid (§13.1)', () => {
  it('gives every team a cell, including one that never answered', () => {
    const review = toGameReview(run([...SETUP, answer(A, 'radiohead')]), NOW)
    const cells = review.rounds[0]?.questions[0]?.cells ?? []

    expect(cells).toHaveLength(2)
    // `AUTO_CORRECT`, not `ACCEPTED`: the match is the machine's, and a human has not confirmed it.
    // Keeping them distinct is what lets §13.1 count corrections without counting confirmations.
    expect(cells[0]).toMatchObject({
      teamId: A,
      answer: 'radiohead',
      verdict: 'AUTO_CORRECT',
      points: 10,
    })
    // The team that said nothing is a fact worth seeing next to the team that did.
    expect(cells[1]).toMatchObject({
      teamId: B,
      answer: null,
      verdict: 'PENDING',
      points: 0,
    })
  })

  it('shows the option text a team chose, never its id', () => {
    const review = toGameReview(
      run([
        ...SETUP,
        { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q2 } },
        {
          type: 'ANSWER_SUBMITTED',
          payload: {
            gameQuestionId: Q2,
            teamId: A,
            selectedOptionId: 'o1',
            fromDraft: false,
            enteredByMaster: false,
          },
        },
      ]),
      NOW,
    )
    expect(review.rounds[0]?.questions[1]?.cells[0]?.answer).toBe('Blur')
  })

  it('carries the canonical answer and the rest of the accepted list separately', () => {
    const question = toGameReview(run(SETUP), NOW).rounds[0]?.questions[0]
    expect(question?.correctAnswer).toBe('radiohead')
    expect(question?.alsoAccepted).toEqual(['kid a'])
  })

  it('leaves correctAnswer null where there is nothing written to be right about', () => {
    expect(
      toGameReview(run(SETUP), NOW).rounds[0]?.questions[1]?.correctAnswer,
    ).toBeNull()
  })

  it('leaves the finale round out of the grid — it has no answers to show', () => {
    const review = toGameReview(run(SETUP), NOW)
    expect(review.rounds.map((round) => round.id)).toEqual(['r1'])
  })
})

/**
 * The definition that matters. §13.1 marks corrected cells *"because an auditable correction is the
 * point"* — so it has to mean the master changed their mind, not that they judged an answer at all.
 */
describe('what counts as a correction (§13.1)', () => {
  it('does not count the first judgement of an unmatched answer', () => {
    // `Radio Head` does not match, so it lands PENDING (D22) and the master decides. That is the
    // job, not a correction.
    const review = toGameReview(
      run([...SETUP, answer(A, 'Radio Head'), validate(A, true)]),
      NOW,
    )
    expect(review.rounds[0]?.questions[0]?.cells[0]?.corrections).toBe(0)
    expect(review.corrections).toBe(0)
  })

  it('counts overturning an auto-accepted answer', () => {
    const review = toGameReview(
      run([...SETUP, answer(A, 'radiohead'), validate(A, false)]),
      NOW,
    )
    expect(review.rounds[0]?.questions[0]?.cells[0]).toMatchObject({
      verdict: 'DENIED',
      points: 0,
      corrections: 1,
    })
  })

  it('counts each flip, and rolls them up per round and per game', () => {
    const review = toGameReview(
      run([
        ...SETUP,
        answer(A, 'Radio Head'),
        answer(B, 'radiohead'),
        validate(A, true), // first judgement of a PENDING answer — not a correction
        validate(A, false), // changed their mind
        validate(B, false), // overturned an auto-accept
      ]),
      NOW,
    )

    expect(review.rounds[0]?.questions[0]?.cells[0]?.corrections).toBe(1)
    expect(review.rounds[0]?.questions[0]?.cells[1]?.corrections).toBe(1)
    expect(review.rounds[0]?.corrections).toBe(2)
    expect(review.corrections).toBe(2)
  })

  it('does not count re-affirming the same verdict', () => {
    const review = toGameReview(
      run([...SETUP, answer(A, 'radiohead'), validate(A, true), validate(A, true)]),
      NOW,
    )
    expect(review.rounds[0]?.questions[0]?.cells[0]?.corrections).toBe(0)
  })
})

describe('the adjustment audit (§13.3)', () => {
  const adjusted = run([
    ...SETUP,
    {
      type: 'SCORE_ADJUSTED',
      payload: {
        adjustmentId: 'adj1',
        teamId: A,
        delta: 5,
        reason: 'best heckle',
        announced: true,
      },
    },
    {
      type: 'SCORE_ADJUSTED',
      payload: { adjustmentId: 'adj2', teamId: B, delta: 50, announced: false },
    },
    { type: 'SCORE_ADJUSTMENT_REVOKED', payload: { adjustmentId: 'adj2' } },
  ])

  it('keeps a revoked row rather than deleting it (D41)', () => {
    const review = toGameReview(adjusted, NOW)
    expect(review.adjustments).toHaveLength(2)
    expect(review.adjustments[1]).toMatchObject({
      id: 'adj2',
      delta: 50,
      announced: false,
    })
    expect(review.adjustments[1]?.revokedAt).not.toBeNull()
  })

  it('excludes a revoked adjustment from the score it shows (I9)', () => {
    const review = toGameReview(adjusted, NOW)
    expect(review.teams.find((team) => team.id === A)?.score).toBe(5)
    expect(review.teams.find((team) => team.id === B)?.score).toBe(0)
  })
})

/**
 * §13.2's three keyword states. The distinction between *"nobody found it"* and *"the round never
 * got there"* is the one a naive implementation loses, and losing it misreports how far the round
 * actually ran.
 */
describe('the finale review (§13.2)', () => {
  const finale: GameEvent[] = [
    ...SETUP,
    { type: 'ROUND_OPENED', payload: { gameRoundId: 'r2' } },
    { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 1, penaltySeconds: 20 } },
    { type: 'FINALISTS_SET', payload: { teamIds: [A, B] } },
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: F1 } },
    { type: 'TURN_STARTED', payload: { teamId: A } },
    { type: 'KEYWORD_MARKED', payload: { gameKeywordId: K[0] ?? '', teamId: A } },
  ]

  it('names who got a keyword, and leaves an unreached one distinct from it', () => {
    const keywords = toGameReview(run(finale), NOW).finale?.questions[0]?.keywords ?? []

    expect(keywords[0]).toMatchObject({ teamId: A, reached: true, text: 'keyword 0' })
    // Never got there — **not** "nobody found it". The text is present because this is the master's
    // own record (CONFIG); it is `reached` that carries the distinction, not the absence of text.
    expect(keywords[1]).toMatchObject({ teamId: null, reached: false, text: 'keyword 1' })
  })

  it('puts an unmarked keyword back to unreached, so a revoke reverses the record too (D41)', () => {
    const keywords =
      toGameReview(
        run([
          ...finale,
          { type: 'KEYWORD_UNMARKED', payload: { gameKeywordId: K[0] ?? '' } },
        ]),
        NOW,
      ).finale?.questions[0]?.keywords ?? []

    expect(keywords[0]).toMatchObject({ teamId: null, reached: false })
  })

  /**
   * `KEYWORDS_REVEALED` covers the *whole question* at once (I21), which is what makes the two
   * states distinguishable at all: before it, an unmarked keyword was never reached; after it, every
   * unmarked one is `— nobody`.
   */
  it('turns every unmarked keyword into “nobody” once the question is revealed', () => {
    const keywords =
      toGameReview(
        run([...finale, { type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: F1 } }]),
        NOW,
      ).finale?.questions[0]?.keywords ?? []

    expect(keywords[0]).toMatchObject({ teamId: A, reached: true })
    expect(keywords[1]).toMatchObject({ teamId: null, reached: true, text: 'keyword 1' })
    expect(keywords[4]).toMatchObject({ teamId: null, reached: true, text: 'keyword 4' })
  })

  it('reports each finalist’s starting and remaining seconds', () => {
    const finalists = toGameReview(run(finale), NOW).finale?.finalists ?? []
    expect(finalists).toHaveLength(2)
    // Scores were zero at FINALISTS_SET, so both banks start at zero — the shape is what matters.
    expect(finalists[0]).toMatchObject({ teamId: A, startedSeconds: 0, survived: true })
  })

  it('names no winner while the round is unfinished', () => {
    expect(toGameReview(run(finale), NOW).finale?.wonByTeamId).toBeNull()
  })

  it('lists a team that did not play the finale rather than dropping it', () => {
    const review = toGameReview(
      run([
        ...SETUP,
        { type: 'ROUND_OPENED', payload: { gameRoundId: 'r2' } },
        { type: 'FINALISTS_SET', payload: { teamIds: [A] } },
      ]),
      NOW,
    )
    expect(review.finale?.nonFinalistIds).toEqual([B])
  })

  it('is absent entirely for a quiz with no finale round', () => {
    const noFinale: GameContent = {
      ...content,
      rounds: content.rounds.filter((round) => round.type !== 'DSMTW_FINALE'),
    }
    expect(toGameReview(reduce(noFinale, []), NOW).finale).toBeNull()
  })
})
