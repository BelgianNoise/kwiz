import { findJoinableGameByCode } from '@kwiz/db'
import { notFound } from 'next/navigation'

import { PlayerGame } from '@/components/player/player-game'
import { getRuntime } from '@/lib/server/runtime'

/**
 * PRD 5 §3 — the phone, once a team has been picked.
 *
 * Thin, like the other two live surfaces: everything rendered here arrives on the stream as a
 * `PlayerView` (protocol §5.3). The one thing resolved server-side is the code, because the device
 * token lives in `localStorage` and the `gameId` it is keyed by has to come from somewhere.
 *
 * **Joinable only.** A finished game's code stops resolving (data model §6.1), and a phone opening a
 * bookmark the morning after should reach the join page's plain explanation rather than a stream that
 * 401s. §15 O3 wants standings for that visitor, and slice 8's review screens are where they live —
 * until then the honest answer is "this code will not get you into a game".
 */
export const dynamic = 'force-dynamic'

export default async function PlayerGamePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const runtime = await getRuntime()
  const { code } = await params

  const game = findJoinableGameByCode(runtime.database, code)
  if (!game) notFound()

  return <PlayerGame gameId={game.id} code={game.code} />
}
