'use client'

import type { MainScreenQuestion } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

import { Dot } from '@/components/screen/parts'
import type { Teams } from '@/components/screen/stage'
import { playBuzz } from '@/lib/client/screen-sound'

type Buzzes = NonNullable<MainScreenQuestion['buzzes']>

/**
 * PRD 4 §8.3 — the buzz display.
 *
 * **This is the moment; it needs no explanation**, which is why the prompt is not on screen here. The
 * team name dominates, in their colour, at hero scale.
 */
export function BuzzDisplay({
  buzzes,
  lockedOutTeamIds,
  teams,
}: {
  buzzes: Buzzes
  lockedOutTeamIds: string[]
  teams: Teams
}) {
  const t = useTranslations('screen.question')
  const lockedOut = new Set(lockedOutTeamIds)

  const ordered = [...buzzes].sort((a, b) => a.offsetMs - b.offsetMs)
  // Whoever is being judged, or was accepted. `NOT_FIRST` buzzes arrived during adjudication and were
  // never judged (I10), so they are listed but never the hero.
  const leader = ordered.find(
    (buzz) => buzz.outcome === 'AWAITING' || buzz.outcome === 'ACCEPTED',
  )

  useBuzzSound(ordered.length)

  return (
    <section className="flex h-full w-full flex-col justify-center gap-[3cqh]">
      {leader ? (
        <>
          <div className="flex items-center justify-center gap-[3cqh]">
            <Dot colour={teams.get(leader.teamId)?.colour ?? '#737373'} size={7} />
            <span className="text-[14cqh] leading-none font-semibold tracking-wide uppercase">
              {teams.get(leader.teamId)?.name}
            </span>
          </div>
          {/*
            §8.3 — **two decimal places.** `4.21` versus `4.28` is the drama; whole seconds would
            flatten a photo finish into a tie (conventions §8.2's buzz-timing format).
          */}
          <p className="text-center text-[12cqh] leading-none font-semibold tabular-nums">
            {seconds(leader.offsetMs)}
          </p>
        </>
      ) : (
        /*
         * §8.3 — *"on a denial the display flips to the reopened state loudly enough to be caught
         * peripherally: the buzzed team's name struck through, `BUZZERS OPEN` at hero scale."*
         *
         * Reached when every buzz so far has been denied, so nobody is being judged and the buzzers are
         * live again (D35's loop). The struck-through names are below, in the same list as always.
         */
        <p className="text-center text-[13cqh] leading-none font-semibold tracking-widest text-emerald-400 uppercase">
          {t('buzzersOpen')}
        </p>
      )}

      {/*
        §8.3 — *"other buzzes are listed below at body size, so a team that lost by 70 ms can see it.
        This is the record that settles arguments"* (D35).
      */}
      <ul className="flex flex-wrap items-center justify-center gap-x-[4cqh] gap-y-[1cqh] text-[5cqh] text-neutral-300">
        {ordered
          .filter((buzz) => buzz.teamId !== leader?.teamId)
          .map((buzz) => (
            <li
              key={buzz.teamId + buzz.offsetMs}
              className="flex items-center gap-[1.5cqh]"
            >
              <Dot colour={teams.get(buzz.teamId)?.colour ?? '#737373'} size={2.5} />
              {/*
                §8.3 — **a locked-out team is struck through rather than removed**: the room should see
                who has already had a go, which is also what makes a reopened buzzer fair to watch.
              */}
              <span
                className={lockedOut.has(buzz.teamId) ? 'line-through opacity-60' : ''}
              >
                {teams.get(buzz.teamId)?.name} {seconds(buzz.offsetMs)}
              </span>
            </li>
          ))}
      </ul>
    </section>
  )
}

/** conventions §8.2 — buzz timings are the one place two decimals are wanted. */
function seconds(offsetMs: number): string {
  return `${(offsetMs / 1000).toFixed(2)}s`
}

/**
 * §13's buzz sound — *"marks an instant. Nothing visual replaces a sound for 'right now', and half the
 * room is looking at a phone."*
 *
 * Fired when the buzz **count grows**, so each buzz sounds once and a reconnect that arrives holding
 * three existing buzzes stays silent. protocol P3 — main screen only: twenty phones buzzing a fraction
 * of a second apart is the same failure as twenty phones playing the same song.
 */
function useBuzzSound(count: number): void {
  const seen = useRef<number | null>(null)

  useEffect(() => {
    const previous = seen.current
    seen.current = count
    // `null` is the first render of this question — including a reconnect mid-question, where the
    // buzzes on screen already happened and their moment has passed.
    if (previous !== null && count > previous) playBuzz()
  }, [count])
}
