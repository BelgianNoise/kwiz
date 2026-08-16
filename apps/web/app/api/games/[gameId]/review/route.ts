import { fail, ok, toGameReview } from '@kwiz/domain'

import { actionResponse } from '@/lib/server/http'
import { getRuntime } from '@/lib/server/runtime'

/**
 * `GET /api/games/:gameId/review` (protocol §7.4) — PRD 2 §13's grid, finale record and adjustment
 * audit, for a game that is finished or still running.
 *
 * **Fetched, never pushed** (D39). It is O(questions × teams), which is exactly the shape §1.1 keeps
 * off the stream — a pushed view has to stay small enough to send on every change, and this one
 * would grow with the quiz.
 *
 * The registry loads any game by replaying its log, finished ones included (PRD 1 §6.4), so there is
 * no projection query here and no second source of truth for a verdict: the same fold that drives
 * the live surfaces produces the review. A finished game costs one replay and is evicted again.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const runtime = await getRuntime()
  const { gameId } = await params

  // D21 — resolved by the id in the route, never "the current game". `catchUp` rather than `get` so
  // a correction made on the control desk a moment ago is already folded in.
  const state = runtime.registry.catchUp(gameId) ?? runtime.registry.get(gameId)
  if (!state) return actionResponse(fail('GAME_NOT_FOUND', `no game ${gameId}`))

  return actionResponse(ok(toGameReview(state, Date.now())))
}
