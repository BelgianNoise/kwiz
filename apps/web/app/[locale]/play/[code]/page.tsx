import { findEndedGameByCode, findJoinableGameByCode } from '@kwiz/db'
import { standings } from '@kwiz/domain'

import { FinalStandings } from '@/components/player/final-standings'
import { GameAbandoned } from '@/components/player/game-abandoned'
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
     * §15 O3 — **the morning-after bookmark, and its three distinct answers.** A finished game's
     * code stops resolving (data model §6.1), and until slice 8 all three collapsed into one.
     *
     * Checked **after** the joinable lookup, never merged into it, so a code recycled onto tonight's
     * game still resolves to tonight's game while it is live.
     */
    const ended = findEndedGameByCode(runtime.database, code)
    const state = ended ? runtime.registry.get(ended.id) : null

    if (ended && state) {
      /*
       * O3 gives `ABANDONED` *"a bare message"* — and it has to be a **different** message from the
       * unknown-code one below, not the same page reached by a different route. The code was right;
       * telling someone it *"may be slightly off"* sends them to re-read a projector that is no
       * longer showing anything. Announcing standings would be worse still: a winner nobody won,
       * which is the same thing the live surface refuses (PRD 4 §14).
       */
      if (ended.status === 'ABANDONED') return <GameAbandoned />

      /*
       * `standings()` rather than `toGameReview`: this route is **public and unauthenticated**, and
       * the review object is the `CONFIG` shape that deliberately carries every correct answer and
       * every team's answer. Nothing leaked — the fields were narrowed immediately — but the safety
       * of that rested on this call site's destructuring rather than on the shape it was handed,
       * which is exactly the filter-by-omission CLAUDE.md §2.3 rules out. A public route should be
       * given a public shape.
       */
      const ranked = standings(state)
      return (
        <FinalStandings
          quizName={state.content.quizName}
          standings={ranked.map((row) => {
            const team = state.teams.get(row.teamId)
            return {
              teamId: row.teamId,
              name: team?.name ?? '',
              colour: team?.colour ?? '#737373',
              rank: row.rank,
              score: row.score,
            }
          })}
        />
      )
    }

    /*
     * **Not a 404.** A wrong code is the single most likely thing to go wrong on this surface —
     * someone squinting at a projector across a dark room — and Next's error page would tell a pub
     * guest nothing they can act on. §2.1's whole normalisation exists to make this rare; when it
     * happens anyway, the answer is "check the code" and a way back.
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
