import { singleton } from './singleton'

/**
 * PRD 2 §4's `[Test with my phone]` — the one check that actually proves reachability.
 *
 * Everything else on the setup screen is inference: an address *looks* private, an adapter *looks*
 * real. A hit on this probe is proof, and it is the difference between a master hoping the QR code
 * works and knowing it does before a room is waiting.
 *
 * **Deliberately in memory and deliberately not an event.** It is not game data — it says nothing
 * about any game, survives no restart, and appending it to a log would put a device's IP in a table
 * that outlives every deployment for no benefit. A restart mid-test simply means testing again.
 */

export interface ProbeHit {
  at: number
  /** Free-text and untrusted — shown so a master can tell their phone from someone else's laptop. */
  userAgent: string
}

/**
 * Probes older than this are ignored, so a hit from an earlier attempt on a different address cannot
 * confirm the current one. Two minutes is long enough to find a phone and unlock it.
 */
const PROBE_TTL_MS = 120_000

/**
 * Shared across Next's two module layers: PRD 2 §4's probe is written by a **page** (the phone lands
 * on `/probe`) and read by a **route handler** (the setup screen polls `/api/probe`). With a plain
 * module-level Map those are two different Maps, and the test never confirms.
 */
const hits = (): Map<string, ProbeHit> =>
  singleton('probes', () => new Map<string, ProbeHit>())

/** Keyed by the address being tested, because a master re-picking must not inherit the last verdict. */
export function recordProbe(address: string, userAgent: string, now: number): void {
  hits().set(address, { at: now, userAgent })
}

export function latestProbe(address: string, now: number): ProbeHit | undefined {
  const hit = hits().get(address)
  if (!hit) return undefined
  if (now - hit.at > PROBE_TTL_MS) {
    hits().delete(address)
    return undefined
  }
  return hit
}

/** Exported for tests: module-level state otherwise leaks between cases. */
export function clearProbes(): void {
  hits().clear()
}
