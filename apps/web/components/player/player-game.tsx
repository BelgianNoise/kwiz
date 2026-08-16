'use client'

import type { PlayerView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { DeviceMenu } from '@/components/player/device-menu'
import { PlayerStage } from '@/components/player/player-stage'
import { useRouter } from '@/i18n/navigation'
import { clearDeviceToken, readDeviceToken } from '@/lib/client/device'
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
   * §12's battery row — *"no looping animations, no polling, no video. One SSE connection is
   * cheap."*
   *
   * Ending a game closes every stream (protocol §3.4), so without this latch a phone left on the
   * table after the quiz reopened a connection every few seconds, forever, against a game that was
   * over. Latched rather than derived inline so it can only ever go one way: a finished game does not
   * become unfinished, and the last view stays on screen because nothing tears it down.
   */
  const [over, setOver] = useState(false)

  /*
   * protocol §2.1 — the token rides in the query string, because `EventSource` cannot set a header.
   * `''` means *do not stream*: while the token is still being read, and once the quiz is over.
   */
  const { view, status, error } = useLiveView<PlayerView>(
    token && !over ? `/api/live/${gameId}/play?device=${encodeURIComponent(token)}` : '',
  )

  useEffect(() => {
    if (view?.abandoned || view?.stage.kind === 'FINISHED') setOver(true)
  }, [view])

  /*
   * §2.3 — *"if the token is unknown (game deleted, database reset, token cleared), the device is
   * returned to the team picker with a plain explanation rather than an error."*
   *
   * **The token is cleared here, in the same call as the redirect.** It used to redirect to
   * `/play/:code?rejoin=1` and leave the token in place — and the picker's §2.3 resume check sends
   * any device holding a token straight back here, so the two rules closed on each other: game page →
   * 401 → picker → resume → game page → 401, forever, with no picker ever drawn and nothing ever
   * explained. The `?rejoin=1` that was meant to break it was read by nothing.
   *
   * A stale token is not a fact worth carrying: the server has just said it does not know this
   * device, so the only honest local state is *not joined*.
   */
  useEffect(() => {
    if (error !== 'UNKNOWN_DEVICE') return
    clearDeviceToken(gameId)
    router.replace(`/play/${code}`)
  }, [error, gameId, code, router])

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
        Silent once the quiz is over — the same latch that stops the stream, so the band and the
        connection can never disagree. §12's indicator exists for a live game, where a drop could be
        mistaken for a scoring problem; under a screen that is already final there is nothing left to
        lose and nothing to reconnect to.
      */}
      <Connection status={status} over={over} />
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
