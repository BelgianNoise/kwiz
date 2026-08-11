'use client'

import type { MainScreenView, Notice } from '@kwiz/domain'
import { DISCONNECT_GRACE_MS } from '@kwiz/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { AdjustmentBanner } from '@/components/screen/adjustment-banner'
import { Arming, DisconnectedPulse, KwizMark } from '@/components/screen/arming'
import { Stage } from '@/components/screen/stage'
import { StageFrame } from '@/components/screen/stage-frame'
import { setSoundMuted } from '@/lib/client/screen-sound'
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
    const reArm = (): void => void requestFullscreen()
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
        {view ? <Stage view={view} teams={teams} sound={sound} /> : <KwizMark />}

        {/* §10.1 — below whatever the stage is showing, never over it, and the same band on all eight. */}
        {view ? (
          <AdjustmentBanner notice={notice} teams={teams} stage={view.stage.kind} />
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
