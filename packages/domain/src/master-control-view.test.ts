import { describe, expect, it } from 'vitest'

import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState, QuestionContent } from './state'
import { toMasterControlView } from './views'

/**
 * Code review dup #4 — `boardView()` (the main-screen/player board) sorts Jeopardy categories by
 * `position`; `toMasterControlView`'s own `board` branch built the identical shape without the
 * same sort, masked only by `packages/db` happening to query pre-sorted rows. `packages/domain`
 * is documented not to depend on that.
 */

const content: GameContent = {
  gameId: 'g',
  quizName: 'Q',
  code: 'K',
  defaultPlayerLocale: 'en',
  mainScreenColourScheme: 'BROADCAST',
  mainScreenTypography: 'IMPACT',
  rounds: [
    {
      id: 'r1',
      position: 0,
      type: 'JEOPARDY',
      title: 'Board',
      defaultPoints: 20,
      defaultTimerMs: null,
      config: { valueLadder: [20] },
      // Deliberately out of position order — a caller that queried without an ORDER BY is
      // exactly the case `packages/domain` must not depend on being absent.
      categories: [
        { id: 'cat-z', position: 1, name: 'Zeta' },
        { id: 'cat-a', position: 0, name: 'Alpha' },
      ],
      questions: [
        {
          id: 'q1',
          roundId: 'r1',
          categoryId: 'cat-a',
          position: 0,
          prompt: 'P1',
          answerMethod: 'BUZZER',
          points: 20,
          timerMs: null,
          masterNotes: null,
          config: {},
          acceptedAnswers: [],
          options: [],
          keywords: [],
          media: [],
        },
      ],
    },
  ],
}

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

/** A `QUESTION_SET` round: the timeline, the sweep and §11's adjustments all live here. */
const sheet: GameContent = {
  gameId: 'g',
  quizName: 'Q',
  code: 'K',
  defaultPlayerLocale: 'en',
  mainScreenColourScheme: 'BROADCAST',
  mainScreenTypography: 'IMPACT',
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
      // Out of position order for the same reason the board's categories are.
      questions: [
        question({ id: 'q3', position: 2 }),
        question({ id: 'q1', position: 0 }),
        // PRD 2 §10's `[Play anyway]`: a free-text question nothing can ever match (I5).
        question({ id: 'q2', position: 1, acceptedAnswers: [] }),
      ],
    },
  ],
}

const fold = (game: GameContent, events: GameEvent[]): GameState =>
  reduce(
    game,
    events.map((event, i): LoggedEvent => ({
      seq: i + 1,
      event,
      createdAt: 1_000 + i * 100,
    })),
  )

const run = (events: GameEvent[]): GameState => fold(content, events)

const TEAM_A: GameEvent = {
  type: 'TEAM_ADDED',
  payload: { teamId: 'a', name: 'A', colour: '#EF4444', position: 0 },
}
const TEAM_B: GameEvent = {
  type: 'TEAM_ADDED',
  payload: { teamId: 'b', name: 'B', colour: '#06B6D4', position: 1 },
}
const LIVE: GameEvent[] = [
  TEAM_A,
  TEAM_B,
  { type: 'GAME_STARTED', payload: {} },
  { type: 'ROUND_OPENED', payload: { gameRoundId: 'r1' } },
]

describe('toMasterControlView', () => {
  it("sorts the board's categories by position, not by however the caller happened to load them", () => {
    const state = run([
      {
        type: 'TEAM_ADDED',
        payload: { teamId: 'a', name: 'A', colour: '#EF4444', position: 0 },
      },
      { type: 'GAME_STARTED', payload: {} },
      { type: 'ROUND_OPENED', payload: { gameRoundId: 'r1' } },
    ])

    const view = toMasterControlView(state, 9_000)
    expect(view.board?.categories).toEqual([
      { id: 'cat-a', name: 'Alpha' },
      { id: 'cat-z', name: 'Zeta' },
    ])
  })
})

/**
 * PRD 3's desk needs more than protocol §5.4's first shape could express — a timeline, a break, a
 * status, an adjustment list to undo from. Each of these is a field the surface cannot be built
 * without, and every one of them was added in slice 5 with the spec.
 */
describe('the fields PRD 3 needs beyond the current question', () => {
  it('lists the round on the timeline in play order, marking state and the pre-flight ⚠ (§2.1)', () => {
    const state = fold(sheet, [
      ...LIVE,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q1' } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: 'q1' } },
      { type: 'QUESTION_REVEALED', payload: { gameQuestionId: 'q1' } },
    ])

    const view = toMasterControlView(state, 9_000)
    expect(view.timeline.map((entry) => entry.gameQuestionId)).toEqual(['q1', 'q2', 'q3'])
    expect(view.timeline.map((entry) => entry.state)).toEqual([
      'REVEALED',
      'PENDING',
      'PENDING',
    ])
    // The `⚠` a master pressed `[Play anyway]` past, re-derived rather than remembered.
    expect(view.timeline[1]?.failsPreflight).toBe('NO_ACCEPTED_ANSWER')
    expect(view.timeline[0]).not.toHaveProperty('failsPreflight')
    // No answer was ever submitted to q1, so there is nothing outstanding to flag either.
    expect(view.timeline[0]).not.toHaveProperty('hasUnjudgedAnswer')
  })

  /**
   * PRD 3 §3.1 — `VALIDATE_QUESTION` is priority 6, *"needed before scores are honest, but the
   * room isn't blocked"*: nothing stops a master revealing and scoring past a question that
   * still owes a verdict, and the round-end sweep is otherwise the only thing that ever catches
   * it. The timeline is what makes that visible before the sweep, rather than after.
   */
  it('flags a settled question that still owes a verdict, only once it is settled', () => {
    const submitWrong: GameEvent = {
      type: 'ANSWER_SUBMITTED',
      payload: {
        gameQuestionId: 'q1',
        teamId: 'a',
        text: 'no',
        fromDraft: false,
        enteredByMaster: false,
      },
    }

    // Still open: this is current work, already visible on the desk itself — flagging it here
    // too would just be the same fact said twice.
    const open = fold(sheet, [
      ...LIVE,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q1' } },
      submitWrong,
    ])
    expect(toMasterControlView(open, 9_000).timeline[0]).not.toHaveProperty(
      'hasUnjudgedAnswer',
    )

    // Locked, but not yet revealed: still the master's current business.
    const locked = fold(sheet, [
      ...LIVE,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q1' } },
      submitWrong,
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: 'q1' } },
    ])
    expect(toMasterControlView(locked, 9_000).timeline[0]).not.toHaveProperty(
      'hasUnjudgedAnswer',
    )

    // Revealed — the master has moved on, and the unjudged answer is now behind them.
    const revealed = fold(sheet, [
      ...LIVE,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q1' } },
      submitWrong,
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: 'q1' } },
      { type: 'QUESTION_REVEALED', payload: { gameQuestionId: 'q1' } },
    ])
    expect(toMasterControlView(revealed, 9_000).timeline[0]?.hasUnjudgedAnswer).toBe(true)

    // Judged — the flag clears the moment the master actually decides, with no further event
    // needed to say so (the same way `pendingValidationCount` already reacts to `ANSWER_VALIDATED`).
    const judged = fold(sheet, [
      ...LIVE,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q1' } },
      submitWrong,
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: 'q1' } },
      { type: 'QUESTION_REVEALED', payload: { gameQuestionId: 'q1' } },
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: 'q1', teamId: 'a', accepted: false },
      },
    ])
    expect(toMasterControlView(judged, 9_000).timeline[0]).not.toHaveProperty(
      'hasUnjudgedAnswer',
    )
  })

  it('carries the same ⚠ on the open question, so the desk and the timeline cannot disagree', () => {
    const state = fold(sheet, [
      ...LIVE,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q2' } },
    ])

    expect(toMasterControlView(state, 9_000).question?.failsPreflight).toBe(
      'NO_ACCEPTED_ANSWER',
    )
  })

  it('reports the break, so §11.2 can offer extend and resume while attention is NONE', () => {
    const state = fold(sheet, [
      ...LIVE,
      { type: 'BREAK_STARTED', payload: { durationMs: 300_000 } },
    ])

    const view = toMasterControlView(state, 9_000)
    expect(view.attention.kind).toBe('NONE')
    expect(view.break).not.toBeNull()
    expect(view.break?.resumesAt).toBe(view.break!.startedAt + 300_000)
  })

  it('lists recent adjustments newest first, keeping revoked ones visible (§11)', () => {
    const state = fold(sheet, [
      ...LIVE,
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-1',
          teamId: 'a',
          delta: 5,
          reason: 'best heckle',
          announced: true,
        },
      },
      {
        type: 'SCORE_ADJUSTED',
        payload: { adjustmentId: 'adj-2', teamId: 'b', delta: -10, announced: false },
      },
      { type: 'SCORE_ADJUSTMENT_REVOKED', payload: { adjustmentId: 'adj-1' } },
    ])

    const view = toMasterControlView(state, 9_000)
    expect(view.adjustments.map((a) => a.id)).toEqual(['adj-2', 'adj-1'])
    // A master who undid the wrong one has to be able to see that they did.
    expect(view.adjustments.find((a) => a.id === 'adj-1')?.revoked).toBe(true)
    expect(view.adjustments.find((a) => a.id === 'adj-2')).toMatchObject({
      delta: -10,
      reason: null,
      announced: false,
      revoked: false,
    })
  })

  it('reports which answers are on the projector, so §5.3’s toggle can show its own state', () => {
    const state = fold(sheet, [
      ...LIVE,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q1' } },
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: 'q1',
          teamId: 'a',
          text: 'yes',
          fromDraft: false,
          enteredByMaster: false,
        },
      },
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: 'q1',
          teamId: 'b',
          text: 'no',
          fromDraft: false,
          enteredByMaster: false,
        },
      },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: 'q1' } },
      { type: 'QUESTION_REVEALED', payload: { gameQuestionId: 'q1' } },
      {
        type: 'ANSWER_SPOTLIT',
        payload: { gameQuestionId: 'q1', teamId: 'b', spotlit: true },
      },
    ])

    const answers = toMasterControlView(state, 9_000).question?.teamAnswers ?? []
    expect(answers.find((item) => item.teamId === 'b')?.spotlit).toBe(true)
    expect(answers.find((item) => item.teamId === 'a')?.spotlit).toBe(false)
  })

  it('reports the game status, the round type and the scoreboard toggle', () => {
    const state = fold(sheet, [
      ...LIVE,
      { type: 'SCOREBOARD_TOGGLED', payload: { shown: true } },
    ])

    const view = toMasterControlView(state, 9_000)
    expect(view.status).toBe('LIVE')
    expect(view.round?.type).toBe('QUESTION_SET')
    expect(view.scoreboardShown).toBe(true)
  })

  /**
   * protocol §5.4 declares a `QuestionRef` on `VALIDATE_QUESTION` and the first implementation
   * flattened it to the id. §6.1's screen is *"judge these answers against these accepted ones"* —
   * without the reference it asks for a verdict with the evidence on another page, and the sweep can
   * be about a question from an earlier round, so nothing else on the view can supply it.
   */
  it('carries the question being validated, not just its id (§6.1)', () => {
    const state = fold(sheet, [
      ...LIVE,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q1' } },
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: 'q1',
          teamId: 'a',
          text: 'maybe',
          fromDraft: false,
          enteredByMaster: false,
        },
      },
    ])

    const attention = toMasterControlView(state, 9_000).attention
    expect(attention.kind).toBe('VALIDATE_QUESTION')
    if (attention.kind !== 'VALIDATE_QUESTION') return
    expect(attention.prompt).toBe('prompt q1')
    expect(attention.acceptedAnswers).toEqual(['yes'])
    expect(attention.masterNotes).toBeNull()
  })

  /**
   * PRD 2 §11.2 — `[+ Add team]` is required from master control at every status, and the dialog's
   * whole justification is that these numbers are computed rather than worked out in a noisy room.
   */
  it('carries what a late team would have missed, and nothing before the game starts', () => {
    const setup = fold(sheet, [TEAM_A, TEAM_B])
    expect(toMasterControlView(setup, 9_000).missed).toBeNull()

    const played = fold(sheet, [
      ...LIVE,
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: 'q1' } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: 'q1' } },
    ])
    const missed = toMasterControlView(played, 9_000).missed
    expect(missed?.questions).toBe(1)
    expect(missed?.points).toBe(10)
    // Suggested, never imposed: half of what they missed, rounded down (§11.2).
    expect(missed?.suggestedStartingScore).toBe(5)
  })

  /**
   * §12's indicator is a fact about sockets, so it is passed in. Zero — the default — is what a
   * caller that knows nothing produces, which is why the indicator only ever appears above one.
   */
  it('passes the control-screen count through rather than inventing it', () => {
    const state = fold(sheet, LIVE)
    expect(toMasterControlView(state, 9_000).controlScreens).toBe(0)
    expect(toMasterControlView(state, 9_000, '', 2).controlScreens).toBe(2)
  })
})
