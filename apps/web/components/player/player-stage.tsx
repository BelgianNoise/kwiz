'use client'

import type { PlayerView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { FinaleStage } from '@/components/player/finale'
import { Dot, PlayerStandings, TeamBadge } from '@/components/player/parts'
import { QuestionStage } from '@/components/player/question'
import { useCountdown } from '@/lib/client/use-countdown'
import { minuteSeconds } from '@/lib/format'

/**
 * PRD 5 §3 — exactly one stage at a time, rendered from `PlayerView.stage`.
 *
 * No `default`: a stage the server can send and this cannot draw should be a compile error, not a
 * blank phone. Same reasoning as the main screen's switch, for a surface where blank is even harder
 * to diagnose — nobody is standing next to the phone that broke.
 */
export function PlayerStage({
  view,
  gameId,
  token,
}: {
  view: PlayerView
  gameId: string
  token: string
}) {
  const stage = view.stage

  switch (stage.kind) {
    case 'WAITING':
      return <Waiting view={view} teamCount={stage.teamCount} />
    case 'BETWEEN_QUESTIONS':
      return <BetweenQuestions view={view} />
    case 'QUESTION':
      return <QuestionStage view={view} stage={stage} gameId={gameId} token={token} />
    case 'JEOPARDY_BOARD':
      return <Board view={view} stage={stage} />
    case 'BREAK':
      return <Break view={view} stage={stage} />
    case 'FINALE':
      return <FinaleStage view={view} stage={stage} />
    case 'FINISHED':
      return <Finished view={view} standings={stage.standings} />
  }

  const unhandled: never = stage
  return unhandled
}

/**
 * §4 — the gentle wait screen. Its job is reassurance: *you are in, you are on the right team,
 * nothing is required of you.*
 *
 * **The team name and colour are the largest thing**, because the one mistake a player can make here
 * is being on the wrong team and this is where they would notice. **No spinner** — a spinner says
 * something is loading, nothing is, and it invites a reload, which is the one thing that could
 * actually go wrong.
 */
function Waiting({ view, teamCount }: { view: PlayerView; teamCount: number }) {
  const t = useTranslations('player.game')
  return (
    <section className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-6 p-6 text-center">
      <TeamBadge view={view} big />
      <p className="text-2xl font-medium">{t('youreIn')}</p>
      {/* Points at the main screen, which is where the next thing happens. */}
      <p className="text-muted-foreground text-lg">{t('watchTheScreen')}</p>
      <p className="text-muted-foreground text-lg">
        {t('teamsReady', { count: teamCount })}
      </p>
    </section>
  )
}

/** §3 — a calm holding state between questions. The same job as `WAITING`, minus the welcome. */
function BetweenQuestions({ view }: { view: PlayerView }) {
  const t = useTranslations('player.game')
  return (
    <section className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
      <TeamBadge view={view} />
      <p className="text-muted-foreground text-lg">{t('watchTheScreen')}</p>
      <p className="text-lg tabular-nums">{view.team.score}</p>
    </section>
  )
}

/**
 * §9 — the board, mirrored **read-only** (D16).
 *
 * *"Not interactive — no tap targets, no hover states, nothing that suggests it is."* Tiles are chosen
 * by telling the master out loud, and the line of copy says so explicitly, because a grid on a
 * touchscreen invites tapping. Values and used state only, never prompts (PRD 1 §7 invariant 5) —
 * and the payload does not carry them, so there is nothing here to leak.
 */
function Board({
  view,
  stage,
}: {
  view: PlayerView
  stage: Extract<PlayerView['stage'], { kind: 'JEOPARDY_BOARD' }>
}) {
  const t = useTranslations('player.game')
  const { categories, tiles } = stage.board
  const values = [...new Set(tiles.map((tile) => tile.points))].sort((a, b) => a - b)
  const picker = [view.team, ...view.otherTeams].find(
    (team) => team.id === stage.currentPickerTeamId,
  )

  return (
    <section className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 p-4">
      {/* §9 — the current picker is named at the top, so a team knows whether it is their call. */}
      {picker ? (
        <p className="flex items-center gap-2 text-lg font-medium">
          <Dot colour={picker.colour} />
          {t('picks', { team: picker.name })}
        </p>
      ) : null}

      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}
      >
        {categories.map((category) => (
          <p
            key={category.id}
            // §9 — category names abbreviate on narrow screens; values are the readable element,
            // since values are what teams call out.
            className="text-muted-foreground truncate text-center text-xs uppercase"
          >
            {category.name}
          </p>
        ))}
        {values.map((value) =>
          categories.map((category) => {
            const tile = tiles.find(
              (candidate) =>
                candidate.categoryId === category.id && candidate.points === value,
            )
            return (
              <span
                key={`${category.id}-${value}`}
                className="bg-muted flex min-h-12 items-center justify-center rounded-md text-lg font-semibold tabular-nums"
              >
                {tile === undefined ? '' : tile.used ? '—' : value}
              </span>
            )
          }),
        )}
      </div>

      <p className="text-muted-foreground text-lg">{t('tellTheMaster')}</p>
    </section>
  )
}

/**
 * §10 — the break.
 *
 * *"The countdown matters more here than on the projector: the phone is in the pocket of someone
 * standing at the bar"* — which is exactly the person it needs to reach. Counted against the absolute
 * `resumesAt` (PRD 4 §11), `m:ss` per conventions §8.2, and *"back shortly"* when no duration was set.
 */
function Break({
  view,
  stage,
}: {
  view: PlayerView
  stage: Extract<PlayerView['stage'], { kind: 'BREAK' }>
}) {
  const t = useTranslations('player.game')
  const seconds = useCountdown(stage.resumesAt)

  return (
    <section className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-5">
      <div className="pt-8 text-center">
        <p className="text-muted-foreground text-xl tracking-widest uppercase">
          {seconds === null ? t('backShortly') : t('backIn')}
        </p>
        {seconds === null ? null : (
          <p className="text-6xl font-bold tabular-nums">{minuteSeconds(seconds)}</p>
        )}
      </div>
      <PlayerStandings standings={stage.standings} view={view} />
    </section>
  )
}

/** §11 — the final standings, with the team's own row highlighted, and it stays up. */
function Finished({
  view,
  standings,
}: {
  view: PlayerView
  standings: Extract<PlayerView['stage'], { kind: 'FINISHED' }>['standings']
}) {
  const t = useTranslations('player.game')
  return (
    <section className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-5">
      <h1 className="pt-6 text-center text-3xl font-semibold">{t('finished')}</h1>
      <PlayerStandings standings={standings} view={view} />
    </section>
  )
}
