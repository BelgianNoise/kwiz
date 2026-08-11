'use client'

import type { FinaleView } from '@kwiz/domain'
import {
  FINALE_CLOCK_WARN_S,
  FINALE_ELIMINATION_HOLD_MS,
  FINALE_PENALTY_FLASH_MS,
} from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { FittedText } from '@/components/screen/fitted-text'
import { Dot } from '@/components/screen/parts'
import { useElapsed } from '@/lib/client/use-countdown'

type Clock = FinaleView['clocks'][number]

/**
 * PRD 4 §12 — the `FINALE` stage (D50).
 *
 * **The climax, and the busiest this screen ever gets:** five keyword tiles, a clock per finalist, and
 * whose turn it is — all at §2.1's size floor. Which is why almost nothing else is on it.
 */
export function FinaleStage({ finale }: { finale: FinaleView }) {
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

  if (eliminated) return <EliminationMoment clock={eliminated} />

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
          <Keyword key={keyword.id} keyword={keyword} position={index + 1} />
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
}: {
  keyword: FinaleView['keywords'][number]
  position: number
}) {
  const marked = keyword.text !== undefined

  return (
    <li className="flex items-center gap-[3cqh]">
      <span className="w-[4cqh] shrink-0 text-[5cqh] text-neutral-500 tabular-nums">
        {position}
      </span>

      {marked ? (
        // §12.1 — *"on marking, the tile crossfades from blocks to the text"*, with the crediting team
        // beside it. A revealed-unguessed tile resolves the same way but with **no team**: the absence
        // is the point, so it gets no marker rather than a placeholder one.
        <span
          className="text-[6.5cqh] font-semibold"
          style={{ animation: 'kwiz-resolve 400ms ease-out' }}
        >
          {keyword.text}
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
        <span
          className="font-semibold text-orange-400 tabular-nums"
          style={{ fontSize: `${size * 0.55}cqh` }}
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
function EliminationMoment({ clock }: { clock: Clock }) {
  const t = useTranslations('screen.finale')

  return (
    <section
      className="flex h-full w-full flex-col items-center justify-center gap-[3cqh] bg-neutral-950 text-neutral-50"
      style={{ animation: 'kwiz-resolve 300ms ease-out' }}
    >
      <div className="flex items-center gap-[3cqh]">
        <Dot colour={clock.colour} size={8} />
        <span className="text-[16cqh] leading-none font-semibold uppercase">
          {clock.name}
        </span>
      </div>
      <p className="text-[10cqh] font-semibold tracking-[0.3em] text-orange-400 uppercase">
        {t('out')}
      </p>
    </section>
  )
}

/**
 * Which team just went out, for the length of §12.4's hold.
 *
 * Detected from `eliminatedAt` **changing**, not from `eliminated` being true — which is exactly why
 * that field went on the payload. A boolean cannot distinguish an elimination that just happened from
 * one this screen already announced, so a reconnect mid-round would replay the moment for a team that
 * went out ten minutes ago.
 *
 * `null` on the first view for the same reason: a screen that connects to a round already in progress
 * has missed those moments, and inventing them would be worse than letting them pass.
 */
function useEliminationMoment(clocks: Clock[]): Clock | null {
  const seen = useRef<Set<string> | null>(null)
  const [moment, setMoment] = useState<Clock | null>(null)

  useEffect(() => {
    const out = new Set(
      clocks.filter((clock) => clock.eliminatedAt !== null).map((clock) => clock.teamId),
    )
    const previous = seen.current
    seen.current = out

    if (previous === null) return undefined

    const fresh = clocks.find(
      (clock) => clock.eliminatedAt !== null && !previous.has(clock.teamId),
    )
    if (!fresh) return undefined

    setMoment(fresh)
    const timer = setTimeout(() => setMoment(null), FINALE_ELIMINATION_HOLD_MS)
    return () => clearTimeout(timer)
  }, [clocks])

  return moment
}

/**
 * §12.3 — **the penalty moment.**
 *
 * *"When a keyword is marked, every other finalist loses time. That must be seen, or the room cannot
 * follow why a clock jumped: every other clock flashes and visibly subtracts — a brief `−20s` beside
 * each, then the new value. Counting down smoothly would hide the size of the hit; a jump with a label
 * shows it."*
 *
 * Triggered by the count of marked keywords growing, which is the same "changed, not true" reasoning as
 * the elimination moment: a reconnect holding three marked keywords must not flash three penalties.
 *
 * Returns the penalty in seconds while the flash is live. Eliminated teams don't flash — they have
 * stopped paying — and that is enforced at the call site, which never renders a clock for them.
 */
function usePenaltyFlash(
  keywords: FinaleView['keywords'],
  penaltySeconds: number,
): number | null {
  const marked = keywords.filter((keyword) => keyword.text !== undefined).length
  const seen = useRef<number | null>(null)
  const [flash, setFlash] = useState<number | null>(null)

  useEffect(() => {
    const previous = seen.current
    seen.current = marked
    /*
     * Only on the way **up**. An un-mark (§10.4) returns the penalty to everyone it was taken from, and
     * a `−20s` beside a clock that just went *up* would say the opposite of what happened. The corrected
     * numbers still arrive on the next view, so the room sees the reversal — just without a label
     * claiming it was a charge.
     */
    if (previous === null || marked <= previous) return undefined

    setFlash(penaltySeconds)
    const timer = setTimeout(() => setFlash(null), FINALE_PENALTY_FLASH_MS)
    return () => clearTimeout(timer)
  }, [marked, penaltySeconds])

  return flash
}
