'use client'

import type { MainScreenView, Notice } from '@kwiz/domain'
import { DISCONNECT_GRACE_MS } from '@kwiz/domain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { AdjustmentBanner } from '@/components/screen/adjustment-banner'
import { Arming, DisconnectedPulse, KwizMark } from '@/components/screen/arming'
import { Stage } from '@/components/screen/stage'
import { StageFrame } from '@/components/screen/stage-frame'
import { armSound, setSoundMuted } from '@/lib/client/screen-sound'
import { useLiveView } from '@/lib/client/use-live-view'
import { usePointerActive } from '@/lib/client/use-screen-chrome'
import { requestFullscreen } from '@/lib/client/use-screen-chrome'

/**
 * PRD 4 — the projected screen, at `/screen/:gameId`. Read-only, no controls, no chrome.
 *
 * Three things are true of this whole file and nothing else in the app:
 *
 * - **Everything is inside one 1920×1080 `StageFrame`**, letterboxed rather than reflowed (§2.2). So
 *   every size below is `cqh` — 1% of the stage — and transcribes §2.1's table directly. `vh` would
 *   be wrong inside a scaled frame, and wrong in a way that only shows up on a projector.
 * - **The room must never see a technical failure** (§14). There is no error state on this surface,
 *   only calmer and calmer versions of "nothing is happening yet".
 * - **The client renders the stage the server chose** and derives nothing. Stages are mutually
 *   exclusive and there is no shared frame between them (§3): a persistent header would cost 10–15%
 *   of the vertical budget on every stage, permanently, to show the room something it does not need.
 */
export function MainScreen({ gameId }: { gameId: string }) {
  /** `null` until §4.1's click; then whether the room will actually hear anything. */
  const [sound, setSound] = useState<boolean | null>(null)
  // §10.1's banner is a *moment*, so it arrives as a notice rather than on the view (protocol §2.3).
  const [notice, setNotice] = useState<Notice | null>(null)
  const onNotice = useCallback((next: Notice) => setNotice(next), [])

  const { view, status } = useLiveView<MainScreenView>(
    `/api/live/${gameId}/screen`,
    onNotice,
  )

  const pointerActive = usePointerActive()

  /*
   * §14 — *"game abandoned: whatever was showing, held. No announcement — the master handles the
   * room."*
   *
   * `stageKind` folds `ABANDONED` into `FINISHED`, which is right for control (its header says so)
   * and wrong here: the server publishes that view **before** closing the streams, so the room got a
   * full winner-at-hero-scale announcement for a game the master had just abandoned, and then the
   * frozen remains of it. Holding the last real view is both what §14 asks for and the calmer thing.
   */
  const held = useRef<MainScreenView | null>(null)
  if (view && !view.abandoned) held.current = view
  const shown = view?.abandoned ? held.current : view

  /*
   * PRD 2 §16's mute, mirrored on every view so toggling it in settings silences the projector without
   * anyone reloading it — which is the difference between the setting working and merely existing.
   */
  useEffect(() => {
    if (view) setSoundMuted(view.soundMuted)
  }, [view])

  // Built here rather than per stage: the banner needs it too, and it must be the same map.
  const teams = useMemo(
    () => new Map((view?.teams ?? []).map((team) => [team.id, team])),
    [view?.teams],
  )

  /*
   * O4 — *"if fullscreen is exited mid-game, re-arm silently on the next click, never show the room a
   * prompt."* Bound once armed, and deliberately not a visible affordance.
   */
  useEffect(() => {
    if (sound === null) return undefined
    const reArm = (): void => {
      void requestFullscreen()
      /*
       * §4.1's failure copy tells the master to *"click the screen once more"*, and until the slice-6
       * review that instruction did nothing: this listener only re-requested fullscreen, `armSound`
       * ran exactly once from `Arming`'s own handler, and the only real fix was reloading the route.
       * A recovery instruction that does not recover is worse than none — §4.1's whole point is that
       * a muted projector gets found while the room is still filling.
       */
      if (!sound) void armSound().then(setSound)
    }
    window.addEventListener('click', reArm)
    return () => window.removeEventListener('click', reArm)
  }, [sound])

  if (sound === null) return <Arming onArmed={setSound} />

  return (
    <div className={pointerActive ? '' : 'cursor-none'}>
      <StageFrame>
        {/*
          §14 — the last good view **stays on screen** while the stream is down: it is still true, and
          blanking a projector mid-question is the one thing worse than a stale standing. Only the
          very first connect has nothing to show.
        */}
        {shown && status !== 'FAILED' ? (
          <Stage view={shown} teams={teams} sound={sound} />
        ) : (
          /*
           * §14 — *"game not found / deleted: a neutral full-screen `kwiz` mark. No error text."*
           *
           * `FAILED` is a **refusal**, not a blip: the stream will not come back, so unlike
           * `RECONNECTING` there is nothing for a held view to still be true about. Deleting a game is
           * legal at every status including `LIVE` (PRD 2 §12.1), so this is reachable while the room
           * is watching — and until the slice-6 review the projector simply froze on the last frame
           * forever, with no mark and not even the pulse, which only renders while reconnecting.
           */
          <KwizMark />
        )}

        {/* §10.1 — below whatever the stage is showing, never over it, and the same band on all eight. */}
        {shown ? (
          <AdjustmentBanner notice={notice} teams={teams} stage={shown.stage.kind} />
        ) : null}

        {status === 'RECONNECTING' ? <GracedPulse /> : null}
      </StageFrame>

      {/*
        PRD 1 §9.4 / §2.3 — the switcher exists but is not chrome: it appears on mouse movement and
        fades with the cursor. Outside the `StageFrame` because it is not part of the stage; it is the
        master reaching past it.
      */}
      <LanguageSwitcher
        className={`absolute top-4 right-4 transition-opacity duration-300 ${
          pointerActive ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
    </div>
  )
}

/**
 * §14's three-second grace, as a component so the timer unmounts with it.
 *
 * *"Nothing, for the first 3 s — reconnection is usually faster than that."* Held here rather than in
 * `useLiveView` because it is a presentation rule of this surface: master control shows
 * `Reconnecting…` immediately, and should.
 */
function GracedPulse() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), DISCONNECT_GRACE_MS)
    return () => clearTimeout(timer)
  }, [])

  return visible ? <DisconnectedPulse /> : null
}
