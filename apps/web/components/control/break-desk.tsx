'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import type { ZoneProps } from '@/components/control/control-desk'
import { Leaderboard } from '@/components/control/leaderboard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCountdown } from '@/lib/client/use-countdown'

/**
 * PRD 3 §11.2 — the interval.
 *
 * **The countdown reaching zero does not resume the game.** Nothing in this product auto-advances
 * (D8), and a quiz that restarted itself while half the tables were at the bar would be worse than
 * one that waited. So this shows the clock and a `[Resume]` the master presses when the room is
 * actually back.
 *
 * The leaderboard sits underneath because that is what the master wants to look at anyway, and the
 * break is when they are most likely to clear outstanding validations (§6).
 */
export function BreakDesk({ view, api, run, gameId }: ZoneProps) {
  const t = useTranslations('control.break')
  const remaining = useCountdown(view.break?.resumesAt ?? null)

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-medium">{t('title')}</h1>
        <p className="text-muted-foreground text-lg tabular-nums">
          {/* `m:ss` — minutes long, and nobody subtracts from it (conventions §8.2). */}
          {remaining === null
            ? t('noClock')
            : t('backIn', { time: minuteSeconds(remaining) })}
        </p>
      </div>

      <Button size="lg" onClick={() => run(() => api.endBreak())}>
        {t('resume')}
      </Button>

      <Leaderboard view={view} api={api} run={run} gameId={gameId} />
    </section>
  )
}

/**
 * §11.2's one number. `[Extend break]` re-issues the same call, because *"five more minutes"* is the
 * most predictable thing that happens during an interval.
 *
 * **Entering a duration is optional**: left blank the screens say "back shortly" with no clock,
 * which beats a master inventing ten minutes and taking twenty.
 */
export function BreakDialog({
  open,
  extending,
  onOpenChange,
  onStart,
}: {
  open: boolean
  extending: boolean
  onOpenChange: (open: boolean) => void
  onStart: (durationMs?: number) => void
}) {
  const t = useTranslations('control.break')
  const common = useTranslations('common')
  const [minutes, setMinutes] = useState('10')

  const parsed = Number(minutes)
  const durationMs =
    minutes.trim() === '' || !Number.isFinite(parsed) || parsed <= 0
      ? undefined
      : Math.round(parsed * 60_000)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{extending ? t('extend') : t('startTitle')}</DialogTitle>
          <DialogDescription>{t('minutesHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="break-minutes">{t('minutes')}</Label>
          {/* Focused on mount rather than with `autoFocus`: the dialog exists to take this one
              number, and a callback ref focuses once instead of on every re-render. */}
          <Input
            id="break-minutes"
            ref={(node) => node?.focus()}
            inputMode="numeric"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {common('cancel')}
          </Button>
          <Button onClick={() => onStart(durationMs)}>
            {extending ? t('extend') : t('start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** conventions §8.2 — `m:ss` for a break countdown, which is minutes long. */
export function minuteSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
