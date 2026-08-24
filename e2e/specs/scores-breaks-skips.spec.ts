import { expect, test } from '@playwright/test'

import { testDb } from '../support/db'
import {
  advance,
  en,
  fill,
  joinAs,
  openScreenFor,
  railRow,
  startFirstQuestion,
} from '../support/flows'
import { createGame, gameContent } from '../support/game'
import { addFreeText, newQuestionSetRound, newQuiz } from '../support/quiz'
import { openControl, openPlayer, openScreen } from '../support/surfaces'

/**
 * Build-order slice 9, **Scores, breaks, skips** — scenarios 18, 19 and 20.
 *
 * What binds them is that all three are the master *steering rather than scoring*: an adjustment
 * the room is told about, an interval nothing may auto-resume out of (D8), and a question
 * discarded without paying anyone (D46, I8).
 */

const t = en.player
const c = en.control
const s = en.screen
const TEAMS = ['The Quizzengers', 'Trivia Newton John']

test('18 — an adjustment announces itself with its reason, and revoking reconciles', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'scores — scenario 18')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'], { points: 10 })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const screen = await openScreen(browser)
  await openScreenFor(screen.page, game.gameId)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // §11's stepper-first popover: two taps and a reason, announce already ticked (D25).
  await railRow(master.page, TEAMS[0]!)
    .getByRole('button', { name: c.scores.adjust })
    .click()
  await master.page.getByRole('button', { name: '+5', exact: true }).click()
  await master.page.getByLabel(c.scores.reason).fill('best heckle of the night')
  await master.page
    .getByRole('button', { name: fill(c.scores.apply, { delta: '+5' }) })
    .click()

  // The rail moves immediately…
  await expect(railRow(master.page, TEAMS[0]!)).toContainText('5')
  // …the audit gains an undoable row…
  await expect(
    master.page.getByText(`${TEAMS[0]} · best heckle of the night`),
  ).toBeVisible()
  // …and the projector announces it, with the reason, because the reason is the show (D25).
  await expect(screen.page.getByText('+5')).toBeVisible()
  await expect(screen.page.getByText('best heckle of the night')).toBeVisible()

  // `[Undo]` appends a revocation (D41): struck through in the audit, gone from the total,
  // and — deliberately — announced nowhere (D25's other half).
  await master.page.getByRole('button', { name: c.scores.undo }).click()
  await expect(railRow(master.page, TEAMS[0]!)).toContainText('0')
  const revoked = master.page
    .getByRole('complementary')
    .locator('li')
    .filter({ hasText: 'best heckle of the night' })
  await expect(revoked).toHaveClass(/line-through/)
  await expect(master.page.getByText(c.scores.undone)).toBeVisible()

  await Promise.all([master.context.close(), screen.context.close()])
})

test('19 — a break counts down everywhere, extends, and never resumes itself', async ({
  browser,
}) => {
  test.setTimeout(90_000)

  const db = testDb()
  const quizId = newQuiz(db, 'scores — scenario 19')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'], { points: 10 })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const screen = await openScreen(browser)
  const phone = await openPlayer(browser)
  await joinAs(phone.page, game.code, TEAMS[0]!)
  await openScreenFor(screen.page, game.gameId)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // §11.2 — a break over an open question is refused, with the reason shown in the menu itself.
  // The journey therefore does what the master must: lock the question, then break.
  await master.page.getByRole('button', { name: c.frame.menu }).click()
  const startItem = master.page.getByRole('menuitem', { name: c.break.start })
  await expect(startItem).toBeDisabled()
  await expect(master.page.getByText(c.break.blocked)).toBeVisible()
  await master.page.keyboard.press('Escape')

  await advance(master.page, c.question.close)

  // Three real seconds, entered through the dialog's own field: 0.05 minutes is a legal number
  // and keeps determinism rule 5 — short real timers, no clock mocking, no request rewriting.
  await master.page.getByRole('button', { name: c.frame.menu }).click()
  await expect(startItem).toBeEnabled()
  await startItem.click()
  await master.page.getByLabel(c.break.minutes).fill('0.05')
  await master.page
    .getByRole('dialog')
    .getByRole('button', { name: c.break.start })
    .click()

  // The desk, the projector and the phone all say the same thing, each in its own idiom
  // (`m:ss` here, conventions §8.2 — the projector renders the label and the clock apart).
  // A second of the bank may legitimately elapse while the views round-trip, so the claim is
  // "a three-second break is showing", not a frozen digit.
  await expect(master.page.getByText(/Back in 0:0[23]/)).toBeVisible()
  await expect(screen.page.getByText(s.break.backIn)).toBeVisible({ timeout: 15_000 })
  await expect(screen.page.getByText(/0:0[23]/)).toBeVisible()
  await expect(phone.page.getByText(t.game.backIn)).toBeVisible()

  // "Five more minutes" is the most predictable thing in an interval (§11.2) — extend, and the
  // clock jumps to the new total rather than restarting from some default. The extension is a
  // **large** jump (30 s over a 3 s base) on purpose: under load the menu-and-dialog dance can
  // outlive the short base, and an expired base still shows `Back in 0:00` until resumed — so
  // asserting "the desk reached ≥ 0:25 after extending to 0:30" is true regardless of whether
  // the old clock had already run out, while a small absolute delta would race the view push.
  await master.page.getByRole('button', { name: c.frame.menu }).click()
  await master.page.getByRole('menuitem', { name: c.break.extend }).click()
  await master.page.getByLabel(c.break.minutes).fill('0.5')
  await master.page
    .getByRole('dialog')
    .getByRole('button', { name: c.break.extend })
    .click()
  const deskBreakSeconds = async (): Promise<number> => {
    const text = await master.page.getByText(/Back in \d+:\d{2}/).innerText()
    const [, minutes, seconds] = /Back in (\d+):(\d{2})/.exec(text)!
    return Number(minutes) * 60 + Number(seconds)
  }
  await expect
    .poll(deskBreakSeconds, { timeout: 15_000, message: 'extend grew the clock' })
    .toBeGreaterThanOrEqual(25)
  /*
   **Zero holds.** The 30-second clock runs out — the projector says so in as many words (§11) —
   * and nothing anywhere advances: the desk is still on the break, the phone is still on the
   * break. Nothing in this product auto-resumes (D8), and this is the moment that rule earns its
   * place.
   */
  await expect(screen.page.getByText(s.break.startingSoon)).toBeVisible({
    timeout: 45_000,
  })
  await expect(screen.page.getByText(s.break.backIn)).toBeHidden()
  await expect(master.page.getByRole('heading', { name: c.break.title })).toBeVisible()
  await expect(phone.page.getByText(t.game.backIn)).toBeVisible()

  // Only the master's hand ends it.
  await master.page.getByRole('button', { name: c.break.resume }).click()
  await expect(master.page.getByRole('heading', { name: c.break.title })).toBeHidden()
  await expect(phone.page.getByText(t.game.backIn)).toBeHidden()

  await Promise.all([
    master.context.close(),
    screen.context.close(),
    phone.context.close(),
  ])
})

test('20 — skipping pays nobody, not even an answer already auto-graded', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'scores — scenario 20')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'], { points: 10 })
  addFreeText(db, roundId, 'Capital of Spain?', ['madrid'], { points: 10 })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const phone = await openPlayer(browser)
  await joinAs(phone.page, game.code, TEAMS[0]!)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // A perfect answer, graded by the machine before anyone touches anything (D22).
  await phone.page.getByLabel(t.game.yourAnswer).fill('paris')
  await phone.page.getByRole('button', { name: t.game.submit, exact: true }).click()
  const row = master.page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: TEAMS[0]! })
  await expect(row).toContainText(c.question.correct)

  // The audio would not play; the master discards the question instead (PRD 3 §9.1).
  await master.page.getByRole('button', { name: c.frame.menu }).click()
  await master.page.getByRole('menuitem', { name: c.frame.skipQuestion }).click()

  // Skipped is terminal and public: the timeline says so…
  await expect(master.page.getByRole('button', { name: /skipped/ }).first()).toBeVisible()
  // …nobody was paid, most of all the team the machine had marked correct (D46, I8)…
  await expect(railRow(master.page, TEAMS[0]!)).toContainText('0')
  // …and the desk offers the round's remaining question, not a dead end.
  await advance(master.page, c.question.openNext)
  await expect(
    master.page.getByRole('heading', { name: 'Capital of Spain?' }),
  ).toBeVisible()

  await Promise.all([phone.context.close(), master.context.close()])
})

/**
 * Scenario 20b — *ending a round early never points pacing back into it.*
 *
 * Slice 9's review finding: `End this round` with questions still pending used to leave the
 * desk suggesting `[Next question]` into the closed round, and opening one of its questions
 * reopened ended gameplay. Now the closed round is invisible to pacing, its timeline link is
 * gone, and a direct request is refused with a typed error.
 */
test('20b — a round the master ended cannot be reopened and does not trap pacing', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'scores — scenario 20b')
  const roundOne = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundOne, 'Capital of France?', ['paris'], { points: 10 })
  addFreeText(db, roundOne, 'Capital of Spain?', ['madrid'], { points: 10 })
  const roundTwo = newQuestionSetRound(db, quizId, 'Round two')
  addFreeText(db, roundTwo, 'Capital of Portugal?', ['lisbon'], { points: 10 })
  const game = createGame(db, quizId, TEAMS)

  const content = gameContent(db, game.gameId)
  const spainQuestionId = content.rounds[0]!.questions[1]!.id

  const master = await openControl(browser)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // Play question one to completion…
  await advance(master.page, c.question.close)
  await advance(master.page, c.question.reveal)
  await advance(master.page, c.question.score)

  // …then end the round with question two still unplayed.
  await master.page.getByRole('button', { name: c.frame.menu }).click()
  await master.page.getByRole('menuitem', { name: c.frame.closeRound }).click()

  // The desk's suggestion is the NEXT ROUND — never a `[Next question]` into what was just
  // ended. This is the assertion that failed before the fix.
  await expect(
    master.page.getByRole('button', { name: c.question.nextRound }),
  ).toBeVisible()
  await expect(
    master.page.getByRole('button', { name: c.question.next, exact: true }),
  ).toHaveCount(0)
  await expect(
    master.page.getByRole('button', { name: c.question.openNext }),
  ).toHaveCount(0)

  // A direct request cannot reopen the closed round's gameplay either (PRD 3 §9.2).
  const refused = await master.page.request.post(
    `/api/games/${game.gameId}/questions/${spainQuestionId}/open`,
    { data: {} },
  )
  expect(refused.status()).toBe(409)
  expect(await refused.json()).toMatchObject({ ok: false, error: 'ROUND_CLOSED' })

  // …and pacing flows onward: round two opens and plays normally.
  await advance(master.page, c.question.nextRound)
  await advance(master.page, c.question.openNext)
  await expect(
    master.page.getByRole('heading', { name: 'Capital of Portugal?' }),
  ).toBeVisible()

  await master.context.close()
})
