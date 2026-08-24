import { expect, type Page } from '@playwright/test'

import en from '../../apps/web/messages/en'

/**
 * The handful of journeys nearly every spec needs before it reaches the thing it is actually
 * about. They belong here rather than in each file for one reason: **when the join flow or the
 * control desk's opening move changes, 27 specs must not need editing.**
 *
 * Every label comes from `messages/en` rather than a string literal. CLAUDE.md §7's "no
 * hardcoded user-facing strings" is a rule about the app, but a suite that hardcodes them
 * anyway goes red on a copy change instead of on a behaviour change — and the copy is exactly
 * what a journey test should *not* be pinning.
 */
const t = en.player
const c = en.control

/** Replaces ICU placeholders by name, which is all these labels ever need. */
export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (out, [key, value]) => out.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

/**
 * PRD 2 §4 — **the first-run network picker.**
 *
 * A fresh data directory has no chosen address, so `/admin` opens on the picker rather than the
 * dashboard — every run of this suite is a fresh machine, so every run meets this screen once.
 * Idempotent by construction: whichever worker arrives first walks through it, everyone after
 * finds the dashboard already there. The choice itself does not matter to any scenario; the
 * default selection is what a master in a hurry would keep anyway.
 */
export async function pastFirstRun(page: Page): Promise<void> {
  const picker = page.getByRole('heading', { name: en.setup.heading })
  const dashboard = page.getByRole('button', { name: en.admin.dashboard.newQuiz })
  await expect(picker.or(dashboard).first()).toBeVisible({ timeout: 20_000 })

  if (await picker.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: en.setup.continue }).click()
    await expect(dashboard).toBeVisible({ timeout: 20_000 })
  }
}

/**
 * PRD 5 §2.2 — open the code's page and tap a team. The URL is the QR's own target, which is
 * why scenario 5 can compare this path against the typed-code path and expect one destination.
 */
export async function joinAs(page: Page, code: string, teamName: string): Promise<void> {
  await page.goto(`/en/play/${code}`)
  await expect(page.getByRole('heading', { name: t.join.whichTeam })).toBeVisible()
  await page.getByRole('button', { name: teamName }).click()
  // The device token lands in `localStorage` and the router replaces — waiting on the
  // destination rather than on a timeout is determinism rule 3.
  await expect(page).toHaveURL(new RegExp(`/play/${code}/game$`))
}

/** PRD 3 §4 — the master's opening move, once every team the spec cares about has a device. */
export async function startGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: c.setup.start, exact: true }).click()
}

/**
 * Start the game, open its first round, and open the first question — **three** taps, not one.
 *
 * Worth a helper precisely because it is three. `GAME_STARTED` lands the desk on the
 * leaderboard between rounds (PRD 3 §3.1), which is deliberate: the master starts the evening,
 * says something to the room, and *then* starts round one. A spec that assumed a question was
 * open after "Start the quiz" failed 45 seconds later looking for a button one screen away.
 */
export async function startFirstQuestion(page: Page): Promise<void> {
  await startGame(page)
  await advance(page, c.question.nextRound)
  await advance(page, c.question.openNext)
}

/**
 * The control desk's single forward action (PRD 3 §3.1 priority 7). Its *label* changes with
 * the suggestion — open, next, next round, end — so specs name the one they mean and this
 * fails loudly if the desk is offering something else.
 */
export async function advance(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click()
}

/** PRD 5 §5.1 — type an answer and submit it. Finality (D43) is the server's business. */
export async function answer(page: Page, text: string): Promise<void> {
  await page.getByLabel(t.game.yourAnswer).fill(text)
  await page.getByRole('button', { name: t.game.submit, exact: true }).click()
  await expect(page.getByText(t.game.lockedIn)).toBeVisible()
}

/**
 * Opens the projector and **gets past the arming click** (PRD 4 §4.1).
 *
 * That click is not incidental: browsers refuse `play()` and `requestFullscreen()` without a
 * user gesture, so the screen deliberately refuses to be a screen until it has one. Every spec
 * that looks at the projection has to make it, so it lives here rather than in nine files.
 */
export async function openScreenFor(page: Page, gameId: string): Promise<void> {
  await page.goto(`/en/screen/${gameId}`)
  await page.getByRole('button', { name: en.screen.arming.click }).click()
  await expect(page.getByRole('button', { name: en.screen.arming.click })).toBeHidden()
}

/**
 * A team's row **in the desk's main area** — the answer row, with its verdict and spotlight
 * controls (PRD 3 §5.2).
 *
 * Scoped to `main` for a reason worth stating: PRD 3 §11 keeps a permanent score rail
 * (`complementary`) that also carries one row per team, so a bare `getByRole('listitem')`
 * filtered by team name matches **two** elements and fails Playwright's strict mode. A fixed
 * layout with the same names in two places is the desk working as designed, not a smell — so
 * the suite names which of the two it means, every time.
 */
export function answerRow(page: Page, teamName: string) {
  return page.getByRole('main').getByRole('listitem').filter({ hasText: teamName })
}

/** The same team's row **in the right rail** — its running total (PRD 3 §11).
 *
 * Scoped further by the row's own `[Adjust]` button: the rail's *audit* section lists recent
 * adjustments with the team's name too, and strict mode is right to refuse a locator that cannot
 * tell "the team's score" from "an adjustment made to that team".
 */
export function railRow(page: Page, teamName: string) {
  return page
    .getByRole('complementary')
    .getByRole('listitem')
    .filter({ hasText: teamName })
    .filter({ has: page.getByRole('button', { name: c.scores.adjust }) })
}
/** PRD 3 §5.2 — the master's inline verdict on one team's answer, by team name. */
export async function judge(
  page: Page,
  teamName: string,
  verdict: 'accept' | 'deny',
): Promise<void> {
  await answerRow(page, teamName)
    .getByRole('button', {
      name: verdict === 'accept' ? c.question.accept : c.question.deny,
    })
    .click()
}

export { en }
