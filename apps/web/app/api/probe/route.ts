import { ok } from '@kwiz/domain'

import { actionResponse } from '@/lib/server/http'
import { latestProbe } from '@/lib/server/probe'

/**
 * `GET /api/probe?address=…` — has a phone reached this machine on that address yet? (PRD 2 §4)
 *
 * **Polled, not streamed**, which is not a violation of D2: that decision is about pushing *game
 * state*, and this is a thirty-second one-off during setup where a phone has not necessarily arrived
 * yet. Opening an SSE stream to deliver at most one boolean would be more machinery for less.
 */
export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  const address = new URL(request.url).searchParams.get('address') ?? ''
  const hit = latestProbe(address, Date.now())

  return actionResponse(
    ok({
      reached: hit !== undefined,
      // Shown so a master can tell their own phone from a laptop that happened to load the page.
      userAgent: hit?.userAgent ?? null,
    }),
  )
}
