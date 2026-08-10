import { findGame } from '@kwiz/db'
import { notFound } from 'next/navigation'

import { ControlDesk } from '@/components/control/control-desk'
import { getRuntime } from '@/lib/server/runtime'

/**
 * PRD 3 — the master's control desk, at `/control/:gameId`.
 *
 * **A thin server component on purpose.** Everything this surface renders arrives on the SSE stream
 * as a `MasterControlView` (protocol §5.4), so server-rendering any of it would produce a second,
 * immediately-stale source for the same facts. The two props below are the exceptions: both are
 * fixed for the life of a game, and neither is worth widening a pushed view for.
 *
 * D21 — the `gameId` is in the route. Nothing on this surface resolves a game implicitly.
 */
export const dynamic = 'force-dynamic'

export default async function ControlPage({
  params,
}: {
  params: Promise<{ gameId: string }>
}) {
  const runtime = await getRuntime()
  const { gameId } = await params

  // 404 here rather than letting the stream do it: a mistyped id should be a missing page, not a
  // desk that renders its frame and then reports it cannot connect.
  const game = findGame(runtime.database, gameId)
  if (!game) notFound()

  return <ControlDesk gameId={gameId} quizName={game.quizName} />
}
