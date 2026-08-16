'use client'

import type { ReviewAdjustment, ReviewTeam } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

/**
 * PRD 2 §13.3 — the adjustment audit.
 *
 * **`[Undo]` is `SCORE_ADJUSTMENT_REVOKED`, not a compensating `−50`** (D41). `game_event` is
 * append-only, so a mistaken adjustment cannot be deleted; the alternative considered and rejected
 * was countering it with an opposite adjustment, which *"reads as two mistakes, and the log stops
 * meaning what it says"*. The projection excludes revoked rows, the log keeps both facts, and this
 * shows one struck-through line.
 */
export function ReviewAdjustments({
  adjustments,
  teams,
  onRevoke,
  busy,
}: {
  adjustments: ReviewAdjustment[]
  teams: ReviewTeam[]
  onRevoke: (adjustmentId: string) => void
  busy: string | null
}) {
  const t = useTranslations('admin.review')
  const named = new Map(teams.map((team) => [team.id, team]))

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{t('adjustmentsHeading')}</h2>

      {adjustments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('noAdjustments')}</p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-xl border">
          {adjustments.map((adjustment) => {
            const team = named.get(adjustment.teamId)
            const revoked = adjustment.revokedAt !== null
            return (
              <li
                key={adjustment.id}
                className={`flex flex-wrap items-center gap-3 p-3 text-sm ${
                  revoked ? 'text-muted-foreground' : ''
                }`}
              >
                <span className="flex min-w-40 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: team?.colour ?? '#737373' }}
                  />
                  <span className="truncate">{team?.name}</span>
                </span>

                <span
                  className={`w-12 shrink-0 text-right font-medium tabular-nums ${
                    revoked ? 'line-through' : ''
                  }`}
                >
                  {adjustment.delta > 0 ? `+${adjustment.delta}` : adjustment.delta}
                </span>

                <span className="min-w-0 flex-1">
                  {adjustment.reason ?? <span className="text-muted-foreground">—</span>}
                </span>

                {/*
                  D25 — `announced: false` suppressed the main-screen banner but the row exists
                  regardless. Saying so here is the point of an audit: a quiet deduction is exactly
                  the one a master will be asked about later.
                */}
                {adjustment.announced ? null : (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {t('notAnnounced')}
                  </span>
                )}

                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {clockTime(adjustment.createdAt)}
                </span>

                {revoked ? (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    ↩ {t('undone')}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === adjustment.id}
                    onClick={() => onRevoke(adjustment.id)}
                  >
                    {t('undo')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** conventions §8.2 — when it happened, so `HH:mm`. */
function clockTime(at: number): string {
  const when = new Date(at)
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
}
