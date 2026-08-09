import { describe, expect, it } from 'vitest'

import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState } from './state'
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

const run = (events: GameEvent[]): GameState =>
  reduce(
    content,
    events.map((event, i): LoggedEvent => ({
      seq: i + 1,
      event,
      createdAt: 1_000 + i * 100,
    })),
  )

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
