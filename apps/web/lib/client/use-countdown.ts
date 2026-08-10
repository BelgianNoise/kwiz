'use client'

import { useEffect, useState } from 'react'

/**
 * **The client is what ticks. The server never does** (D52).
 *
 * Every clock in this product — a question timer, a break, a finale bank — is pushed as an
 * *absolute instant* plus, where relevant, the seconds standing at the start of the turn. Nothing
 * sends a tick event, and a restart mid-turn therefore recovers every clock exactly, because there
 * was never any state in the ticking to lose.
 *
 * That also means these hooks read the **local** clock. On the control surface that is the same
 * machine the server runs on, so there is no skew at all; on a phone or a projector a badly-set
 * clock shows a wrong countdown and nothing else — no game fact depends on it (D8: the deadline is
 * advisory, and only the master locking a question stops submissions).
 */

/** Ticks four times a second: fast enough that a whole-second display never looks stuck. */
const TICK_MS = 250

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [active])

  return now
}

/** Seconds left until an absolute instant, floored at zero. `null` in, `null` out — no clock. */
export function useCountdown(until: number | null): number | null {
  const now = useNow(until !== null)
  if (until === null) return null
  return Math.max(0, (until - now) / 1000)
}

/** Seconds since an absolute instant. Zero while nothing is running. */
export function useElapsed(since: number | null): number {
  const now = useNow(since !== null)
  if (since === null) return 0
  return Math.max(0, (now - since) / 1000)
}
