'use client'

import { AdvanceButton } from '@/components/control/advance-button'
import type { ZoneProps } from '@/components/control/control-desk'
import { TeamDot } from '@/components/control/team-dot'

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
