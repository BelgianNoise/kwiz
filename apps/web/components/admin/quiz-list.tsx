'use client'

import { MoreHorizontal } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { ExportDialog } from '@/components/admin/export-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'

export interface QuizRow {
  id: string
  name: string
  description: string | null
  updatedAt: string
  rounds: number
  questions: number
  /** How many played games this quiz has, so the delete confirmation can name what survives. */
  games: number
}

/**
 * PRD 2 §5's quiz section.
 *
 * **`[Play]` is the primary action, not `[Edit]`** — the verb a master reaches for is "run this",
 * and editing is the occasional act.
 */
export function QuizList({ quizzes }: { quizzes: QuizRow[] }) {
  const t = useTranslations('admin.dashboard')
  const common = useTranslations('common')
  const format = useFormatter()
  const router = useRouter()

  const nameRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<QuizRow | undefined>()
  const [exporting, setExporting] = useState<QuizRow | undefined>()
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    const result = await api.createQuiz(name.trim())
    setBusy(false)
    if (result.ok && result.data) {
      setCreating(false)
      setName('')
      router.push(`/admin/quizzes/${result.data.quizId}`)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('quizzes')}</h2>
        <Button onClick={() => setCreating(true)}>{t('newQuiz')}</Button>
      </div>

      {quizzes.length === 0 ? (
        // An empty state is a designed screen, not a blank area (§15.2) — and this is the very
        // first thing a master ever sees.
        <div className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center">
          <p className="text-foreground font-medium">{t('emptyQuizzes')}</p>
          <p className="mt-1 text-sm">{t('emptyQuizzesDetail')}</p>
        </div>
      ) : (
        <ul className="divide-border border-border divide-y rounded-xl border">
          {quizzes.map((quiz) => (
            <li key={quiz.id} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{quiz.name}</p>
                <p className="text-muted-foreground text-sm">
                  {t('rounds', { count: quiz.rounds })} ·{' '}
                  {t('questions', { count: quiz.questions })} ·{' '}
                  {t('edited', {
                    date: format.dateTime(new Date(quiz.updatedAt), {
                      day: 'numeric',
                      month: 'short',
                    }),
                  })}
                </p>
              </div>

              <Button
                variant="secondary"
                onClick={() => router.push(`/admin/quizzes/${quiz.id}/play`)}
              >
                {t('play')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push(`/admin/quizzes/${quiz.id}`)}
              >
                {t('open')}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={quiz.name}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      void api.duplicateQuiz(quiz.id).then(() => router.refresh())
                    }}
                  >
                    {t('duplicate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setExporting(quiz)}>
                    {t('export')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setDeleting(quiz)}
                    variant="destructive"
                  >
                    {common('delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      {exporting ? (
        <ExportDialog
          open
          quizId={exporting.id}
          quizName={exporting.name}
          games={exporting.games}
          onClose={() => setExporting(undefined)}
        />
      ) : null}

      <Dialog open={creating} onOpenChange={setCreating}>
        {/* Focus the one field, without the `autoFocus` attribute jsx-a11y bans. */}
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            nameRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('newQuizTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-quiz-name">{t('newQuizLabel')}</Label>
            <Input
              ref={nameRef}
              id="new-quiz-name"
              value={name}
              placeholder={t('newQuizPlaceholder')}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim() !== '') void create()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {common('cancel')}
            </Button>
            <Button
              disabled={name.trim() === '' || busy}
              onClick={() => {
                void create()
              }}
            >
              {common('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        §5 and §15.2: a destructive confirmation **names the loss** — and here it also names what
        survives, because masters assume deleting a quiz destroys their played history and so never
        clean up. Games keep their own copies (data model §10).
      */}
      <ConfirmDialog
        open={deleting !== undefined}
        title={t('deleteQuizTitle', { name: deleting?.name ?? '' })}
        body={t('deleteQuizKeepsGames', { count: deleting?.games ?? 0 })}
        confirmLabel={common('delete')}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          const target = deleting
          setDeleting(undefined)
          if (target) void api.deleteQuiz(target.id).then(() => router.refresh())
        }}
      />
    </section>
  )
}
