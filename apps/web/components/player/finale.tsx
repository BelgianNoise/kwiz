'use client'

import type { FinaleView, PlayerView } from '@kwiz/domain'
import { FINALE_CLOCK_WARN_S } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import { Dot } from '@/components/player/parts'
import { useElapsed } from '@/lib/client/use-countdown'

type Stage = Extract<PlayerView['stage'], { kind: 'FINALE' }>

/**
 * PRD 5 §10.1 — the finale, **watch-only**.
 *
 * It is played out loud (PRD 1 §8.8): nothing is typed, tapped or buzzed, so this screen has no
 * controls at all — *"not a disabled one"*, the same rule as §8.1's `DO`, because a greyed field
 * invites a team to try to type an answer that would never count.
 *
 * Far from idle, though: **a team's clock is the most important number of their evening**, and this
 * is the one stretch where the table stares at a phone for minutes without touching it.
 */
export function FinaleStage({ view, stage }: { view: PlayerView; stage: Stage }) {
  const t = useTranslations('player.finale')
  const finale = stage.finale

  // D52 — counted down here from `turnStartedAt`; the server never ticks. Identical arithmetic to the
  // projector's, so a table glancing between the two never sees them disagree.
  const elapsed = useElapsed(finale.turnStartedAt)
  const secondsFor = (clock: FinaleView['clocks'][number]): number =>
    clock.onTurn
      ? Math.max(0, clock.secondsAtTurnStart - elapsed)
      : clock.secondsAtTurnStart

  const mine = finale.clocks.find((clock) => clock.teamId === view.team.id)
  const onTurn = finale.clocks.find((clock) => clock.onTurn)

  return (
    <section className="mx-auto flex min-h-dvh max-w-lg flex-col gap-5 p-5">
      {/*
        §10.1 — **your own clock is the largest thing on the screen.** Not the keywords, not whose
        turn it is: the number that decides whether your team survives, and the thing the table will
        stare at while someone else guesses.
      */}
      {mine ? (
        <MyClock clock={mine} seconds={secondsFor(mine)} />
      ) : (
        <Spectator view={view} />
      )}

      <hr className="border-border" />

      {onTurn ? (
        <div className="flex items-center gap-3">
          <Dot colour={onTurn.colour} />
          <span className="min-w-0 flex-1 truncate text-lg">{onTurn.name}</span>
          <span className="text-muted-foreground text-lg">{t('guessingNow')}</span>
          {/* Whole seconds, never `m:ss` (D57) — identical to the projector. */}
          <span className="text-2xl font-semibold tabular-nums">
            {Math.max(0, Math.ceil(secondsFor(onTurn)))}
          </span>
        </div>
      ) : (
        <p className="text-muted-foreground text-lg">{t('betweenTurns')}</p>
      )}

      <ol className="flex flex-col gap-3">
        {finale.keywords.map((keyword, index) => (
          <Keyword key={keyword.id} keyword={keyword} position={index + 1} view={view} />
        ))}
      </ol>

      {/*
        §10.1 — *"'You're up next' when the team is `nextTeamId`."* Turn order is recomputed live, so a
        team's position can change while they wait; telling them means the table is ready rather than
        caught out.
      */}
      {finale.nextTeamId === view.team.id && !onTurn?.teamId ? (
        <p className="text-xl font-semibold">{t('youreUpNext')}</p>
      ) : null}
    </section>
  )
}

/** The team's own bank — eliminated teams see `0` and `OUT`, and keep watching the rest (§10.1). */
function MyClock({
  clock,
  seconds,
}: {
  clock: FinaleView['clocks'][number]
  seconds: number
}) {
  const t = useTranslations('player.finale')
  const whole = Math.max(0, Math.ceil(seconds))
  const urgent = !clock.eliminated && whole > 0 && whole <= FINALE_CLOCK_WARN_S

  return (
    <div className="flex flex-col items-center gap-2 pt-4">
      <div className="flex items-center gap-3">
        <Dot colour={clock.colour} className="size-5" />
        <span className="text-xl font-medium">{clock.name}</span>
      </div>
      {clock.eliminated ? (
        <p className="text-5xl font-bold tracking-widest uppercase">{t('out')}</p>
      ) : (
        <p
          className={`text-7xl font-bold tabular-nums ${urgent ? 'text-destructive' : ''}`}
          style={
            urgent ? { animation: 'kwiz-urgent 1s ease-in-out infinite' } : undefined
          }
        >
          {whole}
        </p>
      )}
    </div>
  )
}

/**
 * §10.1 — *"non-finalists get a spectator variant: the tiles, the clocks, and a line explaining they
 * are not in the finale and their placing is already set."*
 */
function Spectator({ view }: { view: PlayerView }) {
  const t = useTranslations('player.finale')
  return (
    <div className="flex flex-col items-center gap-2 pt-4 text-center">
      <span className="text-xl font-medium">{view.team.name}</span>
      <p className="text-muted-foreground text-lg">{t('notInFinale')}</p>
    </div>
  )
}

/**
 * §10.1 — **the same blurred word shapes as the main screen** (D53), from the identical `wordLengths`.
 *
 * A team huddled over a phone gets exactly what the room gets, which matters because they will be
 * reading their phone rather than looking up. There is no text to un-blur: the payload does not carry
 * an unmarked keyword's text at all.
 */
function Keyword({
  keyword,
  position,
  view,
}: {
  keyword: FinaleView['keywords'][number]
  position: number
  view: PlayerView
}) {
  const credited =
    keyword.teamId === null || keyword.teamId === undefined
      ? undefined
      : [view.team, ...view.otherTeams].find((team) => team.id === keyword.teamId)

  return (
    <li className="flex items-center gap-3">
      <span className="text-muted-foreground w-5 shrink-0 tabular-nums">{position}</span>
      {keyword.text === undefined ? (
        <span className="flex items-center gap-2" aria-label="hidden keyword">
          {keyword.wordLengths.map((length, index) => (
            <span
              // Word position is the only identity a shape has.
              // oxlint-disable-next-line no-array-index-key
              key={index}
              className="bg-muted-foreground/60 block h-5 rounded"
              // Proportional to the word, which is what makes it a hint rather than a placeholder.
              style={{ width: `${length * 0.7}rem` }}
            />
          ))}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-lg font-medium">{keyword.text}</span>
          {/* `null` is revealed-unguessed, and gets no marker: the absence is the point. */}
          {credited ? (
            <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-base">
              <Dot colour={credited.colour} className="size-3" />
              {credited.name}
            </span>
          ) : null}
        </span>
      )}
    </li>
  )
}
