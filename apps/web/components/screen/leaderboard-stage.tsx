'use client'

import type { MainScreenView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { JoinCode, Standings } from '@/components/screen/parts'
import type { Teams } from '@/components/screen/stage'

type LeaderboardView = Extract<MainScreenView['stage'], { kind: 'LEADERBOARD' }>

/**
 * PRD 4 §10 — `LEADERBOARD`.
 *
 * Shown between rounds, and on demand mid-round (PRD 3 §10.1). The two readings are different claims
 * about the same numbers, and the heading is all that separates them — which is why the server decides
 * which is true rather than this component guessing from a round's state.
 */
export function LeaderboardStage({
  stage,
  teams,
  code,
}: {
  stage: LeaderboardView
  teams: Teams
  code: string
}) {
  const t = useTranslations('screen.leaderboard')

  return (
    <section className="flex h-full w-full flex-col bg-neutral-950 p-[5cqh] text-neutral-50">
      <h1 className="shrink-0 text-center text-[7cqh] font-semibold tracking-[0.15em] text-neutral-300 uppercase">
        {stage.afterRoundNumber === null
          ? t('currentScores')
          : t('afterRound', { number: stage.afterRoundNumber })}
      </h1>

      <div className="flex min-h-0 flex-1 items-center py-[3cqh]">
        <Standings standings={stage.standings} teams={teams} />
      </div>

      <Provisional provisional={stage.provisional} />

      {/* O2 — the code returns on this stage, because a leaderboard is a pause and a pause is when a
          late arrival has time to join. */}
      <div className="flex shrink-0 justify-center">
        <JoinCode code={code} size={5} />
      </div>
    </section>
  )
}

/**
 * §10's `scores provisional · 3 answers still being checked`.
 *
 * *"The room must not be told a standing is final when it isn't — and it also nudges the master."*
 * That second clause is why the count is here and not just the flag: a master glancing at their own
 * projection gets the size of their backlog for free.
 *
 * This is the **only** validation state the room ever sees (protocol §5.2.1), and it is scoped to a
 * standing. A question says nothing about the master's queue.
 */
export function Provisional({
  provisional,
}: {
  provisional: LeaderboardView['provisional']
}) {
  const t = useTranslations('screen.leaderboard')
  if (!provisional) return null

  return (
    // At §2.1's absolute 4vh floor: nothing on this screen is exempt, including a caption.
    <p className="shrink-0 pb-[2cqh] text-center text-[4cqh] text-neutral-400">
      {t('provisional', { questions: provisional.questions })}
    </p>
  )
}
