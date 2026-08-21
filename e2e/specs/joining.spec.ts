import { expect, test } from '@playwright/test'

import { testDb } from '../support/db'
import { en, fill, joinAs, startFirstQuestion } from '../support/flows'
import { createGame } from '../support/game'
import { addFreeText, newQuestionSetRound, newQuiz } from '../support/quiz'
import { openControl, openPlayer } from '../support/surfaces'

/**
 * Build-order slice 9, **Joining** — scenarios 5, 6 and 7.
 *
 * These three are the only ones in the suite where the player surface is the subject rather
 * than the instrument, so they are the ones that go through the landing page's code field by
 * hand instead of reaching for `joinAs`.
 */

const t = en.player

function fixture(label: string) {
  const db = testDb()
  const quizId = newQuiz(db, `joining — ${label}`)
  const roundId = newQuestionSetRound(db, quizId, 'Round one')
  addFreeText(db, roundId, 'Capital of France?', ['paris'])
  return createGame(db, quizId, ['The Quizzengers', 'Trivia Newton John'])
}

/**
 * Scenario 5 — *"Join by code and by the QR's URL; both land on the team picker."*
 *
 * The QR encodes the same `/play/<code>` URL the landing form navigates to, so the point is
 * that the **typed** route normalises its way to the identical screen. It earns a scenario
 * because the two paths have genuinely different code behind them: `normaliseCode`
 * (conventions §2's Crockford mapping) on one side and nothing at all on the other.
 */
test('5 — the typed code and the QR URL reach one team picker', async ({ browser }) => {
  const game = fixture('scenario 5')
  const typed = await openPlayer(browser)

  await typed.page.goto('/en')
  // Lower-cased on purpose: this is what someone squinting at a projector actually types.
  await typed.page.getByLabel(en.landing.playing.codeLabel).fill(game.code.toLowerCase())
  await typed.page
    .getByRole('button', { name: en.landing.playing.join, exact: true })
    .click()

  await expect(typed.page).toHaveURL(new RegExp(`/play/${game.code}$`))
  await expect(typed.page.getByRole('heading', { name: t.join.whichTeam })).toBeVisible()
  await expect(typed.page.getByRole('button', { name: 'The Quizzengers' })).toBeEnabled()

  // The QR's route, in a context of its own so the first visit cannot have left a token.
  const scanned = await openPlayer(browser)
  await scanned.page.goto(`/en/play/${game.code}`)
  await expect(
    scanned.page.getByRole('heading', { name: t.join.whichTeam }),
  ).toBeVisible()
  await expect(
    scanned.page.getByRole('button', { name: 'The Quizzengers' }),
  ).toBeEnabled()

  await scanned.context.close()
  await typed.context.close()
})

/**
 * Scenario 6 — *"Team at `KWIZ_MAX_DEVICES_PER_TEAM` shows full and offers the other teams."*
 *
 * The cap is 3 for this suite (`playwright.config.ts`), spelled out there rather than
 * inherited so this reads as testing D20's rule rather than a default that happens to match.
 * **The full team stays on the list, with its reason** — hiding it is what makes a guest
 * believe they scanned the wrong code.
 */
test('6 — a full team says so and the others stay tappable', async ({ browser }) => {
  const game = fixture('scenario 6')
  const filling = []

  for (let i = 0; i < 3; i++) {
    // Sequential on purpose: each join must land before the next reads the count it produced.
    // oxlint-disable-next-line no-await-in-loop
    const device = await openPlayer(browser)
    filling.push(device.context)
    // oxlint-disable-next-line no-await-in-loop
    await joinAs(device.page, game.code, 'The Quizzengers')
  }

  const fourth = await openPlayer(browser)
  await fourth.page.goto(`/en/play/${game.code}`)

  const full = fourth.page.getByRole('button', { name: /The Quizzengers/ })
  await expect(full).toContainText(fill(t.join.alreadyHas, { count: 3 }))
  await expect(full).toBeDisabled()

  // The whole point of showing it rather than hiding it: the other row still works.
  await expect(
    fourth.page.getByRole('button', { name: 'Trivia Newton John' }),
  ).toBeEnabled()
  await joinAs(fourth.page, game.code, 'Trivia Newton John')

  await fourth.context.close()
  await Promise.all(filling.map((context) => context.close()))
})

/**
 * Scenario 7 — *"Device token resume: reload the tab mid-game and land back in the same
 * state."*
 *
 * Mid-game matters. A reload on the waiting screen would pass even if the token were re-minted
 * on every visit; a reload with a question already answered only passes if the *same* device
 * came back to the *same* team, because the submitted answer is what proves it — under D43
 * nobody else could have submitted for that team and had it stick.
 */
test('7 — a reload mid-question resumes the same device on the same team', async ({
  browser,
}) => {
  const game = fixture('scenario 7')
  const master = await openControl(browser)
  const player = await openPlayer(browser)

  await joinAs(player.page, game.code, 'The Quizzengers')
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  await player.page.getByLabel(t.game.yourAnswer).fill('paris')
  await player.page.getByRole('button', { name: t.game.submit, exact: true }).click()
  await expect(player.page.getByText(t.game.lockedIn)).toBeVisible()

  // The reload. Nothing is re-entered: no code, no team, no answer.
  await player.page.reload()

  await expect(player.page).toHaveURL(new RegExp(`/play/${game.code}/game$`))
  await expect(player.page.getByText(t.game.lockedIn)).toBeVisible()
  await expect(player.page.getByText('paris')).toBeVisible()

  await player.context.close()
  await master.context.close()
})
