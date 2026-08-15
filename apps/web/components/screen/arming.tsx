'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { armSound } from '@/lib/client/screen-sound'
import { requestFullscreen } from '@/lib/client/use-screen-chrome'

/**
 * PRD 4 §4.1 — **one click arms audio and fullscreen together.**
 *
 * Browsers block autoplay without a gesture and `requestFullscreen` needs one too (PRD 1 §14's stated
 * risk). Rather than two prompts or a silent failure discovered mid-music-round, this is shown
 * *before* the waiting screen, on load, **every time this route is opened** — a master who reopens
 * the tab has to re-arm, because the browser's permission did not survive either.
 *
 * The click's result is reported upward rather than assumed: §4.1 wants the waiting screen to confirm
 * `♪ sound ready`, and a confirmation that is really just "we tried" would be worse than none.
 */
export function Arming({ onArmed }: { onArmed: (sound: boolean) => void }) {
  const t = useTranslations('screen.arming')
  const [arming, setArming] = useState(false)

  /*
   * **The two are fired together and only one is waited on.** §4.1 asks the master to be told about
   * the *sound*; fullscreen is silent by O4's design either way — *"never show the room a prompt."*
   *
   * Awaiting both was a real bug, found by driving this screen: `requestFullscreen()` returns a
   * promise that in some embedders **never settles at all** rather than rejecting, so the arming
   * screen sat there disabled and the projector never advanced past it. Arming must always reach an
   * answer, because there is no other way out of this screen.
   */
  const arm = (): void => {
    setArming(true)
    void requestFullscreen()
    void armSound().then(onArmed)
  }

  return (
    /*
     * The whole viewport is the target — §4.1's *"click anywhere"*. A `<button>` rather than a div
     * with a handler, so it is reachable by keyboard: this screen has no keyboard user during a quiz,
     * but the master arms it before the room is watching and may well be at the laptop.
     */
    <button
      type="button"
      onClick={arm}
      disabled={arming}
      className="flex h-full min-h-screen w-full cursor-pointer flex-col items-center justify-center gap-[3vh] bg-neutral-950 p-[5vh] text-center text-neutral-50"
    >
      {/*
       * **`vh`, and nothing below `4vh`** (§2.1) — *"nothing is exempt."*
       *
       * These were `text-4xl` and `text-xl` until the slice-6 review: 36px and 20px, which on a
       * 1920×1080 projector is 3.33vh and 1.85vh. Below the floor, on the very first thing the room
       * sees, every time the route opens.
       *
       * `vh` rather than the `cqh` every other file here uses, because this screen is deliberately
       * *outside* `StageFrame` — §4.1 puts it before the waiting screen, and "click anywhere" has to
       * mean the whole viewport rather than a letterboxed box inside it. With no container there is
       * no `cqh`, and `vh` is the unit §2.1 states its floor in anyway.
       */}
      <span className="text-[7vh] leading-tight font-semibold">{t('click')}</span>
      {/* The only explanatory copy on this surface. It is addressed to the master, before the room
          has anything to look at. */}
      <span className="max-w-[60vw] text-[4.5vh] leading-tight text-neutral-400">
        {t('explain')}
      </span>
    </button>
  )
}

/**
 * §14 — *"Game not found / deleted: a neutral full-screen `kwiz` mark. No error text."*
 *
 * Also what stands in before the first frame arrives. The room must never see a technical failure:
 * they read a scary message as *"the quiz is broken"*, and the master then spends five minutes on
 * reassurance. A wordmark reads as "not started yet" to an audience, which is both calmer and — while
 * connecting — true.
 */
export function KwizMark() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950">
      <span className="text-[12cqh] font-semibold tracking-[0.3em] text-neutral-700">
        kwiz
      </span>
    </div>
  )
}

/**
 * §14 — *"Nothing, for the first 3 s. Then a small, calm, wordless pulse in a corner. Never a modal,
 * never red, never the word 'error'."*
 *
 * The grace period is the whole design: reconnection is usually faster than three seconds (protocol
 * §3.2), so a pulse that appeared instantly would be a light flashing at a paying audience every time
 * the wifi blinked. The last good view stays on screen throughout — it is still true.
 */
export function DisconnectedPulse() {
  return (
    // `<output>` rather than a div with `role="status"`: same semantics, and it is the tag the linter
    // and a screen reader both expect. Wordless for the room (§14), but not for a master who is
    // driving this screen from a keyboard.
    <output
      /*
       * Inside the 5% safe area (§2.2), bottom-**right**. It was bottom-left until the slice-6 review
       * pointed out that §10.1's adjustment banner anchors there for six seconds — a reconnect during
       * one would have put a pulse under the banner or beside it. Right is free on every stage: §7's
       * timer is top-right, and nothing else reaches that corner.
       */
      className="pointer-events-none absolute right-[5cqh] bottom-[5cqh] size-[2cqh] rounded-full bg-neutral-500"
      style={{ animation: 'kwiz-pulse 2s ease-in-out infinite' }}
      aria-label="reconnecting"
    />
  )
}
