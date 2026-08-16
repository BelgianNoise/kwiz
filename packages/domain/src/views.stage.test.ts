import { describe, expect, it } from 'vitest'

import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState } from './state'
import { toMainScreenView, toPlayerView, type DraftLookup } from './views'

/**
 * Stage resolution, and the two rules that are easy to get wrong: a **skipped** question must not
 * present as an open one, and a team's **draft** must reach every one of its devices (D45).
 */

const A = 'a'
const B = 'b'
const Q1 = 'q1'
const Q2 = 'q2'

const content: GameContent = {
  gameId: 'g',
  quizName: 'Q',
  code: 'K',
  defaultPlayerLocale: 'nl',
  rounds: [
    {
      id: 'r1',
      position: 0,
      type: 'QUESTION_SET',
      title: 'Round One',
      defaultPoints: 10,
      defaultTimerMs: null,
      config: {},
      categories: [],
      questions: [Q1, Q2].map((id, position) => ({
        id,
        roundId: 'r1',
        categoryId: null,
        position,
        prompt: `Prompt ${id}`,
        answerMethod: 'FREE_TEXT' as const,
        points: 10,
        timerMs: null,
        masterNotes: null,
        config: {},
        acceptedAnswers: ['paris'],
        options: [],
        keywords: [],
        media: [],
      })),
    },
  ],
}

const run = (events: GameEvent[]): GameState =>
  reduce(
    content,
    events.map((event, i): LoggedEvent => ({
      seq: i + 1,
      event,
      createdAt: 1_000 + i * 10,
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

describe('stage resolution', () => {
  it('waits for players while SETUP', () => {
    const state = run([SETUP[0]!, SETUP[1]!])
    expect(toMainScreenView(state, NOW).stage.kind).toBe('WAITING_FOR_PLAYERS')
    expect(toPlayerView(state, A, NOW).stage.kind).toBe('WAITING')
  })

  it('shows the round intro to the room and between-questions to a phone', () => {
    const state = run(SETUP)
    expect(toMainScreenView(state, NOW).stage.kind).toBe('ROUND_INTRO')
    expect(toPlayerView(state, A, NOW).stage.kind).toBe('BETWEEN_QUESTIONS')
  })

  it('shows the question once opened', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
    ])
    expect(toMainScreenView(state, NOW).stage.kind).toBe('QUESTION')
    expect(toPlayerView(state, A, NOW).stage.kind).toBe('QUESTION')
  })

  /**
   * The bug this test exists for: skipping leaves `currentQuestionId` set — the master went around
   * it — so a naive stage resolver keeps presenting it, and `SKIPPED` has no visible state of its
   * own, so it would render as **`OPEN`**: a dead question that looks like it accepts answers.
   */
  it('stops presenting a question that has been skipped (D46)', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: Q1 } },
    ])

    expect(state.currentQuestionId).toBe(Q1)
    expect(toMainScreenView(state, NOW).stage.kind).toBe('ROUND_INTRO')
    expect(toPlayerView(state, A, NOW).stage.kind).toBe('BETWEEN_QUESTIONS')
  })

  it('does not leak a skipped question prompt to either audience', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: Q1 } },
    ])

    expect(JSON.stringify(toMainScreenView(state, NOW))).not.toContain('Prompt q1')
    expect(JSON.stringify(toPlayerView(state, A, NOW))).not.toContain('Prompt q1')
  })

  it('presents the next question normally after a skip', () => {
    const state = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: Q1 } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q2 } },
    ])
    expect(toMainScreenView(state, NOW).stage.kind).toBe('QUESTION')
  })

  it('shows a break to both, with the absolute resume instant (D7)', () => {
    const state = run([
      ...SETUP,
      { type: 'BREAK_STARTED', payload: { durationMs: 300_000 } },
    ])
    const stage = toMainScreenView(state, NOW).stage

    expect(stage.kind).toBe('BREAK')
    if (stage.kind !== 'BREAK') return
    // The event is the fifth, so its createdAt is 1_040 — and `resumesAt` is that plus the
    // duration, an **absolute** instant rather than a countdown. A screen connecting mid-break
    // therefore shows the right remaining time instead of restarting it (D7).
    expect(stage.resumesAt).toBe(301_040)
  })

  it('shows an open-ended break with no clock at all', () => {
    const state = run([...SETUP, { type: 'BREAK_STARTED', payload: {} }])
    const stage = toMainScreenView(state, NOW).stage
    expect(stage.kind === 'BREAK' && stage.resumesAt).toBeNull()
  })

  /** O4: the leaderboard is dismissed by the next question, not by a second master action. */
  it('clears a pushed scoreboard when the next question opens', () => {
    const shown = run([
      ...SETUP,
      { type: 'SCOREBOARD_TOGGLED', payload: { shown: true } },
    ])
    expect(toMainScreenView(shown, NOW).stage.kind).toBe('LEADERBOARD')

    const next = run([
      ...SETUP,
      { type: 'SCOREBOARD_TOGGLED', payload: { shown: true } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
    ])
    expect(toMainScreenView(next, NOW).stage.kind).toBe('QUESTION')
  })

  it('carries the game default locale to the player (D29)', () => {
    expect(toPlayerView(run(SETUP), A, NOW).locale).toBe('nl')
  })
})

describe('shared drafts (D45)', () => {
  const open = run([
    ...SETUP,
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
  ])

  const drafts = (text: string): DraftLookup => new Map([[Q1, { text, optionId: null }]])

  const myAnswerOf = (state: GameState, teamId: string, lookup?: DraftLookup) => {
    const stage = toPlayerView(state, teamId, NOW, lookup).stage
    return stage.kind === 'QUESTION' ? stage.myAnswer : null
  }

  it('is null when the team has neither draft nor submission', () => {
    expect(myAnswerOf(open, A)).toBeNull()
  })

  /**
   * The whole point of D45: a second device must see what the first one typed, or two phones on one
   * team diverge and the team submits whichever happens to win.
   */
  it('reaches a device that did not type it', () => {
    expect(myAnswerOf(open, A, drafts('par'))).toEqual({
      text: 'par',
      optionId: null,
      submitted: false,
      submittedAt: null,
    })
  })

  it('does not leak one team draft to another', () => {
    // The lookup is per-team by construction — B is rendered without A's.
    expect(myAnswerOf(open, B)).toBeNull()
  })

  /** Submission is final (D43), so once one exists the draft is stale by definition. */
  it('is superseded by a submission, which locks every device', () => {
    const submitted = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: Q1,
          teamId: A,
          text: 'paris',
          fromDraft: false,
          enteredByMaster: false,
        },
      },
    ])

    const mine = myAnswerOf(submitted, A, drafts('stale text'))
    expect(mine?.text).toBe('paris')
    expect(mine?.submitted).toBe(true)
  })

  /** D26: a draft the server committed at lock was never confirmed by the team. */
  it('reports a draft-committed submission as not submitted', () => {
    const committed = run([
      ...SETUP,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: Q1 } },
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: Q1,
          teamId: A,
          text: 'par',
          fromDraft: true,
          enteredByMaster: false,
        },
      },
    ])
    expect(myAnswerOf(committed, A)?.submitted).toBe(false)
  })

  it('omitting the lookup means no drafts, never "do not share them"', () => {
    // Same state, same team: the only difference is whether the caller supplied drafts.
    expect(myAnswerOf(open, A)).toBeNull()
    expect(myAnswerOf(open, A, drafts('x'))?.text).toBe('x')
  })
})

/**
 * PRD 5 §15 O3 — *"`ABANDONED` gets a bare message."*
 *
 * `stageKind` folds `ABANDONED` into `FINISHED` so a screen and a phone can never disagree about
 * what is *happening*; the flag is what stops a phone announcing a winner for a game the master
 * pulled. Same problem, same shape as the main screen's (PRD 4 §14).
 */
describe('an abandoned game', () => {
  const finished = run([...SETUP, { type: 'GAME_FINISHED', payload: {} }])
  const abandoned = run([...SETUP, { type: 'GAME_ABANDONED', payload: {} }])

  it('is flagged to the player, and a finished one is not', () => {
    expect(toPlayerView(abandoned, A, NOW).abandoned).toBe(true)
    expect(toPlayerView(finished, A, NOW).abandoned).toBe(false)
  })

  it('still resolves to FINISHED, because the fold is what keeps the surfaces agreeing', () => {
    expect(toPlayerView(abandoned, A, NOW).stage.kind).toBe('FINISHED')
  })
})
