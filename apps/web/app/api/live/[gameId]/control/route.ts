import { openStream } from '@/lib/server/sse'

/**
 * `GET /api/live/:gameId/control` — master control's stream (protocol §2.1).
 *
 * This is the audience that may see everything: `masterNotes`, `isCorrect`, unmarked keyword text,
 * every team's answer. It is a different **route** from the other two precisely so that the filter
 * doing the permitting is selected by the URL and nothing else.
 */
export const dynamic = 'force-dynamic'

export function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  return params.then(({ gameId }) => openStream(request, gameId, 'MASTER_CONTROL'))
}
