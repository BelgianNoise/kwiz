import { openStream } from '@/lib/server/sse'

/**
 * `GET /api/live/:gameId/play` — one team's stream (protocol §2.1).
 *
 * Needs `X-Kwiz-Device` to know **which team's** view to build. That is identity, not authorisation
 * (PRD 1 §4): the token grants nothing that being on the network does not already give, and an
 * unknown one is answered with 401 so the client clears its storage and rejoins (§3.1).
 */
export const dynamic = 'force-dynamic'

export function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  return params.then(({ gameId }) => openStream(request, gameId, 'PLAYER'))
}
