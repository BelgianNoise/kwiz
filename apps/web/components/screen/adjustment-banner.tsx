'use client'

import type { Notice, TeamPublic } from '@kwiz/domain'
import { SCORE_BANNER_MS } from '@kwiz/domain'
import { useEffect, useState } from 'react'

import { Dot } from '@/components/screen/parts'
import type { Teams } from '@/components/screen/stage'

/**
 * PRD 4 §10.1 — the score adjustment banner (D25).
 *
 * *"It's a pub quiz — a visible '+5, best heckle of the night' is part of the entertainment, and hiding
 * the reason makes a correction look arbitrary to the room."*
 *
 * **Driven by a `notice`, not by state**, and that is the distinction protocol §2.3 exists for: an
 * adjustment is a *moment*. Sent as state it would be indistinguishable from state that was already
 * there and would re-fire on every reconnect — a projector that blinked would re-announce a +5 from
 * twenty minutes ago. Notices are lossy by design, and missing one costs a banner, never a fact: the
 * score itself is on the next `state` frame regardless.
 *
 * Three suppressions, all of them the server's decision rather than this component's:
 *
 * - `announced: false` never produces a notice at all (D25's per-adjustment opt-out).
 * - **A revocation produces no banner** (D41) — undoing a mistake is not an announcement, and
 *   re-announcing would draw attention to the error. There is no revocation notice to receive.
 * - Nothing before `GAME_STARTED` or after `GAME_FINISHED`, including a late team's opening balance,
 *   which is an ordinary adjustment made while the game is still in `SETUP`.
 */
export function AdjustmentBanner({
  notice,
  teams,
}: {
  notice: Notice | null
  teams: Teams
}) {
  const shown = useTransient(notice)
  if (!shown || shown.kind !== 'SCORE_ADJUSTED') return null

  const team: TeamPublic | undefined = teams.get(shown.teamId)

  return (
    /*
     * §10.1 — *"a lower band. Occupies dead space at the bottom of whatever stage is showing; if a
     * question is open or revealing it goes **below** the content, never over it."*
     *
     * So it is inside the safe area and inside the frame, but outside the stage's own layout: absolute
     * at the bottom, where every stage above leaves its points line or its join code and where nothing
     * carries the question itself.
     */
    <div
      className="pointer-events-none absolute bottom-[5cqh] left-[5cqh] flex items-center gap-[2cqh] rounded-[1.5cqh] bg-neutral-800/95 px-[3cqh] py-[1.5cqh]"
      style={{ animation: 'kwiz-resolve 300ms ease-out' }}
    >
      <Dot colour={team?.colour ?? '#737373'} size={3.5} />
      <div className="flex flex-col">
        <span className="flex items-baseline gap-[1.5cqh] text-[5cqh] font-semibold">
          {team?.name}
          {/* Signed, always — `+5` and `−5` are different announcements and the sign is the whole of it. */}
          <span className={shown.delta < 0 ? 'text-orange-400' : 'text-emerald-400'}>
            {shown.delta > 0 ? '+' : '−'}
            {Math.abs(shown.delta)}
          </span>
        </span>
        {/* At §2.1's floor: a reason nobody at the back can read is the same as no reason. */}
        {shown.reason ? (
          <span className="text-[4cqh] text-neutral-300">{shown.reason}</span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Hold a notice for §10.1's ~6 seconds, then drop it.
 *
 * Keyed on the notice object's identity: `useLiveView` hands over a freshly parsed object per frame, so
 * two identical `+5 best heckle` adjustments in a row are two banners rather than one that never
 * reappears. Nothing about the *content* is compared, deliberately — a master correcting two teams by
 * the same amount is a real thing that happens.
 */
function useTransient(notice: Notice | null): Notice | null {
  const [shown, setShown] = useState<Notice | null>(null)

  useEffect(() => {
    if (!notice) return undefined
    setShown(notice)
    const timer = setTimeout(() => setShown(null), SCORE_BANNER_MS)
    return () => clearTimeout(timer)
  }, [notice])

  return shown
}
