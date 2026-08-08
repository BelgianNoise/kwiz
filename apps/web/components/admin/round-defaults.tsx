'use client'

import type { RoundContent } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { SaveIndicator } from '@/components/admin/save-indicator'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/client/api'
import { useAutosave } from '@/lib/client/use-autosave'

/**
 * PRD 2 §7 — the round's title and its two defaults.
 *
 * **Round defaults cascade** (D6, D7): new questions inherit them, and so do questions that never
 * overrode them. Changing one therefore changes a whole round's scoring — so the UI says **how many
 * questions that is** before applying it. Silently rewriting a round's points is a nasty surprise,
 * and the count is the difference between a decision and an accident.
 */
export function RoundDefaults({
  round,
  onChanged,
}: {
  round: RoundContent
  onChanged: () => void
}) {
  const t = useTranslations('admin.round')
  const common = useTranslations('common')

  const [noTimer, setNoTimer] = useState(round.defaultTimerMs === null)
  const [pendingPoints, setPendingPoints] = useState<number | undefined>()

  const title = useAutosave<string>((value) =>
    api.updateRound(round.id, { title: value }).then((result) => {
      onChanged()
      return result
    }),
  )
  const timer = useAutosave<number | null>((value) =>
    api.updateRound(round.id, { defaultTimerMs: value }).then((result) => {
      onChanged()
      return result
    }),
  )

  /** Questions that would move: the ones that never set a value of their own. */
  const inheriting = round.questions.filter(
    (question) => question.points === round.defaultPoints,
  )

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex-1 space-y-2">
          <Label htmlFor="round-title-field">{t('title')}</Label>
          <Input
            id="round-title-field"
            defaultValue={round.title}
            onChange={(event) => title.push(event.target.value)}
          />
        </div>
        <SaveIndicator status={title.status} savedAt={title.savedAt} />
      </div>

      {round.type === 'QUESTION_SET' ? (
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-28 space-y-2">
            <Label htmlFor="round-points">{t('defaultPoints')}</Label>
            <Input
              id="round-points"
              type="number"
              min={0}
              defaultValue={round.defaultPoints}
              // Confirmed rather than autosaved, uniquely on this field: it is the one edit here
              // that changes questions the master is not looking at.
              onBlur={(event) => {
                const next = Number(event.target.value)
                if (next !== round.defaultPoints) setPendingPoints(next)
              }}
            />
          </div>

          <div className="w-28 space-y-2">
            <Label htmlFor="round-timer">{t('defaultTimer')}</Label>
            <Input
              id="round-timer"
              type="number"
              min={1}
              disabled={noTimer}
              defaultValue={
                round.defaultTimerMs === null
                  ? ''
                  : Math.round(round.defaultTimerMs / 1000)
              }
              onChange={(event) => timer.push(Number(event.target.value) * 1000)}
            />
          </div>

          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="round-no-timer"
              checked={noTimer}
              onCheckedChange={(checked) => {
                const off = checked === true
                setNoTimer(off)
                if (off) timer.push(null)
              }}
            />
            <Label htmlFor="round-no-timer">{t('noTimer')}</Label>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingPoints !== undefined}
        title={t('cascadeTitle')}
        body={t('cascadeBody', {
          count: inheriting.length,
          from: round.defaultPoints,
          to: pendingPoints ?? 0,
        })}
        confirmLabel={common('save')}
        onCancel={() => {
          setPendingPoints(undefined)
          onChanged()
        }}
        onConfirm={() => {
          const next = pendingPoints
          setPendingPoints(undefined)
          if (next === undefined) return
          void api.updateRound(round.id, { defaultPoints: next }).then(() =>
            // Then the inheriting questions, so the cascade is real rather than implied.
            Promise.all(
              inheriting.map((question) =>
                api.updateQuestion(question.id, { points: next }),
              ),
            ).then(onChanged),
          )
        }}
      />
    </section>
  )
}
