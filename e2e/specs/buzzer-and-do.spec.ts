import { expect, test, type Browser, type Page } from '@playwright/test'

import { testDb } from '../support/db'
import { advance, en, joinAs, railRow, startFirstQuestion } from '../support/flows'
import { createGame } from '../support/game'
import {
  addBuzzer,
  addDo,
  addFreeText,
  newQuestionSetRound,
  newQuiz,
} from '../support/quiz'
import { openControl, openPlayer } from '../support/surfaces'

/**
 * Build-order slice 9, **Buzzer & `DO`** — scenarios 13 to 16.
 *
 * 13 and 14 are the buzz loop, which CLAUDE.md §6 lists first among the must-tests. 15 and 16
 * are the two `DO` modes (D23, D24), where the master's judgement is the only input and the
 * arithmetic behind it is easy to get subtly wrong.
 */

const t = en.player
const c = en.control
const TEAMS = ['The Quizzengers', 'Trivia Newton John', 'Quizteama Aguilera']

/** Three phones, one per team — every scenario here needs at least two, and 15 needs all three. */
async function threePhones(browser: Browser, code: string) {
  const phones = []
  for (const name of TEAMS) {
    // Sequential: each join must land before the next, so the device counts are unambiguous.
    // oxlint-disable-next-line no-await-in-loop
    const phone = await openPlayer(browser)
    // oxlint-disable-next-line no-await-in-loop
    await joinAs(phone.page, code, name)
    phones.push(phone)
  }
  return phones
}

/**
 * The desk's countdown, in whole seconds, read from what the master actually sees (PRD 3 §5.1 —
 * whole seconds, never `m:ss`, per conventions §8.2).
 *
 * The locator is the question header's own clock (`ml-auto` puts it at the header's far edge) and
 **not** "the first tabular number on the desk": before the first pushed view arrives, `main` can
 * still hold the leaderboard, whose ranks are tabular too — sampling that reads a rank, not a
 * clock, is how this helper failed the first time it ran.
 */
async function deskSeconds(page: Page): Promise<number> {
  const text = await page
    .getByRole('main')
    .locator('span.ml-auto.tabular-nums')
    .first()
    .innerText()
  const match = /\d+/.exec(text)
  if (!match) throw new Error(`no clock on the desk, found ${JSON.stringify(text)}`)
  return Number(match[0])
}

/**
 * Scenario 13 — *"Both teams buzz; first is adjudicated; denied → locked out → buzzers reopen;
 * second buzzes and is accepted (D35)."*
 *
 * The loop CLAUDE.md §6 names first among the must-tests, and the reason is the middle step: a
 * denial has to lock **only** the denied team out and re-arm the buzzers for everyone else, in
 * one move. Getting that wrong either freezes the question or lets the denied team buzz again,
 * and a room notices both within about a second.
 *
 * "Both teams buzz" is asserted as the room experiences it rather than as two simultaneous taps:
 * the second team goes for it, is told *who* got there first (never *what* they said — PRD 1 §7
 * invariant 3), and its buzzer comes back live the moment the first team is denied.
 */
test('13 — a denied buzz locks that team out and re-arms the rest', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'buzzer — scenario 13')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addBuzzer(db, roundId, 'Who painted the Mona Lisa?', ['da vinci'], { points: 10 })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const phones = await threePhones(browser, game.code)
  const [one, two] = phones

  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // Team one gets there first. The phone says "you're in" — **holding the buzz** is the server's
  // confirmation, and on loopback it arrives before any sample could catch the transient "buzzed"
  // tap feedback. What it never says is "you were first": first is not a fact a phone can know.
  await one!.page.getByRole('button', { name: t.buzzer.buzz }).click()
  await expect(one!.page.getByText(t.buzzer.youreIn)).toBeVisible()
  await expect(one!.page.getByText(t.buzzer.answerOutLoud)).toBeVisible()

  // Team two went for it too, and is told who beat them by name.
  await expect(two!.page.getByText(TEAMS[0]!)).toBeVisible()
  await expect(two!.page.getByRole('button', { name: t.buzzer.buzz })).toBeHidden()

  // The desk puts the buzzing team's name at hero scale: the master has to say it out loud.
  await expect(master.page.getByRole('heading', { name: TEAMS[0]! })).toBeVisible()

  // Denied. Team one is out of this question; nobody else is.
  await master.page.getByRole('button', { name: new RegExp(c.buzz.wrong) }).click()

  await expect(one!.page.getByText(t.buzzer.wrongAnswer)).toBeVisible()
  await expect(one!.page.getByRole('button', { name: t.buzzer.buzz })).toBeHidden()
  await expect(master.page.getByText(c.buzz.liveAgain)).toBeVisible()

  // …and the buzzers are live again for the two teams that have not answered wrongly.
  await expect(two!.page.getByRole('button', { name: t.buzzer.buzz })).toBeVisible()
  await expect(phones[2]!.page.getByRole('button', { name: t.buzzer.buzz })).toBeVisible()

  await two!.page.getByRole('button', { name: t.buzzer.buzz }).click()
  await expect(master.page.getByRole('heading', { name: TEAMS[1]! })).toBeVisible()
  await master.page.getByRole('button', { name: new RegExp(c.buzz.correct) }).click()
  await expect(two!.page.getByText(t.buzzer.youreIn)).toBeVisible()

  // Accepted, but the question is still open — locking it is the master's act, as on any
  // other question (D35 keeps it open precisely so a denial could re-arm the room).
  await advance(master.page, c.question.close)
  await advance(master.page, c.question.reveal)
  await advance(master.page, c.question.score)
  await expect(railRow(master.page, TEAMS[1]!)).toContainText('10')
  await expect(railRow(master.page, TEAMS[0]!)).toContainText('0')

  await Promise.all([
    ...phones.map((phone) => phone.context.close()),
    master.context.close(),
  ])
})

/**
 * Scenario 14 — *"Timer is paused during adjudication and resumes on reopen."*
 *
 * D35's fairness half: the master's thinking time must not come out of the clock belonging to
 * the teams who did *not* buzz, because on a buzzer question those seconds are all they have
 * left.
 *
 * **Asserted as "the paused seconds were not deducted", not as a frozen number**, because there
 * is no frozen number to read: while a buzz is being judged, the projector deliberately replaces
 * the count with `⏸` (PRD 4 §7) and the desk swaps the question header for the buzz desk. So the
 * clock is sampled either side of a real three-second deliberation, and the gap between the two
 * samples is what proves the hold. Remove the pause and that gap grows by the full three seconds.
 */
test('14 — the clock holds while a buzz is being judged', async ({ browser }) => {
  const db = testDb()
  const quizId = newQuiz(db, 'buzzer — scenario 14')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  // Long enough that nothing here is racing expiry, short enough to stay a plausible question.
  addBuzzer(db, roundId, 'Who wrote Ulysses?', ['joyce'], { points: 10, timerMs: 60_000 })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const phones = await threePhones(browser, game.code)
  const [one] = phones

  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)
  // The clock is only on the desk once the question desk has replaced the leaderboard.
  await expect(
    master.page.getByRole('heading', { name: 'Who wrote Ulysses?' }),
  ).toBeVisible()

  const before = await deskSeconds(master.page)

  await one!.page.getByRole('button', { name: t.buzzer.buzz }).click()

  // The desk says it in as many words, so the master knows they are free to think (D35).
  await expect(master.page.getByText(c.buzz.timerPaused)).toBeVisible()

  /*
   * **The suite's one deliberate wait**, and determinism rule 5 is why: proving that a clock did
   * *not* advance over an interval requires the interval to actually pass. Three real seconds
   * rather than a mocked clock, because the behaviour under test *is* elapsed time, and mocking
   * it across a server and four browser contexts is more fragile than waiting.
   */
  await master.page.waitForTimeout(3_000)

  await master.page.getByRole('button', { name: new RegExp(c.buzz.wrong) }).click()
  await expect(master.page.getByText(c.buzz.liveAgain)).toBeVisible()

  const after = await deskSeconds(master.page)

  /*
   * Under a second of un-paused time passed in this test (two clicks and a view round trip), so
   * a working pause loses at most 2. A broken one loses at least 4 — the gap between those two
   * numbers is the whole assertion, and it is why the deliberation is 3 s rather than 1.
   */
  expect(before - after).toBeLessThanOrEqual(2)
  // And the bank was not *restarted* either, which would show as no loss at all across 4 s.
  expect(after).toBeLessThan(before + 1)

  await Promise.all([
    ...phones.map((phone) => phone.context.close()),
    master.context.close(),
  ])
})

/**
 * Scenario 15 — *"`DO` winner-takes-all including a multi-winner tie, and 'nobody got it'."*
 *
 * Three outcomes of one question type (D23). The tie is the interesting one: with `tiePayout`
 * `FULL`, two winners each take the whole value rather than half of it — the opposite of what
 * `SPLIT` does, and a difference the master needs to see *before* committing, which is why the
 * button itself changes to say *"Award 20 pts each"*.
 *
 * The desk appears when the question is **locked**, not while it is open: a `DO` challenge is
 * judged after it has happened (PRD 3 §8), so `[Close answers]` is part of the journey.
 */
test('15 — DO winner-takes-all pays one winner, a tie, and nobody', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'do — scenario 15')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addDo(
    db,
    roundId,
    'Closest to the pin',
    { scoringMode: 'WINNER_TAKES_ALL' },
    { points: 10 },
  )
  addDo(
    db,
    roundId,
    'Best paper aeroplane',
    { scoringMode: 'WINNER_TAKES_ALL', tiePayout: 'FULL' },
    { points: 20 },
  )
  addDo(
    db,
    roundId,
    'Hardest riddle',
    { scoringMode: 'WINNER_TAKES_ALL' },
    { points: 30 },
  )
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const phones = await threePhones(browser, game.code)

  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // A `DO` question has **no input control at all** on a phone (PRD 5 §8.1) — not a disabled
  // one, because a greyed field invites a team to conclude the app is broken.
  await expect(phones[0]!.page.getByText(t.game.masterJudging)).toBeVisible()
  await expect(phones[0]!.page.getByLabel(t.game.yourAnswer)).toBeHidden()

  // One winner. Saving the verdict completes the question — `DO` has no reveal beat — so the
  // desk yields to `[Next question]` instead of staying on a finished scoring view.
  await advance(master.page, c.question.close)
  await expect(master.page.getByRole('heading', { name: c.do.whoWon })).toBeVisible()
  await master.page.getByRole('button', { name: new RegExp(TEAMS[0]!) }).click()
  await master.page.getByRole('button', { name: /^Award 10/ }).click()
  await advance(master.page, c.question.next)
  await expect(
    master.page.getByRole('heading', { name: 'Best paper aeroplane' }),
  ).toBeVisible()

  // A tie, paid in full to both (D24) rather than split.
  await advance(master.page, c.question.close)
  await master.page.getByRole('button', { name: new RegExp(TEAMS[1]!) }).click()
  await master.page.getByRole('button', { name: new RegExp(TEAMS[2]!) }).click()
  await master.page.getByRole('button', { name: /each$/ }).click()

  // Nobody got it — an explicit outcome with its own button (D23), never the absence of one.
  await advance(master.page, c.question.next)
  await expect(master.page.getByRole('heading', { name: 'Hardest riddle' })).toBeVisible()
  await advance(master.page, c.question.close)
  await master.page.getByRole('button', { name: c.do.nobody, exact: true }).click()

  await expect(railRow(master.page, TEAMS[0]!)).toContainText('10')
  await expect(railRow(master.page, TEAMS[1]!)).toContainText('20')
  await expect(railRow(master.page, TEAMS[2]!)).toContainText('20')

  await Promise.all([
    ...phones.map((phone) => phone.context.close()),
    master.context.close(),
  ])
})

/**
 * Scenario 16 — *"`DO` per-team scores, clamped to `0…points`."*
 *
 * The other `DO` mode (D24): every team gets its own number, and the number is bounded. The
 * clamp is the part worth a test — a mis-typed `500` on a 10-point question has to be refused
 * rather than quietly handing one team the evening.
 */
test('16 — DO per-team scores are bounded by the question’s value', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'do — scenario 16')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addDo(
    db,
    roundId,
    'Rate their karaoke',
    { scoringMode: 'PER_TEAM_SCORE' },
    { points: 10 },
  )
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  const phones = await threePhones(browser, game.code)

  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)
  await advance(master.page, c.question.close)
  await expect(master.page.getByRole('heading', { name: c.do.scoreEach })).toBeVisible()

  // One input per team, `aria-label`led with the team's name — which is also what keeps two
  // same-named teams (D19) addressable, since a name is never an identifier (CLAUDE.md §2.7).
  await master.page.getByLabel(TEAMS[0]!).fill('7')
  await master.page.getByLabel(TEAMS[1]!).fill('0')
  // Over the maximum. This must not become 500 points.
  await master.page.getByLabel(TEAMS[2]!).fill('500')

  await master.page.getByRole('button', { name: c.do.save, exact: true }).click()

  await expect(railRow(master.page, TEAMS[0]!)).toContainText('7')
  await expect(railRow(master.page, TEAMS[1]!)).toContainText('0')
  // Clamped to the question's own value, never past it (D24).
  await expect(railRow(master.page, TEAMS[2]!)).toContainText('10')

  await Promise.all([
    ...phones.map((phone) => phone.context.close()),
    master.context.close(),
  ])
})

/**
 * Scenario 16b — *the per-team desk holds while anyone is still blank, and yields when the last
 * team is scored.*
 *
 * Slice 9's review finding, at the surface: a partial save used to leave the master stranded on
 * a finished scoring view with no route onward but the timeline strip. D24's empty-vs-zero
 * distinction is what makes the hold honest — a blank box means "not judged yet", an entered `0`
 * resolves that team — so this drives exactly that: save one team of three, confirm the desk is
 * still the scoring desk, then complete it and confirm `[Next question]` arrives.
 */
test('16b — a partial PER_TEAM_SCORE save holds the desk until every team is scored', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'do — scenario 16b')
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addDo(
    db,
    roundId,
    'Rate their karaoke',
    { scoringMode: 'PER_TEAM_SCORE' },
    { points: 10 },
  )
  addFreeText(db, roundId, 'Capital of France?', ['paris'], { points: 10 })
  const game = createGame(db, quizId, TEAMS)

  const master = await openControl(browser)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)
  await advance(master.page, c.question.close)
  await expect(master.page.getByRole('heading', { name: c.do.scoreEach })).toBeVisible()

  // One team of three. The save lands (their rail total moves)…
  await master.page.getByLabel(TEAMS[0]!).fill('7')
  await master.page.getByRole('button', { name: c.do.save, exact: true }).click()
  await expect(railRow(master.page, TEAMS[0]!)).toContainText('7')

  // …but two teams are still blank, so the desk persists rather than stranding the master.
  await expect(master.page.getByRole('heading', { name: c.do.scoreEach })).toBeVisible()

  // Completing the coverage closes the question with the same save.
  await master.page.getByLabel(TEAMS[1]!).fill('0')
  await master.page.getByLabel(TEAMS[2]!).fill('4')
  await master.page.getByRole('button', { name: c.do.save, exact: true }).click()

  // The yield: the scoring desk gives way to the advance suggestion, which opens the round's
  // remaining question directly.
  await advance(master.page, c.question.next)
  await expect(
    master.page.getByRole('heading', { name: 'Capital of France?' }),
  ).toBeVisible()

  await master.context.close()
})
