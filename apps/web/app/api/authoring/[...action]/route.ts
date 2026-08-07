import { fail } from '@kwiz/domain'

import { runAuthoring } from '@/lib/server/authoring'
import { actionResponse, readJsonBody, UNPARSEABLE } from '@/lib/server/http'
import { getRuntime, isDatabaseUsable } from '@/lib/server/runtime'

/**
 * `POST /api/authoring/*` — every mutation PRD 2's editors make.
 *
 * One catch-all over one table, for the same reason the play half has one (PRD 1 §6.9): the
 * catalogue stays greppable, and a route added without a schema is visible in the table rather than
 * hiding in a directory of near-identical files.
 */
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string[] }> },
): Promise<Response> {
  const server = await getRuntime()
  if (!isDatabaseUsable(server)) {
    return actionResponse(
      fail('DATABASE_MIGRATION_REQUIRED', 'the database has pending migrations'),
    )
  }

  const { action } = await params
  const body = await readJsonBody(request)
  if (body === UNPARSEABLE) {
    return actionResponse(fail('VALIDATION_ERROR', 'the request body is not JSON'))
  }

  return actionResponse(
    runAuthoring({ runtime: server, segments: action, body, now: new Date() }),
  )
}
