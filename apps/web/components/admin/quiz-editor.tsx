'use client'

import {
  estimatedMinutes,
  questionCount,
  quizPoints,
  roundPoints,
  type QuizContent,
  type RoundContent,
  type RoundType,
} from '@kwiz/domain'
import { ChevronLeft, GripVertical, Pin, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AddRoundDialog } from '@/components/admin/add-round-dialog'
import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { SaveIndicator } from '@/components/admin/save-indicator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Link, useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'
import { useAutosave } from '@/lib/client/use-autosave'

/**
 * PRD 2 §6 — the quiz editor.
 *
 * Two things here are load-bearing rather than decorative:
 *
 * - **Per-round point totals and a quiz total.** Balance between rounds is what a master worries
 *   about while authoring, and it is invisible unless computed for them.
 * - **§6.1's pinned finale.** It carries a pin instead of a drag handle, a new round is inserted
 *   *before* it, and both reorder routes refuse to move anything past it. The refusal lives in the
 *   repository so the keyboard cannot walk around the rule (§15.2) — this only has to not offer it.
 */
export function QuizEditor({ quiz }: { quiz: QuizContent }) {
  const t = useTranslations('admin.quiz')
  const common = useTranslations('common')
  const router = useRouter()

  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<RoundContent | undefined>()

  const name = useAutosave<string>((value) => api.updateQuiz(quiz.id, { name: value }))
  const description = useAutosave<string>((value) =>
    api.updateQuiz(quiz.id, { description: value === '' ? null : value }),
  )

  const hasFinale = quiz.rounds.some((round) => round.type === 'DSMTW_FINALE')
  const refresh = (): void => router.refresh()

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin">
            <ChevronLeft className="size-4" />
            {t('backToDashboard')}
          </Link>
        </Button>
        <div className="flex items-center gap-4">
          <SaveIndicator
            status={name.status === 'idle' ? description.status : name.status}
            savedAt={name.savedAt ?? description.savedAt}
          />
          <Button asChild variant="secondary">
            <Link href={`/admin/quizzes/${quiz.id}/play`}>{t('preflight')}</Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="quiz-name">{t('name')}</Label>
          <Input
            id="quiz-name"
            defaultValue={quiz.name}
            onChange={(event) => name.push(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quiz-description">{t('description')}</Label>
          <Textarea
            id="quiz-description"
            rows={1}
            defaultValue={quiz.description ?? ''}
            onChange={(event) => description.push(event.target.value)}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('rounds')}</h2>
          <Button onClick={() => setAdding(true)}>{t('addRound')}</Button>
        </div>

        {quiz.rounds.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
            {t('empty')}
          </div>
        ) : (
          <ol className="divide-border border-border divide-y rounded-xl border">
            {quiz.rounds.map((round, index) => {
              const points = roundPoints(round)
              const pinned = round.type === 'DSMTW_FINALE'
              // Nothing may move below the finale, so the round above it has no "down".
              const lastMovable = hasFinale
                ? quiz.rounds.length - 2
                : quiz.rounds.length - 1

              return (
                <li key={round.id} className="flex items-center gap-3 p-4">
                  <span className="text-muted-foreground w-6 text-center text-sm tabular-nums">
                    {index + 1}
                  </span>

                  {/*
                    §6.1 — a pin instead of a drag handle, so the constraint is **visible in the
                    list** rather than being a rule you discover by trying.
                  */}
                  {pinned ? (
                    <span
                      className="text-muted-foreground"
                      title={t('finalePinned')}
                      aria-label={t('finalePinned')}
                    >
                      <Pin className="size-4" />
                    </span>
                  ) : (
                    <span className="text-muted-foreground" aria-hidden>
                      <GripVertical className="size-4" />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{round.title}</p>
                    <p className="text-muted-foreground text-sm">
                      {t(`type.${round.type}`)} ·{' '}
                      {points === null
                        ? t('roundSummaryFinale', { questions: round.questions.length })
                        : t('roundSummary', {
                            questions: round.questions.length,
                            points,
                          })}
                    </p>
                  </div>

                  {/* §15.2 — the keyboard alternative to dragging, refused identically. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={common('moveUp')}
                    disabled={pinned || index === 0}
                    onClick={() => {
                      void api.moveRound(round.id, 'UP').then(refresh)
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={common('moveDown')}
                    disabled={pinned || index >= lastMovable}
                    onClick={() => {
                      void api.moveRound(round.id, 'DOWN').then(refresh)
                    }}
                  >
                    ↓
                  </Button>

                  <Button asChild variant="secondary">
                    <Link href={`/admin/quizzes/${quiz.id}/rounds/${round.id}`}>
                      {t('openRound')}
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={common('delete')}
                    onClick={() => setDeleting(round)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ol>
        )}

        {quiz.rounds.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('totals', {
              questions: questionCount(quiz),
              points: quizPoints(quiz),
              // Rough by nature and labelled "est." — but a master planning an evening needs to
              // know whether they have written 45 minutes or three hours.
              minutes: estimatedMinutes(quiz),
            })}
          </p>
        ) : null}
      </section>

      <AddRoundDialog
        open={adding}
        quizId={quiz.id}
        hasFinale={hasFinale}
        onClose={() => setAdding(false)}
        onCreated={refresh}
      />

      <ConfirmDialog
        open={deleting !== undefined}
        title={t('deleteRoundTitle', { title: deleting?.title ?? '' })}
        body={t('deleteRoundBody', { count: deleting?.questions.length ?? 0 })}
        confirmLabel={common('delete')}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          const target = deleting
          setDeleting(undefined)
          if (target) void api.deleteRound(target.id).then(refresh)
        }}
      />
    </main>
  )
}

export type { RoundType }
