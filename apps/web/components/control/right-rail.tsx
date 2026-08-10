'use client'

import type { ErrorCode, MasterControlView, Notice } from '@kwiz/domain'
import { Monitor, MonitorOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AddTeamButton } from '@/components/control/add-team-button'
import type { Run, ZoneProps } from '@/components/control/control-desk'
import { TeamDot } from '@/components/control/team-dot'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ControlApi } from '@/lib/client/api'

/**
 * PRD 3 §2's right rail — teams with live scores, connection status, and score adjustment.
 *
 * PRD 1: *"if there is no input needed, the total scores can be shown prominently"* — and the master
 * is asked *"what's the score?"* constantly. It is fixed for the whole game, so the answer is always
 * in the same place.
 *
 * Anything lower-priority than the current attention state appears **here as a quiet count**
 * (§3.1) — never as a second call to action.
 */
export function RightRail({
  view,
  api,
  run,
  gameId,
  notice,
  refusal,
}: ZoneProps & { notice: Notice | null; refusal: ErrorCode | null }) {
  const t = useTranslations('control.scores')
  const tError = useTranslations('errors')

  const joined = view.teams.filter((team) => team.deviceCount > 0).length
  const ranked = [...view.teams].sort((a, b) => b.score - a.score)

  return (
    <aside className="flex h-full min-h-0 flex-col gap-3 p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">{t('title')}</h2>
        <span className="text-muted-foreground text-xs">
          {t('devicesLine', { joined, total: view.teams.length })}
        </span>
        {/* PRD 2 §11.2 — `[+ Add team]` at **every** status, which is why it lives in the rail
            rather than only on §4's pre-game screen. A table walks in during round 1. */}
        <AddTeamButton gameId={gameId} view={view} size="sm" />
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {ranked.map((team) => (
          <li key={team.id} className="flex items-center gap-2">
            <TeamDot colour={team.colour} />
            <span className="min-w-0 flex-1 truncate">{team.name}</span>
            {team.deviceCount === 0 ? (
              <span className="text-muted-foreground text-xs">{t('noDevice')}</span>
            ) : null}
            <span className="tabular-nums">{team.score}</span>
            <AdjustPopover
              team={team}
              api={api}
              run={run}
              // §3.2 — the popover is not dismissed by an interruption, but it does say so.
              interrupted={view.attention.kind === 'ADJUDICATE_BUZZ'}
            />
          </li>
        ))}
      </ul>

      {/*
       * §3.1 — the quiet count. Outstanding validations are surfaced without ever becoming a second
       * primary action, and the sweep (§6.2) is what eventually clears them.
       */}
      {view.pendingValidationCount > 0 ? (
        <p className="text-muted-foreground">
          {t('toValidate', { count: view.pendingValidationCount })}
        </p>
      ) : null}

      {/* §11.1 — clears itself when the next question opens, so it cannot be left up. */}
      <Button
        size="sm"
        variant={view.scoreboardShown ? 'secondary' : 'outline'}
        disabled={view.status !== 'LIVE'}
        onClick={() => run(() => api.showScoreboard(!view.scoreboardShown))}
      >
        {view.scoreboardShown ? <MonitorOff aria-hidden /> : <Monitor aria-hidden />}
        {view.scoreboardShown ? t('hideScores') : t('showScores')}
      </Button>

      <RecentAdjustments view={view} api={api} run={run} gameId={gameId} />

      {/* Transient, and deliberately at the bottom: neither is ever the thing needing attention. */}
      {refusal ? <p className="text-destructive text-xs">{tError(refusal)}</p> : null}
      {notice ? <NoticeLine view={view} notice={notice} /> : null}
    </aside>
  )
}

/** D25's banner and *"Quizzly Bears just joined"*, as one quiet line rather than a toast stack. */
function NoticeLine({ view, notice }: { view: MasterControlView; notice: Notice }) {
  const name = view.teams.find((team) => team.id === notice.teamId)?.name ?? ''
  if (notice.kind === 'SCORE_ADJUSTED') {
    const delta = notice.delta > 0 ? `+${notice.delta}` : String(notice.delta)
    return (
      <p className="text-muted-foreground text-xs">
        {name} {delta}
        {notice.reason ? ` · ${notice.reason}` : ''}
      </p>
    )
  }
  if (notice.kind === 'TEAM_JOINED') {
    return <p className="text-muted-foreground text-xs">{name}</p>
  }
  return null
}

/**
 * §11 — the adjustment popover, available at all times (D15).
 *
 * **Stepper buttons before free entry**, because the overwhelmingly common case is ±5 or ±10 and a
 * stepper is faster and less error-prone than typing while distracted.
 *
 * §3.2 — this popover is deliberately **not dismissed** when something arrives behind it. Losing
 * half-typed input to an interruption is worse than a moment's delay.
 */
function AdjustPopover({
  team,
  api,
  run,
  interrupted,
}: {
  team: { id: string; name: string; colour: string }
  api: ControlApi
  run: Run
  /** Something arrived behind the popover. It stays open; it just says so (§3.2). */
  interrupted: boolean
}) {
  const t = useTranslations('control.scores')
  const [open, setOpen] = useState(false)
  const [delta, setDelta] = useState(0)
  const [reason, setReason] = useState('')
  // D25 — on by default: the reason is usually funny and part of the show.
  const [announced, setAnnounced] = useState(true)

  const close = (): void => {
    setOpen(false)
    setDelta(0)
    setReason('')
    setAnnounced(true)
  }

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={t('adjust')}>
          ±
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="flex items-center gap-2 font-medium">
          <TeamDot colour={team.colour} />
          {t('adjustTitle', { team: team.name })}
        </p>

        {/*
         * §3.2 — a buzz landing while this is open does **not** dismiss it: losing half-typed
         * input to an interruption is worse than a moment's delay. The attention zone updates
         * behind it and this one line is how the master finds out.
         */}
        {interrupted ? (
          <p className="text-destructive text-xs">{t('buzzInterrupt')}</p>
        ) : null}

        <div className="grid grid-cols-3 gap-1">
          {[-10, -5, -1, 1, 5, 10].map((step) => (
            <Button
              key={step}
              size="sm"
              variant="outline"
              onClick={() => setDelta((current) => current + step)}
            >
              {step > 0 ? `+${step}` : step}
            </Button>
          ))}
        </div>

        <div className="space-y-1">
          <Label htmlFor={`delta-${team.id}`}>{t('amount')}</Label>
          <Input
            id={`delta-${team.id}`}
            inputMode="numeric"
            value={String(delta)}
            onChange={(event) => setDelta(Number(event.target.value) || 0)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`reason-${team.id}`}>{t('reason')}</Label>
          <Input
            id={`reason-${team.id}`}
            placeholder={t('reasonPlaceholder')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={announced}
            onCheckedChange={(checked) => setAnnounced(checked === true)}
          />
          {t('announce')}
        </Label>

        <Button
          className="w-full"
          disabled={delta === 0}
          onClick={() => {
            run(() =>
              api.adjustScore({
                teamId: team.id,
                delta,
                ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
                announced,
              }),
            )
            close()
          }}
        >
          {t('apply', { delta: delta > 0 ? `+${delta}` : String(delta) })}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

/** §11's *"recent adjustments are listed with `[Undo]`"* — which appends a revocation (D41). */
function RecentAdjustments({ view, api, run }: ZoneProps) {
  const t = useTranslations('control.scores')
  if (view.adjustments.length === 0) return null

  return (
    <section className="space-y-1">
      <h3 className="text-muted-foreground text-xs">{t('recent')}</h3>
      <ul className="space-y-1">
        {view.adjustments.map((adjustment) => {
          const team = view.teams.find((entry) => entry.id === adjustment.teamId)
          return (
            <li
              key={adjustment.id}
              className={`flex items-center gap-2 text-xs ${adjustment.revoked ? 'text-muted-foreground line-through' : ''}`}
            >
              <span className="tabular-nums">
                {adjustment.delta > 0 ? `+${adjustment.delta}` : adjustment.delta}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {team?.name}
                {adjustment.reason ? ` · ${adjustment.reason}` : ''}
              </span>
              {adjustment.revoked ? (
                <span>{t('undone')}</span>
              ) : (
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => run(() => api.revokeAdjustment(adjustment.id))}
                >
                  {t('undo')}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
