import { findJoinableGameByCode } from '@kwiz/db'

import { NoSuchGame } from '@/components/player/no-such-game'
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
 * bookmark the morning after should reach a plain explanation rather than a stream that 401s. §15 O3
 * wants standings for that visitor, and slice 8's review screens are where they live — until then the
 * honest answer is "this code will not get you into a game".
 *
 * **The same explanation as the join page, not a 404.** This route calling `notFound()` was the one
 * place on the surface a pub guest could reach Next's black-and-white error page — reachable by
 * reloading after the master ended the game, and by the morning-after bookmark O3 is about. §2.1's
 * *"a wrong code is the single most likely thing to go wrong here"* applies to both halves of the
 * route or to neither.
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
  if (!game) return <NoSuchGame code={code} />

  return <PlayerGame gameId={game.id} code={game.code} />
}
