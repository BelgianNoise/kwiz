import { fail } from '@kwiz/domain'
import { z } from 'zod'

import { actionResponse, parseBody, readJsonBody, UNPARSEABLE } from '@/lib/server/http'
import { runJoin } from '@/lib/server/join'
import { getRuntime, isDatabaseUsable } from '@/lib/server/runtime'

/**
 * `POST /api/games/join` (protocol §7.1) — the only action with no `gameId` in its path, because a
 * phone that has just scanned a QR code knows a **code** and nothing else.
 */
const bodySchema = z.object({
  code: z.string().min(1),
  teamId: z.string().min(1),
})

export async function POST(request: Request): Promise<Response> {
  const server = await getRuntime()
  if (!isDatabaseUsable(server)) {
    return actionResponse(
      fail('DATABASE_MIGRATION_REQUIRED', 'the database has pending migrations'),
    )
  }

  const body = await readJsonBody(request)
  if (body === UNPARSEABLE) {
    return actionResponse(fail('VALIDATION_ERROR', 'the request body is not JSON'))
  }

  const parsed = parseBody(bodySchema, body)
  if (!parsed.ok) return actionResponse(parsed)

  return actionResponse(runJoin(server, { ...parsed.data, now: Date.now() }))
}
