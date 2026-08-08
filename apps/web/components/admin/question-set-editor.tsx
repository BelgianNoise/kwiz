'use client'

import {
  isQuestionReady,
  type QuestionContent,
  type QuizContent,
  type RoundContent,
} from '@kwiz/domain'
import { AlertTriangle, Check, ChevronLeft, GripVertical, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { QuestionSheet } from '@/components/admin/question-sheet'
import { RoundDefaults } from '@/components/admin/round-defaults'
import { Button } from '@/components/ui/button'
import { Link, useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'
import { useReorder } from '@/lib/client/use-reorder'

/**
 * PRD 2 §7 — the `QUESTION_SET` round editor.
 *
 * Every row shows order, prompt, answer method, points, timer, attachment icons and a **readiness
 * marker**, because *"what is unfinished?"* is the question a master scanning this list has, and they
 * should never have to open anything to answer it.
 *
 * The marker comes from `isQuestionReady` — the same rules pre-flight runs (§10). A tick here and an
 * error there would be the same program telling a master two different things.
 */
export function QuestionSetEditor({
  quiz,
  round,
}: {
  quiz: QuizContent
  round: RoundContent
}) {
  const t = useTranslations('admin.round')
  const question = useTranslations('admin.question')
  const common = useTranslations('common')
  const router = useRouter()

  const [openIndex, setOpenIndex] = useState<number | undefined>()
  const [deleting, setDeleting] = useState<QuestionContent | undefined>()

  const refresh = (): void => router.refresh()

  /**
   * §15.2 — both reorder routes, one implementation. A question list has no pinned row, so the only
   * constraint is the ends, which the buttons already express through `disabled`.
   */
  const move = (id: string, direction: 'UP' | 'DOWN', steps: number): void => {
    void (async () => {
      for (let step = 0; step < steps; step += 1) {
        // oxlint-disable-next-line no-await-in-loop
        await api.moveQuestion(id, direction)
      }
      refresh()
    })()
  }

  const reorder = useReorder({
    canDrag: () => round.questions.length > 1,
    canDrop: () => true,
    onMove: move,
  })

  const add = async (): Promise<void> => {
    const result = await api.createQuestion(round.id)
    if (result.ok) {
      refresh()
      // Straight into the sheet: a master pressing "add question" wants to write one.
      setOpenIndex(round.questions.length)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/quizzes/${quiz.id}`}>
            <ChevronLeft className="size-4" />
            {t('backToQuiz')}
          </Link>
        </Button>
      </header>

      <RoundDefaults round={round} onChanged={refresh} />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('questions')}</h2>
          <Button
            onClick={() => {
              void add()
            }}
          >
            {t('addQuestion')}
          </Button>
        </div>

        {round.questions.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
            {t('empty')}
          </div>
        ) : (
          <ol className="divide-border border-border divide-y rounded-xl border">
            {round.questions.map((entry, index) => {
              const ready = isQuestionReady(entry, round)
              const timerMs = entry.timerMs ?? round.defaultTimerMs

              return (
                <li
                  key={entry.id}
                  {...reorder.rowProps(entry.id, index)}
                  className={[
                    'flex items-center gap-3 p-3',
                    reorder.draggingId === entry.id ? 'opacity-40' : '',
                    reorder.overId === entry.id ? 'border-primary border-t-2' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="text-muted-foreground w-6 text-center text-sm tabular-nums">
                    {index + 1}
                  </span>
                  <span
                    className="text-muted-foreground cursor-grab active:cursor-grabbing"
                    title={common('dragToReorder')}
                    aria-hidden
                  >
                    <GripVertical className="size-4" />
                  </span>

                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setOpenIndex(index)}
                  >
                    <span className="block truncate font-medium">
                      {entry.prompt.trim() === '' ? (
                        <span className="text-muted-foreground italic">
                          {t('untitled')}
                        </span>
                      ) : (
                        entry.prompt
                      )}
                    </span>
                    <span className="text-muted-foreground block text-sm">
                      {question(`method.${entry.answerMethod}`)} · {entry.points} ·{' '}
                      {timerMs === null ? '—' : `${Math.round(timerMs / 1000)}s`}
                      {entry.media.length > 0 ? ` · ${entry.media.length} 🎵` : ''}
                    </span>
                  </button>

                  {/* §7 — `✓` complete, `⚠` incomplete, computed live so half-typed work looks it. */}
                  <span
                    className={ready ? 'text-muted-foreground' : 'text-destructive'}
                    title={ready ? t('ready') : t('incomplete')}
                    aria-label={ready ? t('ready') : t('incomplete')}
                  >
                    {ready ? (
                      <Check className="size-4" />
                    ) : (
                      <AlertTriangle className="size-4" />
                    )}
                  </span>

                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={common('moveUp')}
                    disabled={index === 0}
                    onClick={() => {
                      move(entry.id, 'UP', 1)
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={common('moveDown')}
                    disabled={index === round.questions.length - 1}
                    onClick={() => {
                      move(entry.id, 'DOWN', 1)
                    }}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={common('delete')}
                    onClick={() => setDeleting(entry)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <QuestionSheet
        round={round}
        question={openIndex === undefined ? undefined : round.questions[openIndex]}
        index={openIndex ?? 0}
        total={round.questions.length}
        onClose={() => setOpenIndex(undefined)}
        onStep={(delta) =>
          setOpenIndex((current) => {
            const next = (current ?? 0) + delta
            return next >= 0 && next < round.questions.length ? next : current
          })
        }
        onChanged={refresh}
      />

      <ConfirmDialog
        open={deleting !== undefined}
        title={t('deleteQuestionTitle')}
        body={deleting?.prompt.trim() === '' ? t('untitled') : (deleting?.prompt ?? '')}
        confirmLabel={common('delete')}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          const target = deleting
          setDeleting(undefined)
          if (target) void api.deleteQuestion(target.id).then(refresh)
        }}
      />
    </main>
  )
}
