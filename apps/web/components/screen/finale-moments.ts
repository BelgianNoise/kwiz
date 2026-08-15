'use client'

import type { FinaleView } from '@kwiz/domain'
import { FINALE_ELIMINATION_HOLD_MS, FINALE_PENALTY_FLASH_MS } from '@kwiz/domain'
import { useEffect, useRef, useState } from 'react'

/**
 * PRD 4 §12.3's penalty flash and §12.4's elimination moment — **the two things on this surface that
 * fire on a *change* rather than on a state.**
 *
 * Split out of `finale-stage.tsx` so they can be tested. They were the two pieces slice 6's own log
 * named as most wanting coverage, and the review round proved the point: they look nearly identical in
 * shape — "newly true" beside "count increased" — and only one of them was right. Nothing about a
 * rendered stage forced the distinction, and nothing could, because the difference is invisible until
 * several teams go out at once.
 */

export type Clock = FinaleView['clocks'][number]

/**
 * **The decision each hook makes, as a pure function** — which is where the bug was, and where the
 * test belongs.
 *
 * Testing the hooks themselves would have meant adding `jsdom` and a React testing library to a
 * dependency list conventions §1 keeps closed, to exercise four lines of set arithmetic through a
 * renderer. CLAUDE.md §6 calls that out by name: *"a large mock is a design signal, not a testing
 * problem"* — if a test needs an elaborate harness, the logic wants to be a pure function with a
 * literal fixture. It does, and these are it. The `useEffect` shells below are now thin enough that
 * there is nothing left in them to get wrong.
 */

/**
 * Every team that went out since the last view. Empty on the first view, whoever is already out.
 *
 * `previous === null` is a screen connecting to a round in progress: it **missed** those moments, and
 * inventing them would be worse than letting them pass. This is also what stops a reconnect replaying
 * an elimination from ten minutes ago.
 *
 * **A filter, not a find.** PRD 1 §8.8 defines the simultaneous case explicitly — *"two teams on
 * identical seconds, taken to zero by the same keyword's penalty, are eliminated at the same computed
 * instant and tie"* — up to the degenerate case where one keyword ends the round with no winner. A
 * `.find()` announced the first and silently dropped the rest, and they could never be announced
 * later, because the same update had already recorded their ids as seen.
 */
export function newlyEliminated(
  previous: ReadonlySet<string> | null,
  clocks: readonly Clock[],
): Clock[] {
  if (previous === null) return []
  return clocks.filter(
    (clock) => clock.eliminatedAt !== null && !previous.has(clock.teamId),
  )
}

/**
 * Whether §12.3's `−20s` should flash.
 *
 * Only on the way **up**. §10.4's un-mark returns the penalty to everyone it was taken from, and a
 * `−20s` beside a clock that just went *up* would say the opposite of what happened. The corrected
 * numbers still arrive on the next view, so the room sees the reversal — just without a label claiming
 * it was a charge.
 */
export function shouldFlashPenalty(previous: number | null, marked: number): boolean {
  return previous !== null && marked > previous
}

/** How many of a question's keywords are resolved — marked, or revealed unguessed. */
export function markedCount(keywords: readonly FinaleView['keywords'][number][]): number {
  return keywords.filter((keyword) => keyword.text !== undefined).length
}

/**
 * Who just went out, for the length of §12.4's hold. Empty while nothing is being announced.
 *
 * Detected from `eliminatedAt` **appearing**, not from `eliminated` being true — which is exactly why
 * that field went on the payload. A boolean cannot distinguish an elimination that just happened from
 * one this screen already announced, so a reconnect mid-round would replay the moment for a team that
 * went out ten minutes ago.
 *
 * `null` on the first view for the same reason: a screen connecting to a round already in progress has
 * missed those moments, and inventing them would be worse than letting them pass.
 *
 * **Returns every team eliminated by one update, not the first.** PRD 1 §8.8 defines the simultaneous
 * case explicitly — *"two teams on identical seconds, taken to zero by the same keyword's penalty, are
 * eliminated at the same computed instant and tie"*, up to the degenerate case where a single keyword
 * ends the round with no winner. This was a `.find()` until the slice-6 review: the first team got
 * §12.4's moment, and the rest could never get one, because the same effect run had already recorded
 * their ids as seen. They simply greyed out of the strip — *precisely* the failure §12.4 exists to
 * prevent, in the round's least recoverable moment.
 */
export function useEliminationMoment(clocks: Clock[]): Clock[] {
  const seen = useRef<Set<string> | null>(null)
  const [moment, setMoment] = useState<Clock[]>([])

  useEffect(() => {
    const out = new Set(
      clocks.filter((clock) => clock.eliminatedAt !== null).map((clock) => clock.teamId),
    )
    const previous = seen.current
    seen.current = out

    const fresh = newlyEliminated(previous, clocks)
    if (fresh.length === 0) return undefined

    /*
     * One hold naming all of them rather than a queue of holds. Two 2.5-second interruptions back to
     * back would take the room out of the round for five seconds at its tensest point, and D32's shape
     * is already "a shared position is shown as shared" everywhere else — the `FINISHED` screen puts
     * simultaneously eliminated teams on one rank, and §10.2's winner moment shares the line on a tie.
     */
    setMoment(fresh)
    const timer = setTimeout(() => setMoment([]), FINALE_ELIMINATION_HOLD_MS)
    return () => clearTimeout(timer)
  }, [clocks])

  return moment
}

/**
 * §12.3 — **the penalty moment.**
 *
 * *"When a keyword is marked, every other finalist loses time. That must be seen, or the room cannot
 * follow why a clock jumped: every other clock flashes and visibly subtracts — a brief `−20s` beside
 * each, then the new value. Counting down smoothly would hide the size of the hit; a jump with a label
 * shows it."*
 *
 * Triggered by the count of marked keywords **growing**, which is the same changed-not-true reasoning
 * as the elimination moment: a reconnect holding three marked keywords must not flash three penalties.
 *
 * Returns the penalty in seconds while the flash is live. Eliminated teams do not flash — they have
 * stopped paying — and that is enforced at the call site, which never renders a clock for them.
 */
export function usePenaltyFlash(
  keywords: FinaleView['keywords'],
  penaltySeconds: number,
): number | null {
  const marked = markedCount(keywords)
  const seen = useRef<number | null>(null)
  const [flash, setFlash] = useState<number | null>(null)

  useEffect(() => {
    const previous = seen.current
    seen.current = marked
    if (!shouldFlashPenalty(previous, marked)) return undefined

    setFlash(penaltySeconds)
    const timer = setTimeout(() => setFlash(null), FINALE_PENALTY_FLASH_MS)
    return () => clearTimeout(timer)
  }, [marked, penaltySeconds])

  return flash
}
