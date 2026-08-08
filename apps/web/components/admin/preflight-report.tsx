'use client'

import type { PreflightFinding, PreflightReport, QuizContent } from '@kwiz/domain'
import { AlertTriangle, Check, ChevronLeft, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'

/**
 * PRD 2 §10 — the pre-flight report.
 *
 * Errors first, then warnings, then the healthy count. Every row names **where** and links to it,
 * because a list of problems a master cannot navigate to is a list they will ignore.
 *
 * The copy comes from `admin.preflight.code.<CODE>` and the findings carry only a code plus numbers,
 * which is what keeps this screen and `@kwiz/domain`'s rules from drifting into two vocabularies.
 */
export function PreflightReportView({
  quiz,
  report,
  onContinue,
}: {
  quiz: QuizContent
  report: PreflightReport
  onContinue: () => void
}) {
  const t = useTranslations('admin.preflight')

  /** Where a finding is, in the words a master uses: "Round 2 · Q4". */
  const place = (finding: PreflightFinding): string => {
    const roundIndex = quiz.rounds.findIndex((round) => round.id === finding.roundId)
    if (roundIndex < 0) return quiz.name
    const round = quiz.rounds[roundIndex]
    const label = `${t('round', { number: roundIndex + 1 })} · ${round?.title ?? ''}`
    if (!finding.questionId) return label

    const questionIndex =
      round?.questions.findIndex((question) => question.id === finding.questionId) ?? -1
    return questionIndex < 0 ? label : `${label} · Q${questionIndex + 1}`
  }

  const href = (finding: PreflightFinding): string =>
    finding.roundId
      ? `/admin/quizzes/${quiz.id}/rounds/${finding.roundId}`
      : `/admin/quizzes/${quiz.id}`

  const row = (finding: PreflightFinding, index: number) => (
    <li key={`${finding.code}-${finding.questionId ?? finding.roundId ?? index}`}>
      <Link
        href={href(finding)}
        className="hover:bg-muted/50 flex items-start gap-3 rounded-lg p-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{place(finding)}</span>
          <span className="text-muted-foreground block text-sm">
            {t(`code.${finding.code}`, finding.detail ?? {})}
          </span>
        </span>
        <span className="text-muted-foreground shrink-0 text-sm">
          {finding.severity === 'ERROR' ? t('fix') : t('view')}
        </span>
      </Link>
    </li>
  )

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6 sm:p-10">
      <header>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/quizzes/${quiz.id}`}>
            <ChevronLeft className="size-4" />
            {quiz.name}
          </Link>
        </Button>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {t('heading', { name: quiz.name })}
        </h1>
      </header>

      {report.errors.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-destructive flex items-center gap-2 font-medium">
            <X className="size-4" />
            {t('problems', { count: report.errors.length })}
          </h2>
          <ul className="space-y-1">{report.errors.map(row)}</ul>
        </section>
      ) : null}

      {report.warnings.length > 0 ? (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" />
            {t('warnings', { count: report.warnings.length })}
          </h2>
          <ul className="space-y-1">{report.warnings.map(row)}</ul>
        </section>
      ) : null}

      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Check className="size-4" />
        {t('healthy', {
          questions: report.counts.questions,
          // §10 — verification is part of pre-flight, not an afterthought: re-hashing catches the
          // failure that is otherwise discovered live, with the room waiting for a song.
          attachments: report.counts.attachments,
          rounds: report.counts.rounds,
        })}
      </p>

      <footer className="flex justify-end gap-3">
        {report.errors.length > 0 ? (
          <Button asChild variant="ghost">
            <Link href={`/admin/quizzes/${quiz.id}`}>{t('fixProblems')}</Link>
          </Button>
        ) : null}
        {/*
          §10 — available **even with errors**. A broken question is marked on the master's control
          screen so they can skip it knowingly (PRD 3); refusing to start would protect the data and
          lose the evening.
        */}
        <Button onClick={onContinue}>
          {report.errors.length > 0 ? t('playAnyway') : t('setUpGame')}
        </Button>
      </footer>
    </main>
  )
}
