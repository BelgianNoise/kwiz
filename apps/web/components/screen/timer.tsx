'use client'

import type { Timer as TimerView } from '@kwiz/domain'
import { TIMER_WARN_SCREEN_S } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

import { playTimerExpiry } from '@/lib/client/screen-sound'
import { useCountdown } from '@/lib/client/use-countdown'

/**
 * PRD 4 §7 — the question timer.
 *
 * **Top-right of the safe area, consistent across every stage that has one.** A timer that moves is a
 * timer people hunt for, so the position is fixed here rather than per stage.
 *
 * **A depleting ring plus the number.** The ring is readable peripherally — someone looking at their
 * phone catches the shape changing — and the number is exact. That pairing is why `durationMs` had to
 * go on the payload: a deadline gives the number and not the proportion.
 */
export function Timer({ timer }: { timer: TimerView }) {
  const t = useTranslations('screen.question')

  // D52 — counted down on the client from an absolute instant; the server pushes no ticks.
  const remaining = useCountdown(timer.deadlineAt) ?? 0
  const seconds = Math.ceil(remaining)
  const paused = timer.pausedAt !== null

  // §7 — *"the last 5 seconds shift colour and pulse."* Colour alone is insufficient at §2.2's
  // contrast reality, so motion carries it.
  const urgent = !paused && seconds > 0 && seconds <= TIMER_WARN_SCREEN_S

  useExpirySound(seconds, paused)

  const fraction =
    timer.durationMs > 0 ? Math.min(1, remaining / (timer.durationMs / 1000)) : 0

  return (
    <div className="absolute top-[5cqh] right-[5cqh] size-[16cqh]">
      <Ring fraction={paused ? 1 : fraction} urgent={urgent} />

      <div
        className="absolute inset-0 flex items-center justify-center"
        style={urgent ? { animation: 'kwiz-urgent 1s ease-in-out infinite' } : undefined}
      >
        {paused ? (
          // §7 — *"paused during buzz adjudication (D35): the ring stops and shows ⏸."* The room needs
          // to see the clock isn't running while the master judges, or a team that buzzed feels
          // cheated of the remaining time.
          <span className="text-[7cqh]" aria-label={t('paused')}>
            ⏸
          </span>
        ) : seconds > 0 ? (
          <span className="text-[8cqh] font-semibold tabular-nums">{seconds}</span>
        ) : (
          /*
           * §7 — **at zero it does not disappear.** It shows `TIME` and holds: the question is still
           * open server-side (D8), teams' auto-submits are still arriving, and a vanishing timer would
           * read to the room as *"the question is over."*
           */
          <span className="text-[4.5cqh] font-semibold tracking-widest">
            {t('timeUp')}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The depleting arc, as one SVG circle with a dash offset.
 *
 * No thin weights anywhere on this surface (§2.2) — hairlines disappear on a projector — so the ring is
 * a deliberately fat stroke rather than the elegant thin one this shape usually gets.
 */
function Ring({ fraction, urgent }: { fraction: number; urgent: boolean }) {
  const radius = 44
  const circumference = 2 * Math.PI * radius

  return (
    <svg viewBox="0 0 100 100" className="size-full -rotate-90">
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        className="text-neutral-800"
      />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        className={urgent ? 'text-orange-400' : 'text-neutral-300'}
      />
    </svg>
  )
}

/**
 * §13 — the timer-expiry sound, once. *"Answers are closing; the visual ring alone is missed by anyone
 * not looking up."*
 *
 * Fired on the **transition** to zero rather than while zero, because the timer holds at zero
 * indefinitely (§7) and a tone every 250 ms would be its own emergency. A screen that connects after
 * expiry has missed the moment and stays silent, which is right: the sound marks an instant, and that
 * instant has passed.
 */
function useExpirySound(seconds: number, paused: boolean): void {
  const wasRunning = useRef(false)

  useEffect(() => {
    if (paused) return
    if (seconds > 0) {
      wasRunning.current = true
      return
    }
    if (wasRunning.current) {
      wasRunning.current = false
      playTimerExpiry()
    }
  }, [seconds, paused])
}
