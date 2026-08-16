import { openStream } from '@/lib/server/sse'

/**
 * `GET /api/live/:gameId/play` — one team's stream (protocol §2.1).
 *
 * Needs `?device=<deviceToken>` to know **which team's** view to build. That is identity, not
 * authorisation (PRD 1 §4): the token grants nothing that being on the network does not already give,
 * and an unknown one is answered with 401 so the client clears its storage and rejoins (§3.1).
 *
 * **In the URL rather than a header because `EventSource` cannot set headers** — see §2.1, which spells
 * out why that is acceptable for this token and would not be for a credential. Every POST still uses
 * `X-Kwiz-Device`.
 */
export const dynamic = 'force-dynamic'

export function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  return params.then(({ gameId }) => openStream(request, gameId, 'PLAYER'))
}
