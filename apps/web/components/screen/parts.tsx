'use client'

import type { Standing, TeamPublic } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import type { Teams } from '@/components/screen/stage'
import { useCountUp } from '@/lib/client/use-count-up'

/**
 * The handful of shapes more than one stage draws, at **this surface's** scale.
 *
 * Deliberately not shared with `components/control` (CLAUDE.md §7): the same dot at 0.5 m and at 10 m
 * is two different components that happen to look alike in a screenshot. Four surfaces, four type
 * scales, and reusing one surface's sizing on another is how a projector ends up with control's
 * density.
 */

/**
 * PRD 1 §9.5 — **colour is never the sole identifier.** Every dot here is beside a name, always, and
 * that is a hard rule rather than a default: a projector's colour reproduction is poor and
 * inconsistent (§2.2), and two teams who picked adjacent palette entries can look identical on a pub
 * wall even though the palette guarantees they don't on a monitor.
 */
export function Dot({ colour, size = 3 }: { colour: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ backgroundColor: colour, width: `${size}cqh`, height: `${size}cqh` }}
    />
  )
}

/** A hollow dot — §4's "has not joined yet". Rendered as a ring so it reads as *absence*, not as a colour. */
export function HollowDot({ colour, size = 3 }: { colour: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        border: `0.4cqh solid ${colour}`,
        opacity: 0.55,
        width: `${size}cqh`,
        height: `${size}cqh`,
      }}
    />
  )
}

/**
 * §4 / §10 / §11's join code — *"letter-spaced, in a font where `0/O`, `1/I` and `5/S` are
 * unmistakable. It is read aloud across a noisy room and typed by someone squinting."*
 *
 * The alphabet already excludes the worst offenders (conventions §2), so the job here is not to
 * reintroduce ambiguity: tabular figures, and a wide letter-space so the room reads six separate
 * characters rather than a word.
 */
export function JoinCode({ code, size }: { code: string; size: number }) {
  return (
    <p
      className="font-semibold tabular-nums"
      style={{ fontSize: `${size}cqh`, letterSpacing: '0.18em' }}
    >
      {code}
    </p>
  )
}

/**
 * §10's standings, shared by `LEADERBOARD`, `BREAK` and `FINISHED`.
 *
 * The overflow ladder is §10's, in order: *"above ~10 teams it becomes two columns, then drops the
 * movement indicator, then compresses to rank/name/score."* It **never scrolls** (§2.3) and never
 * shows a partial list — an audience member whose team is missing assumes a bug, which is a worse
 * outcome than a cramped row.
 */
export function Standings({
  standings,
  teams,
  movement = true,
}: {
  standings: Standing[]
  teams: Teams
  /** §11's break shows standings without arrows: nothing has moved since the round ended. */
  movement?: boolean
}) {
  const twoColumns = standings.length > 10
  /*
   * **§10's three rungs collapsed to two, deliberately.** The spec's ladder is *"two columns, then
   * drop the movement indicator, then compress to rank/name/score"*; here the second rung fires with
   * the first, and the third never does.
   *
   * The third rung only earns its place past roughly 30 teams, and PRD 1 §2.1's envelope stops at 20 —
   * CLAUDE.md §9 names optimising beyond that envelope as something to compromise on freely. Recorded
   * rather than left to be rediscovered, since a reader comparing this to §10 will notice.
   */
  const showMovement = movement && !twoColumns
  const size = twoColumns ? 4.5 : 6

  return (
    <ol
      className="grid w-full gap-y-[1cqh]"
      style={{
        gridTemplateColumns: twoColumns ? '1fr 1fr' : '1fr',
        columnGap: '6cqh',
        fontSize: `${size}cqh`,
      }}
    >
      {standings.map((standing) => (
        <Row
          key={standing.teamId}
          standing={standing}
          team={teams.get(standing.teamId)}
          showMovement={showMovement}
          size={size}
        />
      ))}
    </ol>
  )
}

function Row({
  standing,
  team,
  showMovement,
  size,
}: {
  standing: Standing
  team: TeamPublic | undefined
  showMovement: boolean
  size: number
}) {
  return (
    <li className="flex items-center gap-[2cqh]">
      {/*
        D32 — **ties share a rank and show it.** Both rows read `2`, and neither is silently ordered
        above the other. Nothing here marks which of two tied teams came first, because nothing knows.
      */}
      <span className="w-[5cqh] shrink-0 text-right text-neutral-400 tabular-nums">
        {standing.rank}
      </span>
      <Dot colour={team?.colour ?? '#737373'} size={size * 0.55} />
      <span className="min-w-0 flex-1 truncate">{team?.name}</span>
      {/* §15 — *"numbers count up rather than snapping."* `tabular-nums` matters more here than
          anywhere: without it every digit change would shift the row's width while it counts. */}
      <Score value={standing.score} />
      {showMovement ? <Movement places={standing.movement} size={size} /> : null}
    </li>
  )
}

/**
 * §15 — *"a score changing from 290 to 340 should be seen changing."*
 *
 * The same job as the rest of §15's table: make a change noticeable to someone who was looking at
 * their phone (§1.1). A snap is a change only the people already watching that row will register, and
 * a leaderboard is exactly the moment nobody is watching a specific row yet.
 */
function Score({ value }: { value: number }) {
  return <span className="shrink-0 font-semibold tabular-nums">{useCountUp(value)}</span>
}

/**
 * §10's `▲2` — *"the cheapest drama available, and it costs one number. It is what makes a
 * leaderboard a moment rather than a table."*
 *
 * Three states, and the difference between the last two matters: `—` says *held its place*, and an
 * empty cell says *there is nothing to compare against* (the first leaderboard of the game, or a team
 * that joined after the last one). Showing `—` for both would tell the room a new team had held a
 * position it never had.
 */
function Movement({ places, size }: { places: number | null; size: number }) {
  const t = useTranslations('screen.leaderboard')

  if (places === null) return <span className="w-[7cqh] shrink-0" aria-hidden />

  if (places === 0) {
    return (
      <span
        className="w-[7cqh] shrink-0 text-neutral-500"
        aria-label={t('movementHeld')}
        style={{ fontSize: `${size * 0.8}cqh` }}
      >
        —
      </span>
    )
  }

  const up = places > 0
  return (
    <span
      className={`w-[7cqh] shrink-0 tabular-nums ${up ? 'text-emerald-400' : 'text-orange-400'}`}
      // Colour is not carrying this on its own — the arrow glyph is the signal and survives a
      // projector that crushes both hues into grey (§2.2).
      aria-label={t(up ? 'movementUp' : 'movementDown', { places: Math.abs(places) })}
      style={{ fontSize: `${size * 0.8}cqh` }}
    >
      {up ? '▲' : '▼'}
      {Math.abs(places)}
    </span>
  )
}
