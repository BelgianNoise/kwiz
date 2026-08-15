import type { FinaleView } from '@kwiz/domain'
import { describe, expect, it } from 'vitest'

import {
  markedCount,
  newlyEliminated,
  shouldFlashPenalty,
  type Clock,
} from '@/components/screen/finale-moments'

/**
 * **The two decisions slice 6's own log named as most wanting coverage, and could not write.**
 *
 * They are near-identical in shape — "newly true" beside "count increased" — and exactly one of them
 * was wrong. `useEliminationMoment` used `.find()`, so when a single keyword's penalty took several
 * finalists to zero at once, only the first got §12.4's moment and the rest could never get one: the
 * same update had already recorded their ids as seen. They just greyed out of the strip, which is
 * precisely the failure §12.4 exists to prevent.
 *
 * Two things had to change before this file could exist. `vitest` now resolves `@/`, and the decisions
 * are pure functions rather than logic buried in a `useEffect` — the second mattering more than the
 * first, since it is the difference between a literal-array fixture and a React renderer plus two new
 * dependencies for four lines of set arithmetic (CLAUDE.md §6).
 */

const clock = (over: Partial<Clock> & Pick<Clock, 'teamId'>): Clock => ({
  name: over.teamId,
  colour: '#EF4444',
  secondsAtTurnStart: 60,
  onTurn: false,
  eliminated: false,
  eliminatedAt: null,
  ...over,
})

const out = (teamId: string, at: number): Clock =>
  clock({ teamId, eliminated: true, eliminatedAt: at })

describe('newlyEliminated', () => {
  it('announces nothing on the first view, however many teams are already out', () => {
    // A screen connecting to a round in progress *missed* those moments, and a reconnect must never
    // replay one. `null` is the whole of that rule.
    expect(newlyEliminated(null, [out('a', 1_000), clock({ teamId: 'b' })])).toEqual([])
  })

  it('announces a team that goes out while the screen is watching', () => {
    const seen = new Set<string>()
    const fresh = newlyEliminated(seen, [out('a', 2_000), clock({ teamId: 'b' })])
    expect(fresh.map((c) => c.teamId)).toEqual(['a'])
  })

  /**
   * **The regression.** PRD 1 §8.8: *"two teams on identical seconds, taken to zero by the same
   * keyword's penalty, are eliminated at the same computed instant and tie."*
   */
  it('announces EVERY team eliminated by one update, not just the first', () => {
    const fresh = newlyEliminated(new Set(), [
      clock({ teamId: 'a' }),
      out('b', 3_000),
      out('c', 3_000),
    ])
    expect(fresh.map((c) => c.teamId)).toEqual(['b', 'c'])
  })

  /** §8.8's degenerate case: one keyword ends the round with no winner at all. */
  it('handles every finalist going out at once', () => {
    expect(newlyEliminated(new Set(), [out('a', 4_000), out('b', 4_000)])).toHaveLength(2)
  })

  it('stays quiet about a team it has already announced', () => {
    const seen = new Set(['a'])
    // A later view — a clock ticked, nothing else. `a` is still out and must not be re-announced.
    expect(
      newlyEliminated(seen, [
        out('a', 5_000),
        clock({ teamId: 'b', secondsAtTurnStart: 40 }),
      ]),
    ).toEqual([])
  })

  it('ignores a team marked eliminated with no instant, which is not an announcement', () => {
    // `eliminatedAt` is the fact; `eliminated` is a convenience beside it. Only the instant can
    // distinguish a fresh elimination from one already seen, which is why it went on the payload.
    expect(
      newlyEliminated(new Set(), [clock({ teamId: 'a', eliminated: true })]),
    ).toEqual([])
  })
})

const keyword = (id: string, marked: boolean): FinaleView['keywords'][number] => ({
  id,
  position: 0,
  wordLengths: [8],
  ...(marked ? { text: 'Thriller', teamId: 'a' } : {}),
})

describe('shouldFlashPenalty', () => {
  it('is silent on the first view, however many keywords are already marked', () => {
    // A reconnect holding three marked keywords must not flash three penalties at the room.
    expect(shouldFlashPenalty(null, 3)).toBe(false)
  })

  it('flashes when a keyword is marked', () => {
    expect(shouldFlashPenalty(1, 2)).toBe(true)
  })

  /**
   * §10.4's un-mark returns the penalty to everyone it was taken from. A `−20s` beside a clock that
   * just went *up* would say the opposite of what happened — the distinction slice 6's log called the
   * highest-value thing to get right, and the reason its twin being wrong was so easy to miss.
   */
  it('does not flash on an un-mark', () => {
    expect(shouldFlashPenalty(2, 1)).toBe(false)
  })

  it('does not flash when nothing changed', () => {
    expect(shouldFlashPenalty(2, 2)).toBe(false)
  })
})

describe('markedCount', () => {
  it('counts resolved keywords, which is what a penalty is charged for', () => {
    expect(
      markedCount([keyword('1', true), keyword('2', false), keyword('3', true)]),
    ).toBe(2)
  })
})
