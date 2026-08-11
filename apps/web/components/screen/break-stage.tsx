'use client'

import type { MainScreenView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { JoinCode, Standings } from '@/components/screen/parts'
import type { Teams } from '@/components/screen/stage'
import { useCountdown } from '@/lib/client/use-countdown'

type BreakView = Extract<MainScreenView['stage'], { kind: 'BREAK' }>

/**
 * PRD 4 §11 — `BREAK`, the interval.
 *
 * A pub quiz has a break, and leaving the last question on screen for fifteen minutes looks broken.
 *
 * **A counting-down clock, not a static message**, because it does work a message doesn't: it gets
 * people back to their tables.
 */
export function BreakStage({
  stage,
  teams,
  code,
}: {
  stage: BreakView
  teams: Teams
  code: string
}) {
  const t = useTranslations('screen.break')

  /*
   * Counted down client-side from an **absolute** `resumesAt` (D7, D52), which is what makes a screen
   * that connects halfway through the break show the correct remaining time rather than restarting the
   * countdown from the full duration.
   */
  const seconds = useCountdown(stage.resumesAt)

  // §11 — *"a duration is optional."* A master who doesn't know how long shows `BACK SHORTLY` with no
  // clock, rather than inventing a number they will then overrun.
  const open = seconds === null
  // *"Reaching zero changes nothing on the server."* It holds at 0:00 and the heading changes; the
  // master resumes when the room is actually back (D8 — nothing here auto-advances).
  const expired = seconds !== null && seconds <= 0

  return (
    <section className="flex h-full w-full flex-col items-center bg-neutral-950 p-[5cqh] text-neutral-50">
      <h1 className="shrink-0 text-[8cqh] font-semibold tracking-[0.15em] text-neutral-300 uppercase">
        {open ? t('backShortly') : expired ? t('startingSoon') : t('backIn')}
      </h1>

      {open ? null : (
        // §11 / conventions §8.2 — **`m:ss` here**, unlike the finale's whole seconds (D57). A break is
        // minutes long and nobody is doing arithmetic on it, so `4:37` is the natural reading; the
        // finale's format exists for subtraction, which does not apply.
        <p className="shrink-0 text-[24cqh] leading-none font-semibold tabular-nums">
          {minuteSeconds(seconds ?? 0)}
        </p>
      )}

      {/* §11 — standings sit beneath, because they are what people want to look at during a break
          anyway. No movement arrows: nothing has moved since the round ended. */}
      <div className="flex min-h-0 w-full flex-1 items-center py-[3cqh]">
        <Standings standings={stage.standings} teams={teams} movement={false} />
      </div>

      {/* §16 O2 — and the join code returns: a break is exactly when a late arrival has time to join. */}
      <div className="shrink-0">
        <JoinCode code={code} size={5} />
      </div>
    </section>
  )
}

/**
 * `m:ss` — conventions §8.2's format for breaks and media, and **not** interchangeable with the
 * finale's whole seconds or an elimination's `HH:mm`.
 *
 * Duplicated from `components/control/break-desk` on purpose rather than imported: that module is the
 * master's surface, and this one is the room's. Sharing it would be the first thread of a dependency
 * between two surfaces whose type scales must stay independent (CLAUDE.md §7).
 */
export function minuteSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}
