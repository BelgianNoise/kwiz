import { expect, test } from '@playwright/test'

import { testDb } from '../support/db'
import { advance, en, fill, joinAs, startGame } from '../support/flows'
import { appendEvents, createGame } from '../support/game'
import { addJeopardyRound, newQuiz } from '../support/quiz'
import { openControl, openPlayer } from '../support/surfaces'

/**
 * Build-order slice 9, **Jeopardy** — scenario 17.
 *
 * *"Turn order: lowest score picks first; correct answerer picks next; nobody correct falls back
 * to lowest (D30). Used tiles show as spent."*
 *
 * The three pickers are chosen so the rules cannot be confused with each other: the first picker
 * is the lowest score, the second is the **highest** score (they answered correctly, which is why
 * they pick — not because they lead), and the third falls back to the lowest again once nobody
 * was credited. One fixture, three different reasons for the name at the top of the board.
 */

const c = en.control
const TEAMS = ['The Quizzengers', 'Trivia Newton John', 'Quizteama Aguilera']

test('17 — the pick follows the room: lowest first, winner next, lowest again', async ({
  browser,
}) => {
  const db = testDb()
  const quizId = newQuiz(db, 'jeopardy — scenario 17')
  addJeopardyRound(db, quizId, 'Board', ['Geo', 'Film'], [100, 200])
  const game = createGame(db, quizId, TEAMS)

  // Distinct starting scores, so "lowest" is one team and never a tie-break (D30's tie is the
  // BREAK_TIE_FOR_PICK desk, which is its own screen and not this journey).
  const scores = [30, 20, 10]
  appendEvents(
    db,
    game.gameId,
    scores.map((delta, index) => ({
      type: 'SCORE_ADJUSTED' as const,
      payload: {
        adjustmentId: `seed-${index}`,
        teamId: game.teamIds[index]!,
        delta,
        announced: false,
      },
    })),
  )

  // One phone: the Quizzengers', who will take the first tile's buzz.
  const master = await openControl(browser)
  const alpha = await openPlayer(browser)
  await joinAs(alpha.page, game.code, TEAMS[0]!)

  await master.page.goto(`/en/control/${game.gameId}`)
  await startGame(master.page)
  await advance(master.page, c.question.nextRound)

  // Lowest score picks first.
  await expect(
    master.page.getByRole('heading', {
      name: fill(c.jeopardy.picks, { team: TEAMS[2]! }),
    }),
  ).toBeVisible()

  // The master opens the tile their picker's team calls.
  await tile(master.page, 0, 100).click()

  // Alpha gets there first, and is accepted.
  await alpha.page.getByRole('button', { name: en.player.buzzer.buzz }).click()
  await expect(alpha.page.getByText(en.player.buzzer.youreIn)).toBeVisible()
  await master.page.getByRole('button', { name: new RegExp(c.buzz.correct) }).click()

  // The ordinary closing sequence — the question stays open past adjudication (D35), so locking
  // it is the master's act, exactly as on any other buzzer question.
  await advance(master.page, c.question.close)
  await advance(master.page, c.question.reveal)
  await advance(master.page, c.question.score)

  /*
   * **The desk hands back to the board**, and the pick has moved to whoever answered correctly —
   * who is deliberately the *highest* scorer here, so "winner picks next" cannot pass for "leader
   * picks next".
   */
  await expect(
    master.page.getByRole('heading', {
      name: fill(c.jeopardy.picks, { team: TEAMS[0]! }),
    }),
  ).toBeVisible()
  await expect(spentTile(master.page, 0)).toBeVisible()
  await expect(spentTile(master.page, 0)).toBeDisabled()

  // Second tile: nobody buzzes at all.
  await tile(master.page, 1, 100).click()
  await advance(master.page, c.question.close)
  await advance(master.page, c.question.reveal)
  await advance(master.page, c.question.score)

  // Nobody was credited, so the pick falls back to the lowest score — where it started.
  await expect(
    master.page.getByRole('heading', {
      name: fill(c.jeopardy.picks, { team: TEAMS[2]! }),
    }),
  ).toBeVisible()
  await expect(spentTile(master.page, 1)).toBeVisible()

  // Both spent tiles read as spent; the two unplayed 200s are still live numbers.
  await expect(tile(master.page, 0, 200)).toContainText('200')
  await expect(tile(master.page, 1, 200)).toContainText('200')

  await alpha.context.close()
  await master.context.close()
})

/**
 * A tile on the control board. The board renders one `list` per category, left to right in
 * authored order (§9), so a tile is its column plus its value — the two facts a room reads.
 */
function tile(page: import('@playwright/test').Page, column: number, points: number) {
  return page
    .getByRole('main')
    .getByRole('list')
    .nth(column)
    .getByRole('button', { name: new RegExp(`^${points}`) })
}

/**
 * A spent tile reads `played`, not its value — the desk's own form of the room's ✓ (§9). It can
 * therefore no longer be found by its points, which is why it gets its own locator.
 */
function spentTile(page: import('@playwright/test').Page, column: number) {
  return page
    .getByRole('main')
    .getByRole('list')
    .nth(column)
    .getByRole('button', { name: c.jeopardy.played })
}
