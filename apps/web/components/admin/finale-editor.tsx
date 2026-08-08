'use client'

import {
  dsmtwFinaleRoundConfigSchema,
  isQuestionReady,
  pointsPerSecond,
  quizPoints,
  secondsForScore,
  secondsPerPointFromRate,
  suggestFinaleQuestions,
  type QuestionContent,
  type QuizContent,
  type RoundContent,
} from '@kwiz/domain'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  GripVertical,
  Pin,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { QuestionSheet } from '@/components/admin/question-sheet'
import { RoundDefaults } from '@/components/admin/round-defaults'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Link, useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'
import { useReorder } from '@/lib/client/use-reorder'

/** A typical pub. Remembered per quiz would be better; it is a local assumption either way (§9). */
const TEAM_ASSUMPTIONS = [2, 4, 6, 8]

/**
 * PRD 2 §9 — the finale editor: a list of keyword questions plus **two numbers that decide how the
 * round feels**.
 *
 * The rate is shown **working**, not just entered: what a concrete score converts to, what the quiz
 * is worth, and what a strong team would therefore start with. A rate entered blind is the single
 * easiest way to produce a finale that ends in one question or drags for twenty minutes.
 *
 * The suggested question count moves as the penalty changes, which is the point — dropping the
 * penalty from 20 s to 5 s takes the suggestion from 5 questions to 17 (conventions §8.1), and no
 * master is going to intuit that.
 */
export function FinaleEditor({
  quiz,
  round,
}: {
  quiz: QuizContent
  round: RoundContent
}) {
  const t = useTranslations('admin.finale')
  const roundCopy = useTranslations('admin.round')
  const common = useTranslations('common')
  const router = useRouter()

  const parsed = dsmtwFinaleRoundConfigSchema.safeParse(round.config)
  const config = parsed.success
    ? parsed.data
    : { secondsPerPoint: 0.5, penaltySeconds: 20 }

  /** §9's field asks "[2] points = 1 second"; the stored value is seconds per point. */
  const [rate, setRate] = useState(pointsPerSecond(config.secondsPerPoint))
  const [penalty, setPenalty] = useState(config.penaltySeconds)
  /**
   * §9 — *"defaulting to a typical count and remembered per quiz"*. Per **quiz**, so a master with a
   * pub game and a corporate game does not have to re-pick each time they open one.
   *
   * `localStorage` rather than the database: it is an authoring assumption about a game that does
   * not exist yet, not quiz content, and it must not travel in an export (§14) to a machine where
   * someone else's room size is wrong.
   */
  const [teams, setTeams] = useState(4)

  useEffect(() => {
    const saved = Number(globalThis.localStorage?.getItem(assumedTeamsKey(quiz.id)))
    if (Number.isInteger(saved) && saved >= 2) setTeams(saved)
  }, [quiz.id])

  const rememberTeams = (count: number): void => {
    setTeams(count)
    globalThis.localStorage?.setItem(assumedTeamsKey(quiz.id), String(count))
  }

  const [openIndex, setOpenIndex] = useState<number | undefined>()
  const [deleting, setDeleting] = useState<QuestionContent | undefined>()

  const refresh = (): void => router.refresh()

  /** §15.2 — the finale's question bank reorders like any other list (§9's mockup shows handles). */
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

  const save = (nextRate: number, nextPenalty: number): void => {
    void api
      .updateRound(round.id, {
        config: {
          secondsPerPoint: secondsPerPointFromRate(nextRate),
          penaltySeconds: nextPenalty,
        },
      })
      .then(refresh)
  }

  const total = quizPoints(quiz)
  const secondsPerPoint = secondsPerPointFromRate(rate)
  const topSeconds = secondsForScore(total, secondsPerPoint)
  const suggested = suggestFinaleQuestions(
    Array.from({ length: teams }, () => topSeconds),
    penalty,
  )
  const short = round.questions.length < suggested

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/quizzes/${quiz.id}`}>
            <ChevronLeft className="size-4" />
            {common('back')}
          </Link>
        </Button>
      </header>

      {/* §9 — the positional constraint is stated at the top, not buried in pre-flight. */}
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Pin className="size-4" />
        {t('pinnedNote')}
      </p>

      <RoundDefaults round={round} onChanged={refresh} />

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="finale-rate">{t('rate')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="finale-rate"
              type="number"
              min={0.1}
              step={0.5}
              value={rate}
              className="w-24"
              onChange={(event) => {
                const next = Number(event.target.value)
                setRate(next)
                if (next > 0) save(next, penalty)
              }}
            />
            <span className="text-muted-foreground text-sm">{t('rateSuffix')}</span>
          </div>
          {/* The conversion, shown working. Three numbers rather than a field on its own. */}
          <p className="text-muted-foreground text-sm">
            {t('rateWorked', {
              score: 340,
              seconds: secondsForScore(340, secondsPerPoint),
            })}
          </p>
          <p className="text-muted-foreground text-sm">
            {t('rateQuizTotal', { points: total, seconds: topSeconds })}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="finale-penalty">{t('penalty')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="finale-penalty"
              type="number"
              min={0}
              value={penalty}
              className="w-24"
              onChange={(event) => {
                const next = Number(event.target.value)
                setPenalty(next)
                if (Number.isInteger(next) && next >= 0) save(rate, next)
              }}
            />
            <span className="text-muted-foreground text-sm">{t('penaltySuffix')}</span>
          </div>
          {/* §9 — re-offered at game setup, because the right value depends on the team count (D54). */}
          <p className="text-muted-foreground text-sm">{t('penaltyNote')}</p>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{roundCopy('questions')}</h2>
          <div className="flex items-center gap-3">
            {/* Sits on the Questions header, where the master is already looking while adding. */}
            <span className="text-muted-foreground text-sm">
              {t('suggested', { have: round.questions.length, suggested })}
            </span>
            <Select
              value={String(teams)}
              onValueChange={(next) => rememberTeams(Number(next))}
            >
              <SelectTrigger
                className="w-40"
                aria-label={t('assumeTeams', { count: teams })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEAM_ASSUMPTIONS.map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {t('assumeTeams', { count })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => {
                void api.createQuestion(round.id).then((result) => {
                  if (result.ok) {
                    refresh()
                    setOpenIndex(round.questions.length)
                  }
                })
              }}
            >
              {roundCopy('addQuestion')}
            </Button>
          </div>
        </div>

        {round.questions.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
            {roundCopy('empty')}
          </div>
        ) : (
          <ol className="divide-border border-border divide-y rounded-xl border">
            {round.questions.map((entry, index) => {
              const ready = isQuestionReady(entry, round)
              const filled = entry.keywords.filter(
                (keyword) => keyword.text.trim() !== '',
              ).length

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
                          {roundCopy('untitled')}
                        </span>
                      ) : (
                        entry.prompt
                      )}
                    </span>
                    {/* §9 — "did I finish that one?" is the question while scanning this list. */}
                    <span className="text-muted-foreground block text-sm">
                      {t('keywordCount', { count: filled })}
                    </span>
                  </button>

                  <span className={ready ? 'text-muted-foreground' : 'text-destructive'}>
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

        {/*
          §9 — a shortfall is a **warning, never a block**. Over-supplying questions is free, since
          the round ends at one survivor whatever is left over, so the honest advice is "add a few
          more than you think" — and the master may know their room better than the model.
        */}
        {short ? (
          <p className="text-destructive flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {t('shortfall', {
              teams,
              penalty,
              suggested,
              have: round.questions.length,
            })}
          </p>
        ) : null}
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
        title={roundCopy('deleteQuestionTitle')}
        body={
          deleting?.prompt.trim() === ''
            ? roundCopy('untitled')
            : (deleting?.prompt ?? '')
        }
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

/** Namespaced and per quiz, so two quizzes in one browser do not share an assumption. */
function assumedTeamsKey(quizId: string): string {
  return `kwiz.assumedTeams.${quizId}`
}
