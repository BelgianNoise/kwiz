import { openStream } from '@/lib/server/sse'

/**
 * `GET /api/live/:gameId/screen` — the projected screen's stream (protocol §2.1).
 *
 * A separate route per audience, not an `?audience=` parameter: the payload filter is chosen by the
 * route, so the wrong one cannot be reached by editing a URL. No identity — per PRD 1 §4 anyone
 * reachable on the network can open this, and the room's screen has nothing to prove.
 */
export const dynamic = 'force-dynamic'

export function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  return params.then(({ gameId }) => openStream(request, gameId, 'MAIN_SCREEN'))
}
