'use client'

import type { PlayerView, Standing } from '@kwiz/domain'
import { rankAmong } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

/**
 * The shapes more than one player stage draws, at **this** surface's scale.
 *
 * Phone scale is its own thing (CLAUDE.md §7): 0.3 m in the hand, 44 px targets, and text large by
 * default because *"two or three people read this screen at once from an angle"* (§13). Nothing here
 * is shared with `components/screen` or `components/control` — the same row at 10 m, at 0.5 m and in
 * a hand is three components that happen to look alike in a screenshot.
 */

/** PRD 1 §9.5 — colour is never the sole identifier, so every dot here sits beside a name. */
export function Dot({
  colour,
  className = 'size-4',
}: {
  colour: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: colour }}
    />
  )
}

/**
 * §10 and §11's standings, with **the team's own row marked**.
 *
 * *"Live rank and score are always present"* (protocol P2): it is public information already on the
 * projector, and hiding it on phones would make the two surfaces disagree — which reads as a bug
 * rather than as suspense.
 */
export function PlayerStandings({
  standings,
  view,
}: {
  standings: Standing[]
  view: PlayerView
}) {
  const named = new Map(
    [view.team, ...view.otherTeams].map((team) => [team.id, team] as const),
  )

  return (
    <ol className="flex flex-col gap-2">
      {standings.map((standing) => {
        const team = named.get(standing.teamId)
        const mine = standing.teamId === view.team.id
        return (
          <li
            key={standing.teamId}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-lg ${
              mine ? 'bg-muted font-semibold' : ''
            }`}
          >
            {/* D32 — ties share a rank and show it; nothing here orders one above the other. */}
            <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">
              {standing.rank}
            </span>
            <Dot colour={team?.colour ?? '#737373'} />
            <span className="min-w-0 flex-1 truncate">{team?.name}</span>
            <span className="shrink-0 tabular-nums">{standing.score}</span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * §11's `Quizzly Bears   340   2nd` — **the team's own live rank**, derived rather than pushed.
 *
 * `rankAmong` is D32's rule, and it lives in `domain` beside `standings` with a test asserting the
 * two agree: the phone and the projector disagreeing about a team's place would read as a bug, and
 * two copies of a shared-rank rule is exactly how that happens.
 */
export const ownRank = (view: PlayerView): number =>
  rankAmong(
    view.team.score,
    view.otherTeams.map((team) => team.score),
  )

/**
 * §13 — an ordinal, in the viewer's language, because *"2nd"* and *"2e"* are not the same word and a
 * bare number beside a score reads as a second score.
 */
export function OwnStanding({ view }: { view: PlayerView }) {
  const t = useTranslations('player.game')
  return (
    <p className="text-muted-foreground flex items-center gap-3 pt-4 text-lg">
      <Dot colour={view.team.colour} />
      <span className="min-w-0 flex-1 truncate">{view.team.name}</span>
      <span className="tabular-nums">{view.team.score}</span>
      <span className="tabular-nums">{t('rank', { rank: ownRank(view) })}</span>
    </p>
  )
}

/**
 * The team's identity, which §4 makes the largest thing on the waiting screen.
 *
 * *"The one mistake a player can make here is being on the wrong team, and this is where they'd
 * notice."* Used wherever the phone should reassure rather than instruct.
 */
export function TeamBadge({ view, big = false }: { view: PlayerView; big?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${big ? 'flex-col gap-4' : ''}`}>
      <Dot colour={view.team.colour} className={big ? 'size-12' : 'size-4'} />
      <span className={big ? 'text-4xl font-semibold' : 'text-lg font-medium'}>
        {view.team.name}
      </span>
    </div>
  )
}
