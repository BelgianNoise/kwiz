import { expect, test, type Page } from '@playwright/test'

import nl from '../../apps/web/messages/nl'
import { testDb } from '../support/db'
import { advance, en, fill, joinAs, openScreenFor } from '../support/flows'
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
 * The §2.1 floor, evaluated inside the page.
 *
 * - Direct text nodes only: containers inherit their children's sizes.
 * - Hidden elements are skipped (`display: none` ancestors still resolve computed styles, so
 *   without this check a closed popover or inactive tab would produce false positives).
 * - The language switcher is chrome for whoever operates the laptop, not stage content — slice 6
 *   ignored its two entries and this check keeps that exception. Matched structurally (`nav`),
 *   because its accessible name is translated and would leak through on the nl page. **Scoped to
 *   chrome as it exists today**: if projected content ever moves inside a nav, this exemption
 *   needs revisiting.
 */
function collectViolations(): string[] {
  const floor = window.innerHeight * 0.04
  const bad: string[] = []
  document.body.querySelectorAll('*').forEach((el) => {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META'].includes(el.tagName)) return
    if (el.closest('nav')) return
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return
    let parent = el.parentElement
    while (parent) {
      const ps = getComputedStyle(parent)
      if (ps.display === 'none' || ps.visibility === 'hidden') return
      parent = parent.parentElement
    }
    const hasText = [...el.childNodes].some(
      (node) => node.nodeType === 3 && (node.textContent ?? '').trim(),
    )
    if (!hasText) return
    const px = parseFloat(style.fontSize)
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

  // -- fixture: three rounds, so every desk and every projected stage is reachable
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

  // -- surfaces: control drives; two projectors measure, one per locale
  const master = await openControl(browser)
  const screens: { locale: 'en' | 'nl'; page: Page }[] = [
    { locale: 'en', page: (await openScreen(browser)).page },
    { locale: 'nl', page: (await openScreen(browser)).page },
  ]
  const phone = await openPlayer(browser)

  /**
   * Measure both projectors at one checkpoint, naming the stage on failure. **Every projected
   * pixel goes through this** — including arming (which sits outside StageFrame but inside the
   * viewport, so both evaluators work there too).
   */
  const measure = async (stage: string): Promise<void> => {
    for (const { locale, page } of screens) {
      const violations = await page.evaluate(collectViolations)
      expect(violations, `${stage} [${locale}] — text below the §2.1 floor`).toEqual([])
      const overflow = await page.evaluate(collectOverflow)
      expect(overflow, `${stage} [${locale}] — page overflow`).toEqual([])
    }
  }

  // -- arming screens: measured through the same path as everything else
  for (const { locale, page } of screens) {
    await page.goto(`/${locale}/screen/${game.gameId}`)
    await expect(
      page.getByRole('button', {
        name: locale === 'nl' ? nl.screen.arming.click : en.screen.arming.click,
      }),
    ).toBeVisible()
  }
  await measure('arming')

  for (const { locale, page } of screens) {
    const copy = locale === 'nl' ? nl.screen.arming.click : en.screen.arming.click
    await page.getByRole('button', { name: copy }).click()
    await expect(page.getByRole('button', { name: copy })).toBeHidden({ timeout: 15_000 })
  }

  // A phone joins while both projectors show the waiting stage, so the team list has a row.
  await joinAs(phone.page, game.code, TEAMS[0]!)
  await master.page.goto(`/en/control/${game.gameId}`)
  await measure('waiting')

  // -- the master drives; each checkpoint measures both projectors

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
    const label = fill(en.control.scores.apply, { delta: '+40' })
    await master.page.getByRole('button', { name: label }).click()
  }
  await advance(master.page, en.control.finale.start)

  // Finalists are set but the keyword question is still pending — opening it is what puts the
  // first turn within reach ([Start <team>] between turns, §10.5).
  await advance(master.page, en.control.question.openNext)

  /*
   * Fewest-seconds starts Whales (20s, tied with Iguanas at 20s, position tiebreak goes to
   * Whales at position 1 over Iguanas at position 2). Asserted by name rather than a loose
   * prefix so a future button beginning "Start…" cannot satisfy it accidentally.
   */
  await advance(master.page, fill(en.control.finale.startTurn, { team: TEAMS[1]! }))
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
  await expect(screens[0]!.page.getByText(TEAMS[0]!).first()).toBeVisible({
    timeout: 15_000,
  })
  await measure('finished')

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
 * gets its own spawned server with its own game: the shared one has an address by the time any
 * spec runs.
 */
test('the join URL is absolute after the network picker, and honestly relative before it', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  /**
   * Reads the rendered join URL. `absolute: true` asserts authority (host:port, not just a
   * path); `absolute: false` asserts the opposite — path-only, no guessed origin.
   */
  const readJoinUrl = async (
    page: Page,
    code: string,
    absolute: boolean,
  ): Promise<string> => {
    const text = (
      await page
        .getByText(new RegExp(`[^\\s]*/play/${code}`))
        .first()
        .innerText()
    ).trim()
    expect(text).toContain(`/play/${code}`)
    if (absolute) {
      // The hub renders the full URL; the projector's displayUrl strips the scheme for
      // reading. Either way the key assertion is: not a bare path.
      expect(text.startsWith('/')).toBe(false)
      expect(text).toContain(':')
    } else {
      // No address chosen yet: path-only is correct and deliberate (slice 6).
      expect(text.startsWith('/')).toBe(true)
      expect(text).toBe(`/play/${code}`)
    }
    return text
  }

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
  const hubUrl = await readJoinUrl(adminPage, game.code, true)

  // The projector shows the same URL (scheme stripped for reading) and renders its QR.
  const screen = await openScreen(browser)
  await openScreenFor(screen.page, game.gameId)
  const shownUrl = await readJoinUrl(screen.page, game.code, true)
  // The projector's displayUrl strips the scheme for reading, so normalise both sides.
  const stripScheme = (url: string): string =>
    url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  expect(stripScheme(shownUrl)).toBe(stripScheme(hubUrl))
  await expect(screen.page.locator('svg').first()).toBeVisible()
  await admin.close()

  // ── relative side: on a spawned server whose database contains its own game ──
  const { spawnKwizServer } = await import('../support/spawn')
  const { resolve } = await import('node:path')
  const { openDatabase } = await import('@kwiz/db')
  const dataDir = resolve('.playwright/data', `qr-relative-${process.pid}`)
  const server = spawnKwizServer({ port: 3931, dataDir })
  try {
    await server.waitReady()
    // A game created **in this server's own data dir** exercises the relative rendering path:
    // settings.json has no chosen address, so joinUrl stays path-only by design (a guessed
    // origin is a dead link that looks authoritative).
    const localDb = openDatabase(resolve(dataDir, 'kwiz.db'))
    const {
      newQuiz: fq,
      newQuestionSetRound: fr,
      addFreeText: fa,
    } = await import('../support/quiz')
    const localQuizId = fq(localDb, 'relative qr night')
    const localRoundId = fr(localDb, localQuizId, 'Round one')
    fa(localDb, localRoundId, 'Capital of France?', ['paris'], { points: 10 })
    const localGame = createGame(localDb, localQuizId, ['Foxes'])

    const fresh = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    const page = await fresh.newPage()
    await page.goto(`${server.url}/en/screen/${localGame.gameId}`)
    await page.getByText(en.screen.arming.click).click()
    await expect(page.getByText(en.screen.waiting.andEnter)).toBeVisible({
      timeout: 15_000,
    })

    // The rendered URL must be exactly the path — no host, no port, nothing scannable-looking.
    const relativeUrl = await readJoinUrl(page, localGame.code, false)
    expect(relativeUrl).toBe(`/play/${localGame.code}`)

    // …and the QR renders from the path-only string too.
    await expect(page.locator('svg').first()).toBeVisible()
    await fresh.close()
  } finally {
    await server.stop().catch(() => undefined)
  }
})
