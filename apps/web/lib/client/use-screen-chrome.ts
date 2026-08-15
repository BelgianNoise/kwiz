'use client'

import { CURSOR_HIDE_MS } from '@kwiz/domain'
import { useEffect, useState } from 'react'

/**
 * PRD 4 §2.3 — **no chrome, ever.** *"The mouse cursor is hidden after 2 s of inactivity. The
 * language switcher appears only on mouse movement, then fades."*
 *
 * Both are the same signal, so they are one hook rather than two listeners: the audience must never
 * see application furniture, and a cursor parked in the middle of a projected image is furniture.
 *
 * Returns `true` for the brief window after the mouse moves. `false` — the state this surface is in
 * for essentially the whole quiz — hides the cursor and the switcher together.
 */
export function usePointerActive(): boolean {
  const [active, setActive] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const wake = (): void => {
      setActive(true)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setActive(false), CURSOR_HIDE_MS)
    }

    window.addEventListener('pointermove', wake)
    return () => {
      window.removeEventListener('pointermove', wake)
      if (timer) clearTimeout(timer)
    }
  }, [])

  return active
}

/**
 * PRD 4 §15 — *"`prefers-reduced-motion` is honoured. Crossfades replace movement; the timer ring
 * becomes stepwise."*
 *
 * Read in JS rather than left to a media query because two of this surface's motions are not CSS:
 * §12.3's penalty flash and §15's counting numbers are decided in a component, and a CSS-only
 * accommodation would quietly skip both.
 *
 * Watched rather than read once — someone can change the setting while a quiz is running, and the
 * whole point of the preference is that it takes effect.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)

    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/**
 * PRD 4 §4.1 / O4 — fullscreen, requested on a gesture and **re-requested silently** if it is ever
 * exited. *"Never show the room a prompt."*
 *
 * Separate from the sound arming even though one click satisfies both, because they fail
 * independently: a projector can have working audio and a browser that refuses fullscreen, and §4.1
 * only asks the master to be told about the sound.
 */
export async function requestFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
  } catch {
    // Refused, or unsupported. The stage letterboxes itself (§2.2), so a windowed projector is a
    // worse-looking version of the same screen rather than a broken one — and the audience must
    // never see a prompt about it.
  }
}
