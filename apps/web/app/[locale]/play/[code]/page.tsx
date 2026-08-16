import { findEndedGameByCode, findJoinableGameByCode } from '@kwiz/db'
import { toGameReview } from '@kwiz/domain'

import { FinalStandings } from '@/components/player/final-standings'
import { NoSuchGame } from '@/components/player/no-such-game'
import { TeamPicker } from '@/components/player/team-picker'
import { getRuntime } from '@/lib/server/runtime'

/**
 * PRD 5 §2 — where a scanned QR and a typed code both land.
 *
 * The **only** page on this surface rendered from the server, and only because it has to be: a phone
 * arriving here has a code and nothing else, so the team list cannot come from a stream it is not yet
 * entitled to open. Everything after the tap is pushed (§3).
 *
 * D21 — resolved by code rather than implicitly. `findJoinableGameByCode` normalises first
 * (conventions §2), so `kw-lz oa` finds `KW1Z0A`, and it is restricted to joinable games so a code
 * recycled from a finished one lands on the live game.
 */
export const dynamic = 'force-dynamic'

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const runtime = await getRuntime()
  const { code } = await params

  const game = findJoinableGameByCode(runtime.database, code)

  if (!game) {
    /*
     * §15 O3 — **the morning-after bookmark.** A finished game's code stops resolving (data model
     * §6.1), and until slice 8 that was indistinguishable from a wrong one. It is not: someone
     * reopening last night's link wants the standings, and *"no quiz with that code"* is both untrue
     * and useless to them.
     *
     * Checked **after** the joinable lookup, never merged into it, so a code recycled onto tonight's
     * game still resolves to tonight's game while it is live.
     */
    const ended = findEndedGameByCode(runtime.database, code)
    const finished = ended?.status === 'FINISHED' ? runtime.registry.get(ended.id) : null

    if (ended && finished) {
      const review = toGameReview(finished, Date.now())
      return (
        <FinalStandings
          quizName={review.quizName}
          standings={[...review.teams]
            .sort((a, b) => a.rank - b.rank || a.position - b.position)
            .map((team) => ({
              teamId: team.id,
              name: team.name,
              colour: team.colour,
              rank: team.rank,
              score: team.score,
            }))}
        />
      )
    }

    /*
     * **Not a 404**, for an unknown code or an abandoned game alike. A wrong code is the single most
     * likely thing to go wrong on this surface — someone squinting at a projector across a dark room
     * — and Next's error page would tell a pub guest nothing they can act on. §2.1's whole
     * normalisation exists to make this rare; when it happens anyway, the answer is "check the code"
     * and a way back. An abandoned game gets the same plain sentence rather than a podium (O3).
     */
    return <NoSuchGame code={code} />
  }

  /*
   * Teams come from the live projection rather than a query, so the picker and the game agree about
   * who exists — including a team the master added thirty seconds ago (PRD 2 §11.2).
   */
  const state = runtime.registry.get(game.id)
  const devices = [...(state?.devices.values() ?? [])]

  const teams = [...(state?.teams.values() ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((team) => ({
      id: team.id,
      name: team.name,
      colour: team.colour,
      // D20 — a full team is **shown with its reason**, never hidden. Hiding it makes a player think
      // they scanned the wrong code; showing it tells them to sit elsewhere or ask the master.
      devices: devices.filter((teamId) => teamId === team.id).length,
    }))

  return (
    <TeamPicker
      code={game.code}
      gameId={game.id}
      quizName={game.quizName}
      teams={teams}
      maxDevices={runtime.config.KWIZ_MAX_DEVICES_PER_TEAM}
    />
  )
}
