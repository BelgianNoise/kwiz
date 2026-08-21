import type { Browser, BrowserContext, Page } from '@playwright/test'

/**
 * CLAUDE.md §7's four surfaces, four type scales — reproduced here as the four viewport presets
 * a spec actually needs. Every "device" in these scenarios is its own `BrowserContext`, never a
 * shared one: the player surface keys its device token by `localStorage` (PRD 5 §2.3), and two
 * player tabs in *one* context would share that storage and stop being two devices at all.
 */

/** The master's own machine — PRD 3's control desk, and PRD 2's authoring/config surfaces. */
export async function openControl(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  return { context, page }
}

/** The projector — PRD 4, 3–10 m away, so the one surface a test can plausibly check at scale. */
export async function openScreen(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await context.newPage()
  return { context, page }
}

/**
 * A phone in the hand — PRD 5, 0.3 m, one team's shared device. `isMobile`/`hasTouch` matter
 * here specifically because the buzzer and answer surfaces are tap targets, not because the
 * suite needs to *look* like a phone.
 */
export async function openPlayer(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  return { context, page }
}

/** A second phone on the *same* team (D45's shared drafts, D43's finality) — its own context. */
export const openSecondPlayer = openPlayer
