'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The 16:9 stage, at a **fixed 1920×1080** and scaled to fit whatever it is put in.
 *
 * This is PRD 4 §2.2's letterbox rule made mechanical: *"design for 16:9. On other ratios, letterbox
 * the 16:9 stage rather than reflowing. A layout that reflows per projector cannot be designed or
 * tested."* One box, one set of proportions, scaled — never re-laid-out.
 *
 * It is also what makes PRD 2 §7.1's preview honest. A stage rendered at laptop size in a dialog
 * would not answer the question the preview exists to answer, because the failure being hunted is
 * *"does this prompt overflow at projector scale?"* — which is a question about proportions. Scaling
 * a fixed frame preserves them exactly; re-rendering into a smaller box does not.
 *
 * **Sizes inside use `cqh`, not `vh`.** A `transform: scale()` does not change what `vh` means — it
 * stays relative to the viewport — so `5vh` inside a scaled frame would be the wrong size in the
 * preview and right on the projector, which is the one discrepancy this component must not have.
 * `container-type: size` makes `1cqh` exactly 1% of *this box*, so every number in PRD 4 §2.1
 * transcribes directly and means the same thing in both places.
 */
export const STAGE_WIDTH = 1920
export const STAGE_HEIGHT = 1080

export function StageFrame({
  children,
  /** `fill` scales to the parent (the real projector). `fixed` uses an explicit width (the preview). */
  width,
}: {
  children: React.ReactNode
  width?: number
}) {
  const host = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(width ? width / STAGE_WIDTH : 1)

  useEffect(() => {
    if (width !== undefined) return undefined

    const element = host.current
    if (!element) return undefined

    // Observed rather than measured once: a projector being plugged in resizes the window, and the
    // stage has to still be the whole image afterwards.
    const observer = new ResizeObserver(() => {
      const { width: w, height: h } = element.getBoundingClientRect()
      // The smaller ratio wins — that is the letterbox.
      setScale(Math.min(w / STAGE_WIDTH, h / STAGE_HEIGHT))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [width])

  const scaled = { width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }

  return (
    <div
      ref={host}
      className="flex items-center justify-center overflow-hidden bg-black"
      style={width === undefined ? { width: '100%', height: '100%' } : scaled}
    >
      {/*
        The outer box reserves the scaled footprint so the layout above does not have to know about
        the transform; the inner box is always 1920×1080 and always scaled from its top-left.
      */}
      <div style={scaled} className="relative">
        <div
          style={{
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            containerType: 'size',
          }}
          className="absolute top-0 left-0"
        >
          {children}
        </div>
      </div>
    </div>
  )
}
