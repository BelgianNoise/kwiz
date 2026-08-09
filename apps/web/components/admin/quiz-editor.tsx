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
import { ChevronLeft, GripVertical, MoreHorizontal, Pin, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AddRoundDialog } from '@/components/admin/add-round-dialog'
import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { ExportDialog } from '@/components/admin/export-dialog'
import { SaveIndicator } from '@/components/admin/save-indicator'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Link, useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'
import { useAutosave } from '@/lib/client/use-autosave'
import { useReorder } from '@/lib/client/use-reorder'

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
export function QuizEditor({ quiz, games }: { quiz: QuizContent; games: number }) {
  const t = useTranslations('admin.quiz')
  const dashboard = useTranslations('admin.dashboard')
  const common = useTranslations('common')
  const router = useRouter()

  const [adding, setAdding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState<RoundContent | undefined>()

  const name = useAutosave<string>((value) => api.updateQuiz(quiz.id, { name: value }))
  const description = useAutosave<string>((value) =>
    api.updateQuiz(quiz.id, { description: value === '' ? null : value }),
  )

  const hasFinale = quiz.rounds.some((round) => round.type === 'DSMTW_FINALE')
  const refresh = (): void => router.refresh()

  /**
   * §6.1's constraint, stated once and asked by both reorder routes.
   *
   * `lastMovable` is the index nothing may pass: with a finale that is the row above it, so neither a
   * drag nor `↓` can put a round after the pinned one.
   */
  const lastMovable = hasFinale ? quiz.rounds.length - 2 : quiz.rounds.length - 1
  const isPinned = (index: number): boolean => quiz.rounds[index]?.type === 'DSMTW_FINALE'

  const move = (id: string, direction: 'UP' | 'DOWN', steps: number): void => {
    /*
     * One request per step, awaited in order. The server only knows `UP`/`DOWN` (protocol §7.1) and
     * each call renumbers `position`, so firing them in parallel would race on the same rows.
     */
    void (async () => {
      for (let step = 0; step < steps; step += 1) {
        // oxlint-disable-next-line no-await-in-loop
        await api.moveRound(id, direction)
      }
      refresh()
    })()
  }

  const reorder = useReorder({
    length: quiz.rounds.length,
    canDrag: (index) => !isPinned(index) && quiz.rounds.length > 1,
    canDrop: (from, to) => !isPinned(from) && to <= lastMovable,
    onMove: move,
  })

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

          {/*
            §6 — `[Export]` and `[⋯]` belong here as well as on the dashboard. A master deep in an
            editor should not have to navigate away to get their work off the machine.
          */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={quiz.name}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setExporting(true)}>
                {dashboard('export')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void api.duplicateQuiz(quiz.id).then(refresh)
                }}
              >
                {dashboard('duplicate')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

              return (
                <li
                  key={round.id}
                  {...reorder.rowProps(round.id, index)}
                  className={[
                    'flex items-center gap-3 p-4',
                    reorder.draggingId === round.id ? 'opacity-40' : '',
                    // The drop indicator §6.1 says must not appear past the pinned row — it cannot,
                    // because `canDrop` refuses those targets before this ever renders.
                    reorder.overId === round.id ? 'border-primary border-t-2' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
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
                    <span
                      className="text-muted-foreground cursor-grab active:cursor-grabbing"
                      title={common('dragToReorder')}
                      aria-hidden
                    >
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

                  {/* §15.2 — the keyboard route, refused by the same predicate the drag uses. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={common('moveUp')}
                    disabled={pinned || index === 0}
                    onClick={() => move(round.id, 'UP', 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={common('moveDown')}
                    disabled={pinned || index >= lastMovable}
                    onClick={() => move(round.id, 'DOWN', 1)}
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

      <ExportDialog
        open={exporting}
        quizId={quiz.id}
        quizName={quiz.name}
        games={games}
        onClose={() => setExporting(false)}
      />

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
