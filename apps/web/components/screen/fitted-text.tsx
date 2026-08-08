'use client'

import { useLayoutEffect, useRef, useState } from 'react'

/**
 * PRD 4 §2.4 — **prompt text is fitted to its box, not sized.**
 *
 * Prompts run from three words to three sentences, and Dutch is 20–30% longer than English while
 * being this surface's layout baseline (PRD 1 §9.2). A fixed size is therefore wrong for one of
 * those cases whichever size is chosen.
 *
 * Two rules from §2.4, both load-bearing:
 *
 * - **The floor is §2.1's absolute 4vh minimum**, and text that would need to be smaller does not
 *   get smaller. It stops at the floor and overflows, because a prompt the back tables cannot read
 *   is not a rendering problem to be solved quietly — it is a content problem, and pre-flight warns
 *   about over-long prompts at authoring time (PRD 2 §10) precisely so it is caught before the room.
 * - **Deterministic and layout-only.** Same string, same box, same result, with no animation of the
 *   fit — otherwise text visibly jumps on every re-render, on a screen ten metres from an audience.
 *
 * The search is a binary search over the size range, in `useLayoutEffect` so the browser never paints
 * an unfitted frame. Roughly six measurements for a 4–14 range at 0.25 precision.
 */
export function FittedText({
  children,
  /** In `cqh` — 1% of the stage's height. See `StageFrame` for why not `vh`. */
  max,
  min = 4,
  className = '',
}: {
  children: string
  max: number
  min?: number
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(max)

  useLayoutEffect(() => {
    const element = box.current?.firstElementChild
    const container = box.current
    if (!element || !(element instanceof HTMLElement) || !container) return

    let low = min
    let high = max
    let best = min

    /*
     * Height is the real test once the paragraph is full-width: it wraps at the container's width, so
     * "too big" shows up as more lines than fit. The width test then catches only the case wrapping
     * cannot solve — a single word longer than the box.
     *
     * The paragraph **must** be `w-full` for this to be true. As a shrink-to-fit flex item it sizes
     * to its content instead of wrapping, so `scrollWidth` exceeds the container at almost any size
     * and every prompt gets fitted far smaller than it should be — which is what happened here first:
     * a short prompt that belongs at 14cqh was being drawn at 9.
     */
    const fits = (candidate: number): boolean => {
      element.style.fontSize = `${candidate}cqh`
      return (
        element.scrollHeight <= container.clientHeight + 1 &&
        element.scrollWidth <= element.clientWidth + 1
      )
    }

    if (fits(max)) {
      best = max
    } else {
      while (high - low > 0.25) {
        const mid = (low + high) / 2
        if (fits(mid)) {
          best = mid
          low = mid
        } else {
          high = mid
        }
      }
    }

    element.style.fontSize = `${best}cqh`
    setSize(best)
  }, [children, max, min])

  return (
    <div
      ref={box}
      className="flex h-full w-full items-center justify-center overflow-hidden"
    >
      {/* `text-balance` keeps the last line from being one orphaned word at this scale. */}
      <p
        className={`w-full text-center leading-tight text-balance ${className}`}
        style={{ fontSize: `${size}cqh` }}
      >
        {children}
      </p>
    </div>
  )
}
