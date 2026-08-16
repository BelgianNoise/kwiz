'use client'

import type { ReviewCell, ReviewQuestion, ReviewRound, ReviewTeam } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

/**
 * PRD 2 §13.1 — **a grid of questions × teams**, because *"did I mark that consistently?"* is the
 * actual question a master has, and it is only answerable side by side.
 *
 * `Radio Head ✗` sitting next to `radiohead ✓` makes an inconsistency obvious in a way a
 * per-question list never would. That is the whole design: the grid is not a table of data, it is a
 * comparison.
 */
export function ReviewGrid({
  round,
  teams,
  onToggle,
  busy,
}: {
  round: ReviewRound
  teams: ReviewTeam[]
  /** Appends `ANSWER_VALIDATED` (protocol §4.3) — the caller re-reads afterwards. */
  onToggle: (question: ReviewQuestion, cell: ReviewCell) => void
  busy: string | null
}) {
  const t = useTranslations('admin.review')

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">
          {t('roundHeading', { position: round.position + 1, title: round.title })}
        </h2>
        {/*
          §13.1 — *"a per-round count of corrections is shown — visible, not hidden, because an
          auditable correction is the point."*
        */}
        {round.corrections > 0 ? (
          <span className="text-muted-foreground text-sm">
            {t('correctionCount', { count: round.corrections })}
          </span>
        ) : null}
      </header>

      {round.questions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('emptyRound')}</p>
      ) : (
        // Wide grids scroll inside their own container rather than pushing the page sideways.
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className="text-muted-foreground w-64 min-w-48 p-3 text-left font-medium">
                  {t('question')}
                </th>
                {teams.map((team) => (
                  <th
                    key={team.id}
                    className="text-muted-foreground min-w-36 p-3 text-left font-medium"
                  >
                    <span className="flex items-center gap-2">
                      {/* PRD 1 §9.5 — colour never alone; the name is right beside it. */}
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: team.colour }}
                      />
                      <span className="truncate">{team.name}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {round.questions.map((question) => (
                <QuestionRow
                  key={question.id}
                  question={question}
                  teams={teams}
                  onToggle={onToggle}
                  busy={busy}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function QuestionRow({
  question,
  teams,
  onToggle,
  busy,
}: {
  question: ReviewQuestion
  teams: ReviewTeam[]
  onToggle: (question: ReviewQuestion, cell: ReviewCell) => void
  busy: string | null
}) {
  const t = useTranslations('admin.review')

  return (
    <tr className="border-border border-b align-top last:border-b-0">
      <th scope="row" className="p-3 text-left font-normal">
        <span className="text-muted-foreground mr-2 tabular-nums">
          Q{question.position + 1}
        </span>
        <span className="font-medium">{question.prompt}</span>
        {/*
          §13.1's own mockup carries this under the grid: *"Correct answer: Radiohead · also
          accepted: …"*. It is what makes a verdict checkable rather than merely visible — the
          master is deciding whether a cell is right, and cannot do that without it.
        */}
        {question.correctAnswer === null ? null : (
          <span className="text-muted-foreground mt-1 block text-xs">
            {t('correctAnswer', { answer: question.correctAnswer })}
            {question.alsoAccepted.length > 0
              ? ` · ${t('alsoAccepted', { answers: question.alsoAccepted.join(', ') })}`
              : ''}
          </span>
        )}
      </th>
      {teams.map((team) => {
        const cell = question.cells.find((candidate) => candidate.teamId === team.id)
        return (
          <td key={team.id} className="p-1.5">
            {cell ? (
              <Cell
                cell={cell}
                question={question}
                onToggle={onToggle}
                busy={busy === `${question.id}:${team.id}`}
              />
            ) : null}
          </td>
        )
      })}
    </tr>
  )
}

/** Whether a verdict earned the points — the only thing the tick and the cross actually mean. */
const awarded = (verdict: ReviewCell['verdict']): boolean =>
  verdict === 'ACCEPTED' || verdict === 'AUTO_CORRECT'

function Cell({
  cell,
  question,
  onToggle,
  busy,
}: {
  cell: ReviewCell
  question: ReviewQuestion
  onToggle: (question: ReviewQuestion, cell: ReviewCell) => void
  busy: boolean
}) {
  const t = useTranslations('admin.review')
  const answeredNothing = cell.answer === null && cell.verdict === 'PENDING'

  return (
    <button
      type="button"
      // §13.1 — *"clicking any cell toggles the verdict."* A team that never answered has nothing to
      // judge, so its cell is inert rather than a button that would invent an answer to accept.
      disabled={answeredNothing || busy}
      onClick={() => onToggle(question, cell)}
      title={answeredNothing ? undefined : t('toggleHint')}
      className={`flex w-full flex-col gap-1 rounded-lg border p-2 text-left transition-colors disabled:cursor-default ${
        cell.corrections > 0 ? 'border-primary' : 'border-transparent'
      } ${answeredNothing ? '' : 'hover:bg-muted'}`}
    >
      <span className="flex items-start gap-1.5">
        <span aria-hidden className="shrink-0">
          {answeredNothing ? '—' : awarded(cell.verdict) ? '✓' : '✗'}
        </span>
        <span className="min-w-0 flex-1 break-words">
          {cell.answer ?? <span className="text-muted-foreground">{t('noAnswer')}</span>}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">{cell.points}</span>
      </span>

      <span className="text-muted-foreground flex flex-wrap gap-2 text-xs">
        {/* §13.1 — corrected cells are marked. The count, not just a dot: twice is a different story. */}
        {cell.corrections > 0 ? (
          <span className="text-primary">
            {t('corrected', { count: cell.corrections })}
          </span>
        ) : null}
        {/* D26 — the server committed a stored draft; the team never pressed Submit. */}
        {cell.fromDraft ? <span>{t('fromDraft')}</span> : null}
        {/* D47 — the master typed this for a table whose phone had died. */}
        {cell.byMaster ? <span>{t('byMaster')}</span> : null}
      </span>
    </button>
  )
}
