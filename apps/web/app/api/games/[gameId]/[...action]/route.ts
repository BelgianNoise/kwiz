import { fail } from '@kwiz/domain'

import { runAction } from '@/lib/server/actions'
import { actionResponse, readJsonBody, UNPARSEABLE } from '@/lib/server/http'
import { getRuntime, isDatabaseUsable } from '@/lib/server/runtime'

/**
 * Every action in protocol §7.2 and the four player ones in §7.1, dispatched by
 * `lib/server/actions.ts`.
 *
 * **One catch-all rather than 38 route files.** PRD 1 §6.9 constraint 2 names the *action-dispatch
 * module* as one of three files a transport change would touch, which only holds if there is one. It
 * also keeps this layer honest about what it does: read the body, hand over the path, answer with
 * the result. Nothing about the game is decided here.
 *
 * The SSE routes are deliberately **not** like this: there the audience — and so the payload filter —
 * is chosen by the route, and that must not be reachable through a URL segment (protocol §2.1).
 */
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string; action: string[] }> },
): Promise<Response> {
  const server = await getRuntime()
  // D14: the master declined the migrations, so the schema and the code disagree. Refusing with a
  // code is the only honest answer — a half-working action against the wrong schema is not.
  if (!isDatabaseUsable(server)) {
    return actionResponse(
      fail('DATABASE_MIGRATION_REQUIRED', 'the database has pending migrations'),
    )
  }

  const { gameId, action } = await params
  const body = await readJsonBody(request)
  if (body === UNPARSEABLE) {
    return actionResponse(fail('VALIDATION_ERROR', 'the request body is not JSON'))
  }

  return actionResponse(
    runAction({
      runtime: server,
      gameId,
      segments: action,
      body,
      deviceToken: request.headers.get('x-kwiz-device'),
      // One instant for the whole request, passed inward. Nothing below this line reads a clock —
      // which is what makes every decision reproducible from the log (D4).
      now: Date.now(),
    }),
  )
}
