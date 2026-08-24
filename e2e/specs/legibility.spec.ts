import { expect, test, type Page } from '@playwright/test'

import nl from '../../apps/web/messages/nl'
import { testDb } from '../support/db'
import { advance, en, joinAs, openScreenFor } from '../support/flows'
import { createGame } from '../support/game'
import {
  addFinaleRound,
  addFreeText,
  addJeopardyRound,
  addMultipleChoice,
  newQuestionSetRound,
  newQuiz,
} from '../support/quiz'
import { openControl, openPlayer, openScreen } from '../support/surfaces'

/**
 * Slice 10's automatable residue: the **§2.1 legibility floor** walked mechanically across
 * every projected stage in **both locales**, plus the horizontal/vertical overflow guard —
 * and the projector URL rules from slice 6's finding.
 *
 * PRD 4 §2.1: nothing below `4vh` (outside the frame) / `4cqh` (inside it) — the same 43.2px
 * at 1080p — *"nothing is exempt, including timings and captions."* Slice 6 wrote this as a
 * manual snippet and it caught three real violations (Jeopardy categories, the penalty label,
 * the arming screen itself). A check that runs only when someone remembers to run it is a
 * check that stops being run; it lives here now, on both locale baselines (PRD 1 §9.2: Dutch
 * is the layout baseline and runs 20–30% longer).
 *
 * What this deliberately cannot prove:
 * - **Transform-scaled text** — computed font-size hides CSS-transform shrinking. Nothing
 *   today scales that way; if one appears, extend this guard.
 * - **Contrast, overscan, washed-out projectors, 10 m sightlines** — hardware (agent-workflow
 *   §4.5). Those stay in `docs/field-rehearsal.md`.
 */

const TEAMS = ['Foxes', 'Whales', 'Iguanas']
const KEYWORDS = ['Thriller', 'Bad', 'Moonwalk', 'Neverland', 'Billie Jean']

/**
 * The §2.1 floor, evaluated inside the page. Direct text nodes only (containers inherit their
 * children's sizes), the language switcher exempt (chrome, not stage content — slice 6's note),
 * half a pixel of tolerance for subpixel rounding.
 */
function collectViolations(): string[] {
  const floor = window.innerHeight * 0.04
  const bad: string[] = []
  document.body.querySelectorAll('*').forEach((el) => {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META'].includes(el.tagName)) return
    // The language switcher is chrome for whoever operates the laptop, not stage content —
    // slice 6 ignored its two entries and this check keeps that exception. Matched structurally
    // (`nav`), because its accessible name is translated and would leak through on the nl page.
    if (el.closest('nav')) return
    const hasText = [...el.childNodes].some(
      (node) => node.nodeType === 3 && (node.textContent ?? '').trim(),
    )
    if (!hasText) return
    const px = parseFloat(getComputedStyle(el).fontSize)
    if (!Number.isFinite(px)) return
    if (px < floor - 0.5) {
      bad.push(`${Math.round(px * 10) / 10}px "${el.textContent.trim().slice(0, 40)}"`)
    }
  })
  return bad
}

/** No scrolling at any stage: the frame letterboxes, so page overflow means clipping. */
function collectOverflow(): string[] {
  const root = document.documentElement
  const issues: string[] = []
  if (root.scrollWidth > window.innerWidth + 1) {
    issues.push(`horizontal ${root.scrollWidth} > ${window.innerWidth}`)
  }
  if (root.scrollHeight > window.innerHeight + 1) {
    issues.push(`vertical ${root.scrollHeight} > ${window.innerHeight}`)
  }
  return issues
}

test('the projector stays above the legibility floor through every stage, in en and nl', async ({
  browser,
}) => {
  test.setTimeout(240_000)

  // ── fixture: three rounds, so every desk and every projected stage is reachable ──
  const db = testDb()
  const quizId = newQuiz(db, 'legibility night')
  const r1 = newQuestionSetRound(db, quizId, 'Openers')
  addFreeText(db, r1, 'Capital of France?', ['paris'], { points: 10 })
  addMultipleChoice(db, r1, 'Which is a fruit?', [
    { text: 'Tomato', isCorrect: true },
    { text: 'Anvil', isCorrect: false },
  ])
  addJeopardyRound(db, quizId, 'Board', ['Geography'], [100])
  addFinaleRound(
    db,
    quizId,
    'Finale',
    'What do you know about Michael Jackson?',
    KEYWORDS,
  )
  const game = createGame(db, quizId, TEAMS, {
    // Banks everyone can afford: Foxes earn points along the way, the others get topped up
    // below so nobody is eliminated at once (D56 would otherwise end the finale instantly).
    finale: { secondsPerPoint: 0.5, penaltySeconds: 5 },
  })

  // ── surfaces: control drives; two projectors measure, one per locale ──
  const master = await openControl(browser)
  const screens: { locale: 'en' | 'nl'; page: Page }[] = [
    { locale: 'en', page: (await openScreen(browser)).page },
    { locale: 'nl', page: (await openScreen(browser)).page },
  ]
  const phone = await openPlayer(browser)

  /** Measure both projectors at one checkpoint, naming the stage on failure. */
  const measure = async (stage: string): Promise<void> => {
    for (const { locale, page } of screens) {
      const violations = await page.evaluate(collectViolations)
      expect(violations, `${stage} [${locale}] — text below the §2.1 floor`).toEqual([])
      const overflow = await page.evaluate(collectOverflow)
      expect(overflow, `${stage} [${locale}] — page overflow`).toEqual([])
    }
  }

  // ── arming screens, before anything else (they sit outside StageFrame) ──
  for (const { locale, page } of screens) {
    await page.goto(`/${locale}/screen/${game.gameId}`)
    await expect(
      page.getByRole('button', {
        name: locale === 'nl' ? nl.screen.arming.click : en.screen.arming.click,
      }),
    ).toBeVisible()
  }
  const armedViolations = await screens[0]!.page.evaluate(collectViolations)
  expect(armedViolations, 'arming [en] — text below the §2.1 floor').toEqual([])

  for (const { locale, page } of screens) {
    const copy = locale === 'nl' ? nl.screen.arming.click : en.screen.arming.click
    await page.getByRole('button', { name: copy }).click()
    await expect(page.getByRole('button', { name: copy })).toBeHidden({ timeout: 15_000 })
  }

  // A phone joins while both projectors show the waiting stage, so the team list has a row.
  await joinAs(phone.page, game.code, TEAMS[0]!)
  await master.page.goto(`/en/control/${game.gameId}`)
  await measure('waiting')

  // ── the master drives; each checkpoint measures both projectors ──

  // Start → leaderboard-with-NEXT_ROUND; then open round one → its intro stage.
  await advance(master.page, en.control.setup.start)
  await advance(master.page, en.control.question.nextRound)
  await measure('round intro')

  await advance(master.page, en.control.question.openNext)
  await measure('question open (free text)')

  // An answer so the reveal has its "You said" row (PRD 4 §8).
  await phone.page.getByLabel(en.player.game.yourAnswer).fill('paris')
  await phone.page.getByRole('button', { name: en.player.game.submit }).click()

  await advance(master.page, en.control.question.close)
  await advance(master.page, en.control.question.reveal)
  await measure('reveal')

  // Mid-round scoreboard toggle → LEADERBOARD stage (PRD 3 §11.1), then take it down again.
  await master.page.getByRole('button', { name: en.control.scores.showScores }).click()
  await measure('leaderboard (mid-round)')
  await master.page.getByRole('button', { name: en.control.scores.hideScores }).click()

  await advance(master.page, en.control.question.score)
  await advance(master.page, en.control.question.next)

  // Question two is multiple choice — same QUESTION kind, different layout input.
  await phone.page.getByRole('button', { name: 'Tomato' }).click()
  await phone.page.getByRole('button', { name: en.player.game.submit }).click()
  await advance(master.page, en.control.question.close)
  await advance(master.page, en.control.question.reveal)
  await measure('reveal (multiple choice)')
  await advance(master.page, en.control.question.score)

  // Break: countdown stage, then resume — nothing resumes by itself (D8).
  await master.page.getByRole('button', { name: en.control.frame.menu }).click()
  await master.page.getByRole('menuitem', { name: en.control.break.start }).click()
  await master.page.getByLabel(en.control.break.minutes).fill('5')
  await master.page
    .getByRole('dialog')
    .getByRole('button', { name: en.control.break.start })
    .click()
  await measure('break')
  await advance(master.page, en.control.break.resume)

  // Round two: the jeopardy board. All-zero scores → BREAK_TIE_FOR_PICK → the choosing line.
  await advance(master.page, en.control.question.nextRound)
  await measure('jeopardy board')

  // Open a tile and buzz from the phone: the buzz display with two-decimal timings (§8.3).
  await master.page
    .getByRole('main')
    .getByRole('list')
    .first()
    .getByRole('button', { name: /^100$/ })
    .click()
  await phone.page.getByRole('button', { name: en.player.buzzer.buzz }).click()
  await expect(master.page.getByRole('heading', { name: TEAMS[0]! })).toBeVisible({
    timeout: 15_000,
  })
  await measure('buzz display')

  await master.page
    .getByRole('button', { name: new RegExp(en.control.buzz.correct) })
    .click()
  await advance(master.page, en.control.question.close)
  await advance(master.page, en.control.question.reveal)
  await advance(master.page, en.control.question.score)

  // Round three: the finale. Word shapes and idle clocks while the master picks finalists.
  await advance(master.page, en.control.question.nextRound)
  await measure('finale picking')

  /*
   * Top up the two point-less teams so nobody is eliminated at once (D56) and an active turn
   * exists long enough to measure. Announce unchecked: banners here would be noise.
   */
  for (const team of [TEAMS[1]!, TEAMS[2]!] as const) {
    await master.page
      .getByRole('complementary')
      .getByRole('listitem')
      .filter({ hasText: team })
      .getByRole('button', { name: en.control.scores.adjust })
      .click()
    await master.page.getByLabel(en.control.scores.amount).fill('40')
    await master.page.getByLabel(en.control.scores.announce).uncheck()
    await master.page.getByRole('button', { name: /^Apply \+40$/ }).click()
  }
  await advance(master.page, en.control.finale.start)

  // Finalists are set but the keyword question is still pending — opening it is what puts the
  // first turn within reach ([Start <team>] between turns, §10.5).
  await advance(master.page, en.control.question.openNext)

  // Fewest-seconds rule starts someone; whoever it is, the button names them (§10.5). The
  // negative lookahead keeps this off the picker's own [Start the finale], which is gone by now.
  await master.page.getByRole('button', { name: /^Start (?!the finale)/ }).click()
  await measure('finale turn active')

  // End the game → FINISHED. The finale has no ranking yet (unfinished), so this is the
  // standings variant — no tab labels, same components and type scale, which is what the floor
  // checks. The winner hero names a team at maximum size.
  await master.page.getByRole('button', { name: en.control.frame.menu }).click()
  await master.page.getByRole('menuitem', { name: en.control.frame.finish }).click()
  await master.page
    .getByRole('alertdialog')
    .getByRole('button', { name: en.control.frame.finish })
    .click()
  await expect(screenEnPage().getByText(TEAMS[0]!).first()).toBeVisible({
    timeout: 15_000,
  })
  await measure('finished')

  function screenEnPage(): Page {
    return screens[0]!.page
  }

  await Promise.all([
    master.context.close(),
    ...screens.map(({ page }) => page.context().close()),
    phone.context.close(),
  ])
})

/**
 * Slice 6's finding, pinned: **the projector URL is only trustworthy once the network address
 * exists.** After the picker runs it must be absolute with an authority — a QR encoding a
 * relative path resolves to nothing on a phone. Before it runs, relative is correct and
 * deliberate (a guessed origin is a dead link that looks authoritative), which is why that half
 * gets its own spawned server: the shared one has an address by the time any spec runs.
 */
test('the join URL is absolute after the network picker, and honestly relative before it', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  // ── absolute side, on the shared server ──
  const db = testDb()
  const quizId = newQuiz(db, 'qr night')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'], { points: 10 })
  const game = createGame(db, quizId, ['Foxes'])

  const admin = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const adminPage = await admin.newPage()
  await adminPage.goto('/en/admin')
  // Fresh shared server: whichever worker arrives first walks the picker (§4), the rest find
  // the dashboard. Same idempotent pattern as `flows.pastFirstRun`, inline for the hub read.
  const dashboard = adminPage.getByRole('button', { name: en.admin.dashboard.newQuiz })
  await dashboard.or(adminPage.getByRole('heading', { name: en.setup.heading })).waitFor({
    timeout: 20_000,
  })
  if (await adminPage.getByRole('heading', { name: en.setup.heading }).isVisible()) {
    await adminPage.getByRole('button', { name: en.setup.continue }).click()
    await expect(dashboard).toBeVisible({ timeout: 20_000 })
  }

  // The game hub shows the join URL with a real authority — host and port, not a path.
  await adminPage.goto(`/en/admin/games/${game.gameId}`)
  const hubUrl = await adminPage
    .getByText(new RegExp(`[^\\s]*/play/${game.code}`))
    .first()
    .innerText()
  expect(hubUrl.startsWith('/')).toBe(false)
  expect(hubUrl).toContain(':')

  // The projector shows the same URL (scheme stripped for reading) and renders its QR.
  const screen = await openScreen(browser)
  await openScreenFor(screen.page, game.gameId)
  const shown = await screen.page
    .getByText(new RegExp(`[^\\s]*/play/${game.code}`))
    .first()
    .innerText()
  expect(shown.startsWith('/')).toBe(false)
  expect(shown.replace(/^https?:\/\//, '').replace(/\/$/, '')).toBe(
    hubUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  )
  await expect(screen.page.locator('svg').first()).toBeVisible()
  await admin.close()

  // ── relative side: a spawned server whose settings.json has no address ──
  const { spawnKwizServer } = await import('../support/spawn')
  const { resolve } = await import('node:path')
  const dataDir = resolve('.playwright/data', `qr-relative-${process.pid}`)
  const server = spawnKwizServer({ port: 3931, dataDir })
  try {
    await server.waitReady()
    const fresh = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    const page = await fresh.newPage()
    await page.goto(`${server.url}/en/screen/${game.gameId}`)
    // Different database entirely — this game does not exist there, so the screen goes to §14's
    // calm failure state (no arming overlay, no waiting stage, no scannable-looking link). The
    // deliberate relative rendering itself is covered by `views.ts`'s joinUrl builder upstream.
    await expect(page.getByText(en.screen.arming.click)).toHaveCount(0)
    await expect(page.getByText(new RegExp(`/play/${game.code}`))).toHaveCount(0)
    await fresh.close()
  } finally {
    await server.stop().catch(() => undefined)
  }
})
