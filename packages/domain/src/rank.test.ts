import { describe, expect, it } from 'vitest'

import { rankAmong, standings } from './derive'
import type { GameEvent } from './events/payload'
import { reduce, type LoggedEvent } from './reduce'
import type { GameContent, GameState } from './state'

/**
 * D32's shared ranks, and the fact that there are **two** places that apply them: `standings` for a
 * whole leaderboard, and `rankAmong` for the single team PRD 5 §11 shows on a phone.
 *
 * The last test is the one that matters — a phone and a projector disagreeing about a team's place
 * reads as a bug, and two independent implementations of a tie rule is how that happens.
 */

const content: GameContent = {
  gameId: 'g',
  quizName: 'Q',
  code: 'K',
  defaultPlayerLocale: 'en',
  rounds: [],
}

const scoreboard = (scores: number[]): GameState => {
  const events = scores.flatMap((score, i): GameEvent[] => [
    {
      type: 'TEAM_ADDED' as const,
      payload: { teamId: `t${i}`, name: `T${i}`, colour: '#EF4444', position: i },
    },
    {
      type: 'SCORE_ADJUSTED' as const,
      payload: {
        adjustmentId: `adj${i}`,
        teamId: `t${i}`,
        delta: score,
        announced: false,
      },
    },
  ])
  return reduce(
    content,
    events.map((event, i): LoggedEvent => ({ seq: i + 1, event, createdAt: 1_000 + i })),
  )
}

describe('rankAmong', () => {
  it('is first when nobody is ahead', () => {
    expect(rankAmong(100, [90, 80])).toBe(1)
  })

  it('counts only the scores strictly ahead', () => {
    expect(rankAmong(80, [100, 90])).toBe(3)
  })

  it('shares a rank on a tie rather than breaking it', () => {
    // Two teams level on 100 are both 1st, so the 90 behind them is 3rd — not 2nd.
    expect(rankAmong(100, [100, 90])).toBe(1)
    expect(rankAmong(90, [100, 100])).toBe(3)
  })

  it('is first for a lone team, and for a game where nobody has scored', () => {
    expect(rankAmong(0, [])).toBe(1)
    expect(rankAmong(0, [0, 0])).toBe(1)
  })

  /**
   * The anti-drift test. Every shape that has ever caused an off-by-one in a shared-rank rule: a
   * clean ladder, a tie at the top, a tie in the middle, a tie at the bottom, and everyone level.
   */
  it('agrees with `standings` on every team, for every shape of tie', () => {
    for (const scores of [
      [30, 20, 10],
      [30, 30, 10],
      [30, 20, 20, 10],
      [30, 10, 10],
      [10, 10, 10],
      [0],
    ]) {
      const table = standings(scoreboard(scores))
      for (const row of table) {
        const others = table
          .filter((other) => other.teamId !== row.teamId)
          .map((other) => other.score)
        expect(rankAmong(row.score, others), `scores ${scores.join(',')}`).toBe(row.rank)
      }
    }
  })
})
