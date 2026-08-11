import { findGame } from '@kwiz/db'
import { notFound } from 'next/navigation'

import { MainScreen } from '@/components/screen/main-screen'
import { getRuntime } from '@/lib/server/runtime'

/**
 * PRD 4 — the projected screen, at `/screen/:gameId`. Audience `MAIN_SCREEN` (protocol §5.2).
 *
 * A thin server component for the same reason PRD 3's page is: everything this surface renders arrives
 * on the SSE stream as a `MainScreenView`, so server-rendering any of it would produce a second,
 * immediately-stale source for the same facts. Not even the quiz name is passed down — unlike control,
 * this screen shows it to a *room* (§4), so it belongs on the pushed view where a rename reaches the
 * projector without a reload.
 *
 * D21 — the `gameId` is in the route. Nothing here resolves a game implicitly.
 */
export const dynamic = 'force-dynamic'

export default async function ScreenPage({
  params,
}: {
  params: Promise<{ gameId: string }>
}) {
  const runtime = await getRuntime()
  const { gameId } = await params

  /*
   * A mistyped id is a missing page. Letting the stream 404 instead would put §14's neutral `kwiz`
   * mark in front of the room forever — correct behaviour for a *deleted* game, and the wrong answer
   * for a master who is still setting up and needs to know the URL is wrong.
   */
  if (!findGame(runtime.database, gameId)) notFound()

  return <MainScreen gameId={gameId} />
}
