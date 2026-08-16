'use client'

import type { PlayerView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { DeviceMenu } from '@/components/player/device-menu'
import { PlayerStage } from '@/components/player/player-stage'
import { useRouter } from '@/i18n/navigation'
import { readDeviceToken } from '@/lib/client/device'
import { useLiveView } from '@/lib/client/use-live-view'
import { useWakeLock } from '@/lib/client/use-wake-lock'

/**
 * PRD 5 — the phone's shell.
 *
 * Three things hold for this whole surface (§1.1):
 *
 * - **Nothing is ever lost.** A phone that sleeps, drops wifi or gets locked mid-question must not
 *   cost the team the question. The reconnect below, `useWakeLock`, and the answer components' retry
 *   all exist for that one sentence.
 * - **One thing to do, large.** Whoever is holding the phone sees a single obvious action without
 *   reading, which is why the stages are so plain and the buzzer is nearly the whole screen.
 * - **No per-person state.** There is no "your turn" and no identity — the device is the *team*.
 */
export function PlayerGame({ gameId, code }: { gameId: string; code: string }) {
  const t = useTranslations('player.game')
  const router = useRouter()

  /*
   * Read once, into state: a `localStorage` read on every render would be a synchronous disk-backed
   * call inside a component that re-renders on every pushed view. `undefined` is "not looked yet",
   * `null` is "looked, and there is nothing" — which sends the device back to the picker.
   */
  const [token, setToken] = useState<string | null | undefined>(undefined)
  useEffect(() => setToken(readDeviceToken(gameId)), [gameId])

  useEffect(() => {
    if (token === null) router.replace(`/play/${code}`)
  }, [token, code, router])

  /*
   * protocol §2.1 — the token rides in the query string, because `EventSource` cannot set a header.
   * `''` while the token is still being read keeps the hook's `path` stable rather than opening a
   * stream that is guaranteed to 401.
   */
  const { view, status, error } = useLiveView<PlayerView>(
    token ? `/api/live/${gameId}/play?device=${encodeURIComponent(token)}` : '',
  )

  /*
   * §2.3 — *"if the token is unknown (game deleted, database reset, token cleared), the device is
   * returned to the team picker with a plain explanation rather than an error."*
   */
  useEffect(() => {
    if (error === 'UNKNOWN_DEVICE') router.replace(`/play/${code}?rejoin=1`)
  }, [error, code, router])

  useWakeLock(view?.stage.kind)

  if (!view) {
    /*
     * §4's rule, applied a step earlier: **no spinner.** A spinner says something is loading and
     * invites a reload — the one thing that could actually go wrong here. The team name is what a
     * player checks, and it arrives with the first frame.
     */
    return <main className="min-h-dvh p-6 text-lg">{t('connecting')}</main>
  }

  return (
    <main className="min-h-dvh">
      <PlayerStage view={view} gameId={gameId} token={token ?? ''} />

      {/*
        §14 — one small control, top corner, **as far from the buzzer as the layout allows**. This
        surface's primary control is a near-fullscreen button being stabbed at by whoever reacts
        first, and a destructive action anywhere near it will be hit by accident.
      */}
      <DeviceMenu view={view} gameId={gameId} code={code} token={token ?? ''} />

      {/*
        Silent once the quiz is over. Ending a game closes every stream (protocol §3.4), so an
        abandoned or finished game leaves `EventSource` retrying against nothing and every phone in
        the room wearing a permanent *reconnecting* band under a screen that is already correct and
        final. §12's indicator exists for a live game, where a drop could be mistaken for a scoring
        problem; there is nothing left to lose here.
      */}
      <Connection
        status={status}
        over={view.abandoned || view.stage.kind === 'FINISHED'}
      />
    </main>
  )
}

/**
 * §12 — *"a connection problem must never look like a scoring problem."*
 *
 * The indicator says *reconnecting*, never *your answer wasn't saved*: a team that believes it lost
 * points will interrupt the quiz to argue about it, and the belief is almost always wrong — the
 * answer is in a draft or a retry queue either way.
 *
 * Deliberately not over the input (§12's table), and deliberately calm.
 */
function Connection({ status, over }: { status: string; over: boolean }) {
  const t = useTranslations('player.game')
  if (over || status === 'LIVE' || status === 'CONNECTING') return null

  return (
    <output className="bg-muted text-muted-foreground fixed inset-x-0 bottom-0 block p-2 text-center text-base">
      {t('reconnecting')}
    </output>
  )
}
