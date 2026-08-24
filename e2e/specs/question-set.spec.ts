import { MC_DISTRIBUTION_DELAY_MS } from '@kwiz/domain'
import { expect, test } from '@playwright/test'

import { testDb } from '../support/db'
import {
  advance,
  answerRow,
  en,
  joinAs,
  openScreenFor,
  railRow,
  startFirstQuestion,
} from '../support/flows'
import { createGame } from '../support/game'
import {
  addFreeText,
  addMultipleChoice,
  newQuestionSetRound,
  newQuiz,
} from '../support/quiz'
import {
  openControl,
  openPlayer,
  openScreen,
  openSecondPlayer,
} from '../support/surfaces'

/**
 * Build-order slice 9, **`QUESTION_SET`** — scenarios 8 to 12.
 *
 * The densest group in the suite, because this is the round type an ordinary evening is mostly
 * made of. Between them these five cover the whole loop (open → answer → judge → reveal →
 * spotlight → score → advance) and the three rules that loop is easiest to get wrong: the
 * advisory deadline (D8), submission finality (D43) and shared drafts (D45).
 */

const t = en.player
const c = en.control
const TEAMS = ['The Quizzengers', 'Trivia Newton John']

/**
 * Scenario 8 — *"Free text: two teams submit, master validates inline, reveals, spotlights one
 * answer, scores, advances."*
 *
 * The second team's answer is deliberately **not** in the accepted list, so it arrives
 * `AUTO_WRONG` and the master overrides it to accepted. That is what makes this a test of
 * *validation* rather than of auto-grading: an evening where both answers matched would never
 * touch the accept button, which is the control the whole of PRD 3 §5.2 exists for.
 */
test('8 — free text runs open → judge → reveal → spotlight → score → next', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'question set — scenario 8')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'], { points: 10 })
  addFreeText(db, roundId, 'Capital of Spain?', ['madrid'], { points: 10 })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const screen = await openScreen(browser)
  const one = await openPlayer(browser)
  const two = await openPlayer(browser)

  await joinAs(one.page, game.code, TEAMS[0]!)
  await joinAs(two.page, game.code, TEAMS[1]!)
  await openScreenFor(screen.page, game.gameId)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // Both phones answer. `paris` matches after lowercase+trim (D22); `Parris` does not.
  await one.page.getByLabel(t.game.yourAnswer).fill('paris')
  await one.page.getByRole('button', { name: t.game.submit, exact: true }).click()
  await two.page.getByLabel(t.game.yourAnswer).fill('Parris')
  await two.page.getByRole('button', { name: t.game.submit, exact: true }).click()

  // The desk sees both, and grades what it can automatically. Scoped to the row because the
  // question header shows the accepted answer too (PRD 3 §5.1) — two `paris` on one screen.
  const wrongRow = answerRow(master.page, TEAMS[1]!)
  await expect(answerRow(master.page, TEAMS[0]!)).toContainText('paris')
  await expect(wrongRow).toContainText(c.question.wrong)

  // The override: close enough for the master, which is the only opinion that counts (D22).
  await wrongRow.getByRole('button', { name: c.question.accept }).click()
  await expect(wrongRow).toContainText(c.question.correct)

  await advance(master.page, c.question.close)
  await advance(master.page, c.question.reveal)

  // Beat 1 — the correct answer replaces the prompt on the projection (PRD 4 §8.1).
  await expect(screen.page.getByText('paris', { exact: true })).toBeVisible()

  // Beat 2 — free text has no timing, only the master's choice of which answer to show.
  await wrongRow.getByRole('button', { name: c.question.showOnScreen }).click()
  await expect(wrongRow.getByRole('button', { name: c.question.onScreen })).toBeVisible()
  await expect(screen.page.getByText('“Parris”')).toBeVisible()

  await advance(master.page, c.question.score)

  // Both scored: one auto-correct, one accepted by hand. The right rail is PRD 3 §11's.
  await expect(railRow(master.page, TEAMS[0]!)).toContainText('10')
  await expect(railRow(master.page, TEAMS[1]!)).toContainText('10')

  // …and the desk offers the next question in the round rather than stalling on this one.
  await advance(master.page, c.question.next)
  await expect(
    master.page.getByRole('heading', { name: 'Capital of Spain?' }),
  ).toBeVisible()

  await Promise.all([
    one.context.close(),
    two.context.close(),
    screen.context.close(),
    master.context.close(),
  ])
})

/**
 * Scenario 9 — *"Multiple choice: distribution appears ~1.5 s after the correct option is
 * marked."*
 *
 * Asserted as an **ordering with a measured gap**, not as "absent, then present". The absence
 * half of that phrasing is a race — on a slow runner the check can arrive after the beat has
 * already played and pass for the wrong reason — whereas timing the two arrivals fails if the
 * delay is removed and cannot pass early.
 *
 * `MC_DISTRIBUTION_DELAY_MS` is imported rather than written as `1500`, for the reason
 * `constants.ts` gives: a duplicated literal is how the beat drifts.
 */
test('9 — the option distribution lands a beat after the correct answer', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'question set — scenario 9')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addMultipleChoice(db, roundId, 'Which is a fruit?', [
    { text: 'Tomato', isCorrect: true },
    { text: 'Anvil', isCorrect: false },
  ])
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const screen = await openScreen(browser)
  const one = await openPlayer(browser)
  const two = await openPlayer(browser)

  await joinAs(one.page, game.code, TEAMS[0]!)
  await joinAs(two.page, game.code, TEAMS[1]!)
  await openScreenFor(screen.page, game.gameId)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // One right, one wrong, so the distribution has something to be a distribution of.
  await one.page.getByRole('button', { name: 'Tomato' }).click()
  await one.page.getByRole('button', { name: t.game.submit, exact: true }).click()
  await two.page.getByRole('button', { name: 'Anvil' }).click()
  await two.page.getByRole('button', { name: t.game.submit, exact: true }).click()

  await advance(master.page, c.question.close)
  await advance(master.page, c.question.reveal)

  // The correct option's tick — beat 1.
  await expect(screen.page.getByText('✓')).toBeVisible()
  const markedAt = Date.now()

  // The team dots — beat 2. `aria-hidden` by design (they are colour, and the row already names
  // the option), so this is one of the few places a CSS locator is the honest one.
  const dots = screen.page.locator('li span[style*="background-color"]')
  await expect(dots.first()).toBeVisible()
  const distributedAt = Date.now()

  // Generous lower bound: the point is that a beat exists, and removing the delay drops this
  // gap to single-digit milliseconds. A tight bound here would be a timing test, not a beat one.
  expect(distributedAt - markedAt).toBeGreaterThan(MC_DISTRIBUTION_DELAY_MS / 2)

  // The room still sees the question it was asked: authored order, not correct-first.
  await expect(screen.page.getByRole('listitem').first()).toContainText('Tomato')

  await Promise.all([
    one.context.close(),
    two.context.close(),
    screen.context.close(),
    master.context.close(),
  ])
})

/**
 * Scenario 10 — *"Timer expiry auto-submits the entered value; a late submit is still accepted
 * and the server does not lock the question (D8)."*
 *
 * The single most consequential rule on this surface, and the one a reasonable implementation
 * gets wrong by being helpful. Two teams, two halves of it:
 *
 * - **The team that was looking at the screen** typed an answer and never pressed send. At zero
 *   the client commits it for them (PRD 5 §5.4).
 * - **The team whose phone was asleep** types nothing until after zero, then answers — and it
 *   counts, because `deadlineAt` is advisory and only the master locking the question stops
 *   submissions.
 *
 * A 2-second bank, per the determinism rules: real elapsed time, no clock mocking.
 */
test('10 — zero auto-submits, and a late answer still counts', async ({ browser }) => {
  const db = testDb()
  const quizId = newQuiz(db, 'question set — scenario 10')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'], {
    points: 10,
    timerMs: 2_000,
  })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const one = await openPlayer(browser)
  const two = await openPlayer(browser)

  await joinAs(one.page, game.code, TEAMS[0]!)
  await joinAs(two.page, game.code, TEAMS[1]!)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // Typed and left. No submit tap anywhere in this test for team one.
  await one.page.getByLabel(t.game.yourAnswer).fill('paris')

  // Waiting on the desk's own "time up" rather than on a sleep: the deadline passing is
  // observable state, which is determinism rule 3.
  await expect(master.page.getByText(c.question.timeUp)).toBeVisible()

  // Half one: the client submitted on the team's behalf at zero.
  await expect(one.page.getByText(t.game.lockedIn)).toBeVisible()

  // Half two: the question is still open — the desk's forward action is still *close*, which is
  // the observable form of "the server did not lock it".
  await expect(
    master.page.getByRole('button', { name: c.question.close, exact: true }),
  ).toBeVisible()

  // …and a submission after zero is accepted rather than refused (D8).
  await two.page.getByLabel(t.game.yourAnswer).fill('madrid')
  await two.page.getByRole('button', { name: t.game.submit, exact: true }).click()
  await expect(two.page.getByText(t.game.lockedIn)).toBeVisible()
  await expect(answerRow(master.page, TEAMS[1]!)).toContainText('madrid')

  await Promise.all([one.context.close(), two.context.close(), master.context.close()])
})

/**
 * Scenario 11 — *"Submission finality: two devices on one team, second submits a different
 * value → rejected, canonical answer shown (D43)."*
 *
 * Two phones on one team is the ordinary case, not an edge case — a table passes a phone
 * around, and someone's partner has the page open too. The rule that makes that safe is that
 * the **first** write wins and the second is told what the team actually said, rather than
 * quietly replacing it and starting an argument at scoring time.
 */
test('11 — a second device cannot overwrite its team’s answer', async ({ browser }) => {
  const db = testDb()
  const quizId = newQuiz(db, 'question set — scenario 11')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'], { points: 10 })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const first = await openPlayer(browser)
  const second = await openSecondPlayer(browser)

  // Same team, two devices — each its own context, so each holds its own device token.
  await joinAs(first.page, game.code, TEAMS[0]!)
  await joinAs(second.page, game.code, TEAMS[0]!)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  await expect(second.page.getByLabel(t.game.yourAnswer)).toBeVisible()

  /*
   * **The second phone's submission is held in flight, on purpose.**
   *
   * Two phones racing is the case D43 exists for, and it cannot be produced by tapping one
   * after the other: `submitted` is a *team* fact, so the instant the first answer lands the
   * second phone's view replaces its input with the locked-in panel (PRD 5 §5.2) and there is
   * nothing left to type into. Holding the POST puts the two writes in the order the rule is
   * about — second tap first, second arrival last — deterministically instead of by luck.
   */
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await second.context.route('**/submit', async (route) => {
    await held
    await route.continue()
  })

  await second.page.getByLabel(t.game.yourAnswer).fill('lyon')
  await second.page.getByRole('button', { name: t.game.submit, exact: true }).click()
  await expect(second.page.getByText(t.game.sending)).toBeVisible()

  // The first phone's answer lands while the second's is still in the air.
  await first.page.getByLabel(t.game.yourAnswer).fill('paris')
  await first.page.getByRole('button', { name: t.game.submit, exact: true }).click()
  await expect(first.page.getByText(t.game.lockedIn)).toBeVisible()

  const refusal = second.page.waitForResponse('**/submit')
  release()

  /*
   * **Refused by name, with the team's answer attached** (protocol §7.3, D43). Asserted on the
   * wire rather than on screen because the two are racing by design: the pushed view arrives
   * about the same time and re-renders the phone as `Submitted`, which is what the player
   * *should* see. The typed error code is the part only the network can show.
   */
  const body: unknown = await (await refusal).json()
  expect(body).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED' })

  // …and what the phone ends up showing is the team's canonical answer, never its own text.
  await expect(second.page.getByText(t.game.lockedIn)).toBeVisible()
  await expect(second.page.getByText('paris', { exact: true })).toBeVisible()
  await expect(second.page.getByText('lyon')).toBeHidden()

  // Exactly one answer reached the desk, which is the invariant every surface hangs off.
  await expect(answerRow(master.page, TEAMS[0]!)).toContainText('paris')
  await expect(master.page.getByText('lyon')).toBeHidden()

  await Promise.all([
    first.context.close(),
    second.context.close(),
    master.context.close(),
  ])
})

/**
 * Scenario 12 — *"Shared drafts: type on device A, text appears on device B (D45)."*
 *
 * The reason drafts are shared at all: two phones on one team must not be able to type two
 * different answers in parallel and discover the conflict only at submission. This is also the
 * mechanism scenario 10's auto-submit relies on, so it is worth seeing it work on its own.
 */
test('12 — a draft typed on one phone reaches the team’s other phone', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'question set — scenario 12')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'], { points: 10 })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const first = await openPlayer(browser)
  const second = await openSecondPlayer(browser)

  await joinAs(first.page, game.code, TEAMS[0]!)
  await joinAs(second.page, game.code, TEAMS[0]!)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  await first.page.getByLabel(t.game.yourAnswer).fill('par')

  // The draft is debounced, pushed, and arrives as a whole view (D38) — so this waits on the
  // *other phone's input value*, which is the only thing that proves the round trip happened.
  await expect(second.page.getByLabel(t.game.yourAnswer)).toHaveValue('par')

  /*
   * **A live draft is not an answer**, and the desk says so: the row reads *still answering*
   * (PRD 3 §5.1), not a half-typed answer waiting to be judged.
   */
  await expect(answerRow(master.page, TEAMS[0]!)).toContainText(c.question.stillAnswering)

  /*
   * D26's other half. Locking the question **commits the outstanding draft as an answer**, so
   * a team that typed and never pressed send still gets marked — flagged *not confirmed*, which
   * is the whole point: a master who denied it as a wrong answer would be denying something the
   * team never actually sent.
   */
  await advance(master.page, c.question.close)
  const row = answerRow(master.page, TEAMS[0]!)
  await expect(row).toContainText('par')
  await expect(row).toContainText(c.question.notConfirmed)

  await Promise.all([
    first.context.close(),
    second.context.close(),
    master.context.close(),
  ])
})
