'use client'

import type { GameReview, ReviewCell, ReviewQuestion } from '@kwiz/domain'
import { ChevronLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import { ReviewAdjustments } from '@/components/admin/review-adjustments'
import { ReviewFinaleSection } from '@/components/admin/review-finale'
import { ReviewGrid } from '@/components/admin/review-grid'
import { ReviewTeams } from '@/components/admin/review-teams'
import { Link } from '@/i18n/navigation'
import { api, control } from '@/lib/client/api'

/**
 * PRD 2 §13 — the review surface.
 *
 * **Every correction re-reads the whole review** rather than patching the copy on screen. It looks
 * wasteful and is the only correct option: flipping one verdict changes that team's score, which
 * changes every rank, which changes the finale's starting seconds if the round has not run yet. The
 * server's fold knows all of that; a client patching a cell knows one cell.
 *
 * *"Score changes propagate immediately and reach the main screen live if the game is still
 * running"* — that half is free. The action appends an event, and every live surface is already
 * subscribed to the projection it updates (D38).
 */
export function ReviewScreen({ gameId }: { gameId: string }) {
  const t = useTranslations('admin.review')
  const [review, setReview] = useState<GameReview | null>(null)
  const [missing, setMissing] = useState(false)
  /** The cell or row mid-write, so one click cannot be double-fired while the round trip is open. */
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await api.review(gameId)
    if (result.ok && result.data) {
      setReview(result.data)
      return
    }
    setMissing(true)
  }, [gameId])

  useEffect(() => void load(), [load])

  const act = useCallback(
    async (key: string, run: () => Promise<unknown>) => {
      setBusy(key)
      await run()
      await load()
      setBusy(null)
    },
    [load],
  )

  const toggle = useCallback(
    (question: ReviewQuestion, cell: ReviewCell) => {
      /*
       * §13.1 — *"clicking any cell toggles the verdict."* Toggling means the **opposite of what it
       * is worth now**, not the opposite of its label: `AUTO_CORRECT` and `ACCEPTED` both earned the
       * points, so both toggle to denied.
       */
      const awarded = cell.verdict === 'ACCEPTED' || cell.verdict === 'AUTO_CORRECT'
      void act(`${question.id}:${cell.teamId}`, () =>
        control(gameId).validate(question.id, cell.teamId, !awarded),
      )
    },
    [act, gameId],
  )

  if (missing) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted-foreground">{t('noGame')}</p>
      </main>
    )
  }

  if (!review) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted-foreground">{t('loading')}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="space-y-2">
        <Link
          href={`/admin/games/${gameId}`}
          className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ChevronLeft className="size-4" />
          {t('backToGame')}
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{review.quizName}</h1>
          {review.corrections > 0 ? (
            <span className="text-muted-foreground text-sm">
              {t('correctionCount', { count: review.corrections })}
            </span>
          ) : null}
        </div>
      </header>

      {review.rounds.map((round) => (
        <ReviewGrid
          key={round.id}
          round={round}
          teams={review.teams}
          onToggle={toggle}
          busy={busy}
        />
      ))}

      {review.finale ? (
        <ReviewFinaleSection finale={review.finale} teams={review.teams} />
      ) : null}

      <ReviewAdjustments
        adjustments={review.adjustments}
        teams={review.teams}
        busy={busy}
        onRevoke={(adjustmentId) =>
          void act(adjustmentId, () => control(gameId).revokeAdjustment(adjustmentId))
        }
      />

      <ReviewTeams
        teams={review.teams}
        busy={busy}
        onRename={(teamId, name) =>
          void act(teamId, () => api.updateTeam(gameId, teamId, { name }))
        }
        onRecolour={(teamId, colour) =>
          void act(teamId, () => api.updateTeam(gameId, teamId, { colour }))
        }
      />
    </main>
  )
}
