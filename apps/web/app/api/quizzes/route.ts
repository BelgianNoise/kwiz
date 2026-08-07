import { listQuizzes } from '@kwiz/db'
import { ok } from '@kwiz/domain'

import { actionResponse } from '@/lib/server/http'
import { getRuntime } from '@/lib/server/runtime'

/**
 * `GET /api/quizzes` (protocol §7.4) — the dashboard's quiz list.
 *
 * A read, not a pushed view: the config surface is request/response and has no live requirement, so
 * it is deliberately **not** an SSE audience (protocol §2.1). Giving it a stream would mean a fourth
 * payload filter to keep correct for no benefit.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const runtime = await getRuntime()
  return actionResponse(ok(listQuizzes(runtime.database)))
}
