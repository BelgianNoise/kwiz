'use client'

import type { MainScreenView, Notice, TeamPublic } from '@kwiz/domain'
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
  stage,
}: {
  notice: Notice | null
  teams: Teams
  /** §10.1's third suppression needs to know whether a game is under way. */
  stage: MainScreenView['stage']['kind']
}) {
  const shown = useTransient(notice)
  if (!shown || shown.kind !== 'SCORE_ADJUSTED') return null

  /*
   * §10.1 — *"never shown for adjustments made before `GAME_STARTED` or after `GAME_FINISHED`."*
   *
   * Guarded here rather than by suppressing the notice, because the notice is not only the room's:
   * control shows the same one as a §3.2 toast, and a master who adjusts a score after the game ends
   * — PRD 2 §13's whole post-game correction flow — **should** be told it landed. So the two audiences
   * disagree about this notice on purpose, and the disagreement lives on the surface that has the rule.
   *
   * **The stage is the test rather than the status**, and it is the better one rather than the
   * convenient one. `WAITING_FOR_PLAYERS` is not only `SETUP` — a `LIVE` game with no round open shows
   * it too — but in both cases the room is looking at a join screen, where a `+5` announces a change to
   * a game nobody has watched yet. The question worth asking is *"is the room looking at something a
   * score announcement makes sense against?"*, and the stage is what answers it. `FINISHED` covers
   * abandoned as well, which §14 says gets no announcement of anything.
   */
  if (stage === 'WAITING_FOR_PLAYERS' || stage === 'FINISHED') return null

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
