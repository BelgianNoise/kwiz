'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { z } from 'zod'

import type { TeamRow } from '@/components/admin/game-detail'

/**
 * The slice of `MasterControlView` this component consumes — not the whole view.
 *
 * Conventions §10.1 does not list an inbound SSE frame, but it does list `localStorage` reads for
 * the same reason: a client parsing a string it did not construct should narrow before trusting it.
 * `.loose()` is the load-bearing part — a view that grows a field must not stop the counts updating,
 * so this asserts what is needed and ignores the rest.
 */
const framePayload = z
  .object({
    teams: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          colour: z.string(),
          deviceCount: z.number(),
        })
        .loose(),
    ),
  })
  .loose()

/**
 * PRD 2 §12's device counts — **live information on an otherwise static page.**
 *
 * It lets the master see who has actually joined and chase the table that has not, which is the whole
 * job of this page while people are arriving. It uses the `MASTER_CONTROL` stream rather than polling
 * (protocol §2.1, D2): the counts are already in that view, so there is nothing to add server-side.
 *
 * A failed stream is not an error state here. The counts came from the server render and are simply
 * not updating; a page full of red because a laptop slept would be worse than a stale number.
 */
export function LiveTeams({ gameId, initial }: { gameId: string; initial: TeamRow[] }) {
  const t = useTranslations('admin.game')
  const [teams, setTeams] = useState(initial)

  useEffect(() => {
    const source = new EventSource(`/api/live/${gameId}/control`)

    const onState = (event: Event): void => {
      if (!(event instanceof MessageEvent)) return
      const data: unknown = event.data
      if (typeof data !== 'string') return

      const parsed = framePayload.safeParse(JSON.parse(data))
      if (!parsed.success) return

      setTeams(
        parsed.data.teams.map((team) => ({
          id: team.id,
          name: team.name,
          colour: team.colour,
          deviceCount: team.deviceCount,
        })),
      )
    }

    source.addEventListener('state', onState)
    return () => source.close()
  }, [gameId])

  const joined = teams.filter((team) => team.deviceCount > 0).length

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">{t('teams')}</h2>
        <span className="text-muted-foreground text-sm">
          {t('devicesJoined', { count: joined, total: teams.length })}
        </span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {teams.map((team) => (
          <li key={team.id} className="flex items-center gap-3">
            {/* Colour is always paired with the name, never the sole identifier (PRD 1 §9.5). */}
            <span
              aria-hidden
              className="border-border size-4 shrink-0 rounded-full border"
              style={{ backgroundColor: team.colour }}
            />
            <span className="min-w-0 flex-1 truncate">{team.name}</span>
            <span className="text-muted-foreground text-sm">
              {t('devices', { count: team.deviceCount })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
