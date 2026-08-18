'use client'

import type { ReviewTeam } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ColourPicker } from '@/components/admin/colour-picker'
import { Input } from '@/components/ui/input'

/**
 * PRD 2 §13.4 — **renaming and recolouring works at any time, including after the game ends**
 * (`TEAM_UPDATED`): *"a master who typed 'Team 3' all night can fix it before exporting."*
 *
 * **Teams can never be deleted** (data model §11) — it would orphan answers and rewrite scores — so
 * there is no delete affordance here and no explaining one away.
 */
export function ReviewTeams({
  teams,
  onRename,
  onRecolour,
  busy,
}: {
  teams: ReviewTeam[]
  onRename: (teamId: string, name: string) => void
  onRecolour: (teamId: string, colour: string) => void
  /** The team id mid-write, like `ReviewGrid` and `ReviewAdjustments` — see `TeamName`. */
  busy: string | null
}) {
  const t = useTranslations('admin.review')

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{t('teamsHeading')}</h2>
      <ul className="border-border divide-border divide-y rounded-xl border">
        {teams.map((team) => (
          <li key={team.id} className="flex items-center gap-3 p-3">
            <ColourPicker
              colour={team.colour}
              taken={teams.filter((other) => other.id !== team.id).map((o) => o.colour)}
              onPick={(colour) => onRecolour(team.id, colour)}
            />
            {/*
              **Keyed by the name the server last confirmed.** The field holds local state so it can
              be typed into, and local state initialises once — so without this a rename that was
              refused, or that never left the browser, would sit in the box looking saved. Re-reading
              after every write is what makes the key move; a rejected write leaves it where it was
              and the box snaps back to the truth.
            */}
            <TeamName
              key={`${team.id}:${team.name}`}
              team={team}
              onRename={onRename}
              busy={busy === team.id}
            />
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {t('rankAndScore', { rank: team.rank, score: team.score })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Committed on blur, like §15.1's autosave everywhere else in this surface — no save button, and no
 * write on every keystroke either, which would put one event in the log per character.
 */
function TeamName({
  team,
  onRename,
  busy,
}: {
  team: ReviewTeam
  onRename: (teamId: string, name: string) => void
  /**
   * Disabled while this team's write is in flight, matching `ReviewGrid` and `ReviewAdjustments`.
   * A second edit landing before the first resolves would append two `TEAM_UPDATED` events for one
   * intention — harmless to the log, but the re-read between them would move the remount key under
   * a field someone is still typing in.
   */
  busy: boolean
}) {
  const t = useTranslations('admin.review')
  const [name, setName] = useState(team.name)

  return (
    <Input
      value={name}
      disabled={busy}
      aria-label={t('teamName')}
      onChange={(event) => setName(event.target.value)}
      onBlur={() => {
        const trimmed = name.trim()
        // An empty name is a slip, not an instruction: a nameless team is unidentifiable on every
        // other surface, and the row would still be there. Put the old one back rather than refuse.
        if (trimmed === '' || trimmed === team.name) {
          setName(team.name)
          return
        }
        onRename(team.id, trimmed)
      }}
      className="min-w-0 flex-1"
    />
  )
}
