'use client'

import type { FinaleView } from '@kwiz/domain'
import { FINALE_CLOCK_WARN_S } from '@kwiz/domain'
import { useTranslations } from 'next-intl'

import {
  useEliminationMoment,
  usePenaltyFlash,
  type Clock,
} from '@/components/screen/finale-moments'
import { FittedText } from '@/components/screen/fitted-text'
import { Dot } from '@/components/screen/parts'
import type { Teams } from '@/components/screen/stage'
import { useElapsed } from '@/lib/client/use-countdown'

/**
 * PRD 4 §12 — the `FINALE` stage (D50).
 *
 * **The climax, and the busiest this screen ever gets:** five keyword tiles, a clock per finalist, and
 * whose turn it is — all at §2.1's size floor. Which is why almost nothing else is on it.
 */
export function FinaleStage({ finale, teams }: { finale: FinaleView; teams: Teams }) {
  const t = useTranslations('screen.finale')

  // D52 — every clock is counted down here from `turnStartedAt`. The server pushes no ticks, so a
  // reconnect mid-turn resumes at the right number because the arithmetic is in the payload.
  const elapsed = useElapsed(finale.turnStartedAt)

  const remainingFor = (clock: Clock): number =>
    // §12.2 — **between turns nothing ticks.** All clocks hold and the marker disappears, so the room
    // can see that the handover isn't costing anyone.
    clock.onTurn
      ? Math.max(0, clock.secondsAtTurnStart - elapsed)
      : clock.secondsAtTurnStart

  const onTurn = finale.clocks.find((clock) => clock.onTurn)
  const others = finale.clocks.filter((clock) => !clock.onTurn)

  const eliminated = useEliminationMoment(finale.clocks)
  const penalty = usePenaltyFlash(finale.keywords, finale.penaltySeconds)

  if (eliminated.length > 0) return <EliminationMoment clocks={eliminated} />

  return (
    <section className="flex h-full w-full flex-col bg-neutral-950 p-[5cqh] text-neutral-50">
      <header className="flex shrink-0 items-start justify-between gap-[3cqh]">
        <div className="min-w-0 flex-1">
          <FittedText max={6} className="text-left font-semibold">
            {finale.prompt}
          </FittedText>
        </div>
        <p className="shrink-0 text-[4.5cqh] text-neutral-400 tabular-nums">
          {t('question', {
            number: finale.questionNumber,
            total: finale.questionTotal,
          })}
        </p>
      </header>

      <ol className="flex min-h-0 flex-1 flex-col justify-center gap-[2cqh] py-[2cqh]">
        {finale.keywords.map((keyword, index) => (
          <Keyword
            key={keyword.id}
            keyword={keyword}
            position={index + 1}
            teams={teams}
          />
        ))}
      </ol>

      {/*
        §12.2 — **the team on turn is on its own line, larger, in its colour**, with the marker. That
        team's clock is the one the room is watching.
      */}
      {onTurn ? (
        <div className="flex shrink-0 items-center gap-[3cqh]">
          <Dot colour={onTurn.colour} size={5} />
          <span className="text-[7cqh] font-semibold uppercase">{onTurn.name}</span>
          {/*
            No flash here. §12.3 is *"every **other** finalist loses time"* — the team that just found
            the keyword pays nothing, so a `−20s` on their own line would be a lie about the rule the
            whole round turns on.
          */}
          <ClockValue seconds={remainingFor(onTurn)} size={9} flash={null} />
          <span className="text-[4.5cqh] text-neutral-400">← {t('guessing')}</span>
        </div>
      ) : (
        <p className="shrink-0 text-[4.5cqh] text-neutral-500">{t('betweenTurns')}</p>
      )}

      {/*
        §12.2 — *"every other finalist's clock is on one strip below. **All of them, always** — a team
        about to be eliminated by someone else's correct guess is the tensest thing on screen and must
        be visible."*
      */}
      <ul className="flex shrink-0 flex-wrap items-center gap-x-[4cqh] gap-y-[1cqh] pt-[2cqh]">
        {others.map((clock) => (
          <li
            key={clock.teamId}
            className={`flex items-center gap-[1.5cqh] ${clock.eliminated ? 'opacity-50' : ''}`}
          >
            <Dot colour={clock.colour} size={2.8} />
            <span className="text-[4.5cqh]">{clock.name}</span>
            {clock.eliminated ? (
              // §12.2 — **eliminated teams read `OUT`, greyed, and stay listed.** Removing the row
              // would erase the drama of who has already gone.
              <span className="text-[4.5cqh] font-semibold tracking-widest text-neutral-500">
                {t('out')}
              </span>
            ) : (
              <ClockValue seconds={remainingFor(clock)} size={5.5} flash={penalty} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * §12.1 — **the blurred tiles (D53).**
 *
 * *"The payload never contains an unmarked keyword's text — only `wordLengths`. So a tile is **drawn**
 * from that shape rather than being blurred text."* Blurring transmitted text would leak it to anyone
 * with devtools; there is nothing here to un-blur.
 *
 * The per-word structure is the point: `"i like cows"` renders as three blocks of 1 / 4 / 4 with real
 * word gaps, so the room can see it is a three-word phrase starting with a one-letter word. That is a
 * genuine and fair hint, and one long bar would throw it away.
 */
function Keyword({
  keyword,
  position,
  teams,
}: {
  keyword: FinaleView['keywords'][number]
  position: number
  teams: Teams
}) {
  const marked = keyword.text !== undefined
  // `undefined` is unmarked; `null` is revealed-unguessed. Only a real id credits anybody.
  const credited = keyword.teamId ? teams.get(keyword.teamId) : undefined

  return (
    <li className="flex items-center gap-[3cqh]">
      <span className="w-[4cqh] shrink-0 text-[5cqh] text-neutral-500 tabular-nums">
        {position}
      </span>

      {marked ? (
        // §12.1 — *"on marking, the tile crossfades from blocks to the text with the crediting team's
        // name and colour beside it."*
        <span
          className="flex min-w-0 flex-1 items-center gap-[3cqh]"
          style={{ animation: 'kwiz-resolve 400ms ease-out' }}
        >
          <span className="text-[6.5cqh] font-semibold">{keyword.text}</span>
          {/*
            A revealed-unguessed tile resolves the same way but with **no team**: *"the absence is the
            point, so they get no marker rather than a placeholder one."* So this is a `credited` test
            rather than a `marked` one — nothing stands in for nobody.
          */}
          {credited ? (
            <span className="flex shrink-0 items-center gap-[1.5cqh] text-[4.5cqh] text-neutral-400">
              <Dot colour={credited.colour} size={2.8} />
              {credited.name}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="flex items-center gap-[2cqh]" aria-label="hidden keyword">
          {keyword.wordLengths.map((length, index) => (
            <span
              // Word position is the only identity a shape has.
              // oxlint-disable-next-line no-array-index-key
              key={index}
              className="block rounded-[0.6cqh] bg-neutral-700"
              // Sized per character so the shape is proportional to the word, which is what makes it
              // a hint rather than a placeholder.
              style={{ width: `${length * 2.6}cqh`, height: '5cqh' }}
            />
          ))}
        </span>
      )}
    </li>
  )
}

/**
 * §12.2 — whole seconds, **never `m:ss`** (D57).
 *
 * *"A room watching a 20-second penalty land needs to see `84` become `64`, not perform a base-60
 * conversion."* It is also the largest legible format at §2.1's scale — two or three digits rather than
 * four glyphs and a colon.
 *
 * **Under 15 seconds a clock pulses**, on §7's reasoning at a threshold suited to a bank of seconds
 * rather than a question timer: colour alone is unreliable at §2.2's contrast.
 */
function ClockValue({
  seconds,
  size,
  flash,
}: {
  seconds: number
  size: number
  /** §12.3's `−20s`, shown beside the value for a moment after a mark. */
  flash: number | null
}) {
  const whole = Math.max(0, Math.ceil(seconds))
  const urgent = whole > 0 && whole <= FINALE_CLOCK_WARN_S

  return (
    <span className="flex items-baseline gap-[1cqh]">
      <span
        className={`font-semibold tabular-nums ${urgent ? 'text-orange-400' : ''}`}
        style={{
          fontSize: `${size}cqh`,
          ...(urgent ? { animation: 'kwiz-urgent 1s ease-in-out infinite' } : {}),
        }}
      >
        {whole}
      </span>
      {flash === null ? null : (
        /*
         * Never below §2.1's absolute `4cqh` floor. It was `size * 0.55` — 3.03cqh beside a strip
         * clock — which is the same mistake as the Jeopardy category names, in the same slice, for
         * the same reason: "smaller than the thing beside it" is a *relative* instruction and the
         * floor is an absolute one. §2.1 exempts nothing, and a `−20s` the back tables cannot read
         * is a penalty they cannot follow.
         */
        <span
          className="font-semibold text-orange-400 tabular-nums"
          style={{ fontSize: `${Math.max(4, size * 0.55)}cqh` }}
        >
          −{flash}s
        </span>
      )}
    </span>
  )
}

/**
 * §12.4 — **elimination gets a moment of its own.**
 *
 * *"The team's name at hero scale, in colour, `OUT` beneath it, held briefly before the screen returns
 * to the turn."*
 *
 * Worth interrupting the stage for two reasons §12.4 states: it is one of the few genuinely dramatic
 * beats in a quiz, and elimination can happen **off-turn** — a penalty can take a waiting team to zero
 * — so without an announcement the room would just notice a row had greyed out.
 */
function EliminationMoment({ clocks }: { clocks: Clock[] }) {
  const t = useTranslations('screen.finale')
  // Several names at maximum scale do not fit, so a shared moment steps down rather than overflowing —
  // the same trade §10.2's winner line makes for a tie, and §2.3 forbids clipping either way.
  const size = clocks.length > 1 ? 10 : 16

  return (
    <section
      className="flex h-full w-full flex-col items-center justify-center gap-[3cqh] bg-neutral-950 text-neutral-50"
      style={{ animation: 'kwiz-resolve 300ms ease-out' }}
    >
      {clocks.map((clock) => (
        <div key={clock.teamId} className="flex items-center gap-[3cqh]">
          <Dot colour={clock.colour} size={size * 0.5} />
          <span
            className="leading-none font-semibold uppercase"
            style={{ fontSize: `${size}cqh` }}
          >
            {clock.name}
          </span>
        </div>
      ))}
      <p className="text-[10cqh] font-semibold tracking-[0.3em] text-orange-400 uppercase">
        {t('out')}
      </p>
    </section>
  )
}
