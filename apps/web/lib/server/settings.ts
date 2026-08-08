import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

/**
 * PRD 2 §4 and §16's persisted choices — **a JSON file in the data directory, not a table.**
 *
 * The data model (spec §1) governs quiz and game data, and every one of its 24 tables is content a
 * master would expect to survive being copied to another laptop. The chosen network address is the
 * opposite: it is true of *this machine on this wifi* and meaningless anywhere else. Putting it in
 * `kwiz.db` would make a copied database confidently serve an address that never existed on the new
 * host — and would need a migration to add a table that holds two fields.
 *
 * Written with `writeFileSync` and read on demand rather than cached: it changes once a quiz-night
 * and is read on a handful of page renders, so a cache would only add a way to serve a stale value.
 *
 * `.catch()` on the whole object rather than `safeParse` at the call sites, because there is exactly
 * one sensible response to an unreadable settings file — behave as if nothing has been chosen yet,
 * which routes the master to §4's picker. That is also the first-run path, so it is well tested by
 * simply being the default.
 */
const settingsSchema = z.object({
  /** The address players use, chosen in §4. `null` until first run completes. */
  networkAddress: z.string().nullable().default(null),
  /** §16's `Mute all quiz sounds` — silences the main screen's audio (PRD 4 §13). */
  muteSounds: z.boolean().default(false),
})

export type KwizSettings = z.infer<typeof settingsSchema>

const DEFAULTS: KwizSettings = { networkAddress: null, muteSounds: false }

function settingsPath(dataDir: string): string {
  return join(dataDir, 'settings.json')
}

export function readSettings(dataDir: string): KwizSettings {
  let raw: unknown
  try {
    // Both the read and the parse are guarded. An absent file is the normal first-run state, and a
    // truncated one — a laptop that lost power mid-write — must land on the same path rather than
    // throwing out of the dashboard's render.
    raw = JSON.parse(readFileSync(settingsPath(dataDir), 'utf8'))
  } catch {
    return DEFAULTS
  }

  const parsed = settingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULTS
}

/** Read-modify-write, so a caller changing the mute flag cannot blank the network address. */
export function updateSettings(
  dataDir: string,
  patch: Partial<KwizSettings>,
): KwizSettings {
  const next = { ...readSettings(dataDir), ...patch }
  writeFileSync(settingsPath(dataDir), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/**
 * The join URL every QR code and every printed code resolves to.
 *
 * **Relative until an address is chosen.** A guessed origin is worse than no origin: a relative URL
 * still works for anyone already on the page, while `http://172.17.0.1:3000/play/ABC123` is a dead
 * QR code that looks authoritative (§4).
 */
export function joinUrl(settings: KwizSettings, port: number, code: string): string {
  const path = `/play/${code}`
  return settings.networkAddress
    ? `http://${settings.networkAddress}:${port}${path}`
    : path
}
