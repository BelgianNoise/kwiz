'use client'

import type { MainScreenColourScheme } from '@kwiz/domain'

/**
 * PRD 4 §5.1 / D60 — the one piece of decorative chrome a colour scheme adds beyond CSS variables:
 * four static corner marks in the safe area's margin, never inside it (§2.1's "nothing meaningful
 * outside the 5% safe area" is about *content*; these mark nothing and sit in the margin on purpose).
 *
 * Static, not animated — presets are static-only (§5.1, §15): nothing here loops or transitions.
 * `QUIET` renders none at all, consistent with it spending no colour beyond the team dots.
 *
 * Rendered once per stage frame (`main-screen.tsx`, and any preview that wants full fidelity),
 * not per stage component — the marks belong to the theme, not to whichever stage happens to be
 * showing.
 */
export function ThemeChrome({ colourScheme }: { colourScheme: MainScreenColourScheme }) {
  if (colourScheme === 'QUIET') return null

  const corner = 'pointer-events-none absolute size-[3.5cqh] border-[var(--main-accent)]'

  return (
    <>
      <span
        aria-hidden
        className={`${corner} top-[3cqh] left-[3cqh] border-t-[0.3cqh] border-l-[0.3cqh]`}
      />
      <span
        aria-hidden
        className={`${corner} top-[3cqh] right-[3cqh] border-t-[0.3cqh] border-r-[0.3cqh]`}
      />
      <span
        aria-hidden
        className={`${corner} bottom-[3cqh] left-[3cqh] border-b-[0.3cqh] border-l-[0.3cqh]`}
      />
      <span
        aria-hidden
        className={`${corner} right-[3cqh] bottom-[3cqh] border-r-[0.3cqh] border-b-[0.3cqh]`}
      />
    </>
  )
}
