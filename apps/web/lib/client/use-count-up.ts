'use client'

import { useEffect, useRef, useState } from 'react'

import { usePrefersReducedMotion } from '@/lib/client/use-screen-chrome'

/**
 * PRD 4 §15 — *"numbers count up rather than snapping. A score changing from 290 to 340 should be
 * **seen** changing."*
 *
 * That clause is doing the same job as everything else in §15's table: making a change noticeable to
 * someone who was looking at their phone (§1.1). A score that snaps between two renders is a change
 * only the people already watching the right row will register, and the leaderboard is precisely the
 * moment the room is *not* watching a specific row.
 *
 * **Honours `prefers-reduced-motion` by snapping**, which is the one accommodation §15 names for this
 * case and a thing CSS could not have done here: the value is a number in a component, not a property
 * to transition. That is exactly why `usePrefersReducedMotion` was written, and wiring it here is what
 * closes the gap between the hook existing and the hook doing anything.
 */

/** Long enough to be seen, short enough that the room is not waiting on arithmetic. */
const COUNT_UP_MS = 600

export function useCountUp(target: number): number {
  const reduced = usePrefersReducedMotion()
  const [shown, setShown] = useState(target)
  const from = useRef(target)

  useEffect(() => {
    if (reduced || from.current === target) {
      from.current = target
      setShown(target)
      return undefined
    }

    const start = from.current
    const distance = target - start
    const began = performance.now()
    let frame = 0

    const step = (now: number): void => {
      const progress = Math.min(1, (now - began) / COUNT_UP_MS)
      // Eased out, so it settles rather than stopping dead — a linear count reads as a slot machine.
      const eased = 1 - (1 - progress) ** 3
      setShown(Math.round(start + distance * eased))
      if (progress < 1) frame = requestAnimationFrame(step)
      else from.current = target
    }

    frame = requestAnimationFrame(step)

    /*
     * **The number always arrives, animated or not.**
     *
     * `requestAnimationFrame` does not run in a tab the browser is not painting — a projector on a
     * background tab or second desktop, or an embedder that composites lazily. Without this the score
     * would simply never leave its first-mounted value: the room would be looking at a stale number
     * with nothing wrong on screen to suggest it, which is far worse than an unanimated one.
     *
     * Found while verifying §15 in a pane that does not composite, which is exactly the environment
     * that would otherwise never have shown it.
     */
    const settle = setTimeout(() => {
      from.current = target
      setShown(target)
    }, COUNT_UP_MS + 200)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settle)
      // Whatever was on screen becomes the next tween's start, so an interrupted count — a second
      // adjustment landing mid-animation — continues from where the room can see it, not from a
      // number that was never shown.
      from.current = target
    }
  }, [target, reduced])

  return shown
}
