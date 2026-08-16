'use client'

import { useEffect, useRef } from 'react'

/**
 * PRD 5 §12.1 / D48 — **keeping the phone awake.**
 *
 * *"A phone locking mid-question is the most common way a team loses a question they knew the answer
 * to."* So the screen is held awake — but **not** with the API you would reach for first.
 *
 * `navigator.wakeLock` requires a secure context and the LAN deployment is plain HTTP (PRD 1 §6.10):
 * on `http://192.168.1.42:3000` it is `undefined`, unavailable exactly where it matters most. HTTPS
 * on a LAN is not an escape either — a self-signed cert puts a security warning between every guest
 * and the quiz.
 *
 * **`nosleep.js`** uses the native API where it exists and falls back to a muted looping video, which
 * holds the display on over plain HTTP on both iOS and Android. Reaching for the library rather than
 * hand-rolling it is deliberate: the fallback carries browser quirks — `playsinline` (without which
 * iOS goes fullscreen), codec pairs, autoplay policies — that are exactly the sort of thing to
 * inherit rather than rediscover.
 *
 * **The scoping is the part the library cannot decide**, and it is §12.1's table:
 *
 * | Event | Action |
 * | --- | --- |
 * | Team picked | `enable()` — the gesture we already have |
 * | `BREAK` | `disable()` — the phone is in a pocket at the bar |
 * | `FINALE` | keep enabled — minutes of watching a clock without touching the screen |
 * | Tab hidden | `disable()` — nothing to keep awake for, and it would be lost anyway |
 * | Visible again, playing | `enable()` — both mechanisms drop on backgrounding |
 * | `FINISHED` | `disable()` |
 *
 * A blanket two-hour hold would be a real battery cost on a phone already at 23% (§1.1), for stretches
 * when nobody is looking at it.
 *
 * **Failure is silent and non-fatal.** If neither mechanism works, §5.4's late-submit-on-wake means
 * the team still does not lose the question — they just have to unlock the phone to see it.
 */
export function useWakeLock(stage: string | undefined): void {
  const holder = useRef<{ enable: () => void; disable: () => void } | null>(null)

  // The stages where a phone is being *looked at* without being touched. `BREAK` is deliberately
  // absent, and `FINALE` deliberately present — it is the one stretch a phone would certainly lock.
  const wanted =
    stage === 'QUESTION' ||
    stage === 'FINALE' ||
    stage === 'WAITING' ||
    stage === 'BETWEEN_QUESTIONS' ||
    stage === 'JEOPARDY_BOARD'

  useEffect(() => {
    let disposed = false

    const apply = (): void => {
      // Hidden tabs get nothing: both mechanisms drop on backgrounding anyway, and holding a lock for
      // a screen nobody can see is pure battery.
      const on = wanted && document.visibilityState === 'visible'
      const lock = holder.current
      if (!on) {
        lock?.disable()
        return
      }
      if (lock) {
        lock.enable()
        return
      }
      /*
       * Loaded on demand rather than at import: it embeds a base64 video, and a phone loading this
       * over the master's laptop hotspot alongside twenty others should not pay for it until the
       * moment it is wanted (§12.1's bundle note).
       */
      void import('nosleep.js').then((module) => {
        if (disposed) return
        const NoSleep = module.default
        const instance = new NoSleep()
        holder.current = instance
        /*
         * `enable()` wants a user gesture, and §12.1 says we already have the right one — the tap that
         * picked a team. By the time this runs the page has been navigated to from that tap, so the
         * native path may refuse; the video fallback does not. Either way a refusal is silent, which
         * is the documented behaviour rather than a shortcut.
         */
        try {
          // `enable()` returns a promise in the native path and nothing in the fallback; a rejection
          // is the documented silent failure, so it is swallowed rather than surfaced.
          void Promise.resolve(instance.enable()).catch(() => undefined)
        } catch {
          // Non-fatal by design. §5.4's late submit is the real backstop.
        }
      })
    }

    apply()
    document.addEventListener('visibilitychange', apply)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', apply)
    }
  }, [wanted])

  // Released on unmount — leaving a video looping behind a closed game is the battery cost §12.1 is
  // explicitly trying to avoid.
  useEffect(
    () => () => {
      holder.current?.disable()
    },
    [],
  )
}
