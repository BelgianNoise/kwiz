import { defineRouting } from 'next-intl/routing'

/**
 * PRD 1 §9.4 — locale resolution, in order:
 *
 *   1. the explicit `[locale]` route segment (a shared or bookmarked link wins)
 *   2. the persisted preference cookie from an earlier visit on this device
 *   3. `en` — always (D17)
 *
 * **`localeDetection: false` is D17, not a default we forgot to change.** next-intl would
 * otherwise negotiate `Accept-Language`, which makes the same projected QR code render
 * differently on different phones and leaves a master demoing the join flow unable to tell
 * what a guest will see. A fixed, boring default is the right trade for the surface a
 * stranger meets first. The cookie stays on: it records an explicit choice rather than
 * guessing from a header.
 *
 * Locale scope is **per device, not per game** — a table of Dutch speakers switching their
 * phones must not touch the projected screen or the master's laptop.
 */
export const routing = defineRouting({
  locales: ['en', 'nl'],
  defaultLocale: 'en',
  localePrefix: 'always',
  localeDetection: false,
})

export type Locale = (typeof routing.locales)[number]
