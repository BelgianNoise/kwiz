import { fail } from '@kwiz/domain'

import { actionResponse, readJsonBody, UNPARSEABLE } from '@/lib/server/http'
import { getRuntime, isDatabaseUsable } from '@/lib/server/runtime'
import { runSettings } from '@/lib/server/settings-actions'

/**
 * `POST /api/settings/*` — PRD 2 §4's address choice and §16's toggles.
 *
 * The migration guard is here for `storage/reclaim` specifically: reconciling files against rows in a
 * database whose schema has not been settled is how a pending migration turns into deleted media.
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

  return actionResponse(await runSettings({ runtime: server, segments: action, body }))
}
