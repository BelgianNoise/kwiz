'use client'

import type { AdvanceSuggestion } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { usePrimaryAction, type ZoneProps } from '@/components/control/control-desk'
import { TeamDot } from '@/components/control/team-dot'
import { Button } from '@/components/ui/button'

/**
 * `attention: NONE` — *"show the leaderboard, big"* (§3.1 priority 8), with the suggested action
 * under it when there is one.
 *
 * This is what the desk looks like between rounds and during a break, and it is the answer to the
 * question the master is asked more than any other.
 */
export function Leaderboard({ view, api, run }: ZoneProps) {
  const ranked = [...view.teams].sort((a, b) => b.score - a.score)

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <ol className="space-y-2 text-xl">
        {ranked.map((team, index) => (
          <li key={team.id} className="flex items-center gap-3">
            <span className="text-muted-foreground w-6 tabular-nums">{index + 1}</span>
            <TeamDot colour={team.colour} className="size-4" />
            <span className="min-w-0 flex-1 truncate">{team.name}</span>
            <span className="tabular-nums">{team.score}</span>
          </li>
        ))}
      </ol>

      <AdvanceButton view={view} api={api} run={run} />
    </section>
  )
}

/**
 * §3.1 priority 7 — *"nothing is wrong; the master decides the pace"*, as one button.
 *
 * The suggestion is chosen server-side (protocol §5.4) and this only renders it, so the desk cannot
 * develop a second opinion about what comes next. `Enter` is bound to whatever this is (§13).
 */
export function AdvanceButton({ view, api, run }: ZoneProps) {
  const t = useTranslations('control.question')
  const suggestion: AdvanceSuggestion | null =
    view.attention.kind === 'ADVANCE' ? view.attention.suggestion : null

  const nextPending = view.timeline.find((entry) => entry.state === 'PENDING')
  const questionId = view.question?.gameQuestionId

  const action = ((): { label: string; call: () => void } | null => {
    if (view.status !== 'LIVE') return null

    switch (suggestion) {
      case 'LOCK':
        return questionId
          ? { label: t('close'), call: () => run(() => api.lockQuestion(questionId)) }
          : null
      case 'REVEAL':
        return questionId
          ? { label: t('reveal'), call: () => run(() => api.revealQuestion(questionId)) }
          : null
      case 'NEXT_QUESTION':
        return nextPending
          ? {
              label: t('openNext'),
              call: () => run(() => api.openQuestion(nextPending.gameQuestionId)),
            }
          : null
      case 'NEXT_ROUND': {
        const round = view.round
        const next = round?.nextRoundId
        if (!round || !next) return null
        return {
          label: t('nextRound'),
          /*
           * Close, then open. Both events matter: `ROUND_CLOSED` is what PRD 3 §6.2 hangs the
           * validation sweep on, and skipping it would leave a round that was played and never
           * ended in the log. Chained rather than fired together because the second is refused
           * while the first has not landed.
           */
          call: () =>
            run(async () => {
              const closed = await api.closeRound(round.id)
              return closed.ok ? api.openRound(next) : closed
            }),
        }
      }
      case 'FINISH':
        return { label: t('finishGame'), call: () => run(() => api.finish()) }
      default:
        return null
    }
  })()

  usePrimaryAction(action?.call ?? null)
  if (!action) return null

  return (
    <Button size="lg" onClick={action.call}>
      {action.label}
    </Button>
  )
}
