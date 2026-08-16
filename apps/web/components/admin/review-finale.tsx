'use client'

import type { ReviewFinale, ReviewTeam } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

/**
 * PRD 2 §13.2 — the finale's record.
 *
 * **Read-only, deliberately**, and it says so on the page. *"A clock that ran is a fact, and
 * re-litigating an elimination after the fact would rewrite a result the room already saw."* Every
 * other review surface allows correction, so stating this one's exception is better than leaving a
 * master hunting for an edit affordance that was never going to exist.
 *
 * The honest reason it cannot be corrected: a mis-mark charged *seconds*, and only fixing it during
 * the round (PRD 3 §10.4's `Shift`+`n`) can give them back.
 */
export function ReviewFinaleSection({
  finale,
  teams,
}: {
  finale: ReviewFinale
  teams: ReviewTeam[]
}) {
  const t = useTranslations('admin.review')
  const named = new Map(teams.map((team) => [team.id, team]))
  const winner = finale.wonByTeamId === null ? null : named.get(finale.wonByTeamId)

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">{t('finaleHeading')}</h2>
        {winner ? (
          <span className="text-muted-foreground text-sm">
            {t('wonBy', { team: winner.name })}
          </span>
        ) : null}
      </header>

      <p className="text-muted-foreground text-sm">{t('finaleReadOnly')}</p>

      <div className="border-border space-y-4 rounded-xl border p-4">
        {finale.questions.map((question) => (
          <div key={question.id} className="space-y-2">
            <h3 className="font-medium">
              <span className="text-muted-foreground mr-2 tabular-nums">
                Q{question.position + 1}
              </span>
              {question.prompt}
            </h3>
            <ul className="space-y-1 text-sm">
              {question.keywords.map((keyword) => {
                const by = keyword.teamId === null ? null : named.get(keyword.teamId)
                return (
                  <li key={keyword.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate">{keyword.text}</span>
                    {by ? (
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: by.colour }}
                        />
                        {by.name}
                      </span>
                    ) : (
                      /*
                        §13.2 — *"`— nobody` distinguishes a keyword nobody found from one never
                        reached."* Two different facts about how far the round got, and collapsing
                        them would misreport it.
                      */
                      <span className="text-muted-foreground shrink-0">
                        {keyword.reached ? t('nobody') : t('notReached')}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left">
              <th className="py-2 font-medium">{t('finalist')}</th>
              <th className="py-2 text-right font-medium">{t('started')}</th>
              <th className="py-2 text-right font-medium">{t('ended')}</th>
              <th className="py-2 text-right font-medium">{t('out')}</th>
            </tr>
          </thead>
          <tbody>
            {finale.finalists.map((finalist) => {
              const team = named.get(finalist.teamId)
              return (
                <tr
                  key={finalist.teamId}
                  className="border-border border-b last:border-b-0"
                >
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: team?.colour ?? '#737373' }}
                      />
                      {team?.name}
                    </span>
                  </td>
                  {/* Whole seconds throughout (D57) — the same unit the room counted down in. */}
                  <td className="py-2 text-right tabular-nums">
                    {finalist.startedSeconds}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {finalist.endedSeconds}
                  </td>
                  <td className="text-muted-foreground py-2 text-right tabular-nums">
                    {finalist.survived ? t('survived') : clockTime(finalist.eliminatedAt)}
                  </td>
                </tr>
              )
            })}
            {finale.nonFinalistIds.map((teamId) => {
              const team = named.get(teamId)
              return (
                <tr
                  key={teamId}
                  className="border-border text-muted-foreground border-b last:border-b-0"
                >
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: team?.colour ?? '#737373' }}
                      />
                      {team?.name}
                    </span>
                  </td>
                  {/* Never played it, so there is no clock to report — an em dash, not a zero. */}
                  <td className="py-2 text-right">—</td>
                  <td className="py-2 text-right">—</td>
                  <td className="py-2 text-right">{t('didNotPlay')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** conventions §8.2 — an elimination is an **instant**, so `HH:mm`, never a duration. */
function clockTime(at: number | null): string {
  if (at === null) return '—'
  const when = new Date(at)
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
}
