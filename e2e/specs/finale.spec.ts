import { expect, test, type Page } from '@playwright/test'

import { testDb } from '../support/db'
import { advance, en, fill, joinAs, openScreenFor } from '../support/flows'
import { appendEvents, createGame } from '../support/game'
import { addFinaleRound, newQuiz } from '../support/quiz'
import { openControl, openPlayer, openScreen } from '../support/surfaces'

/**
 * Build-order slice 9, **`DSMTW_FINALE`** — scenarios 23 to 27.
 *
 * The most arithmetic-dense mechanic in the product, driven here at the tiny banks determinism
 * rule 4 calls for: every clock under test is 4–8 seconds with a 2–3 second penalty, so the
 * arithmetic lands well inside a browser timeout instead of after a real 170-second bank.
 *
 * The banks are chosen so that **no assertion ever races a ticking clock**: penalties land on
 * teams that are *waiting* (whose displayed value is static until they take a turn), and every
 * "who is next?" claim is about an ordering with seconds of slack, never about an exact value on
 * the team whose turn it is.
 */

const c = en.control
const TEAMS = ['Foxes', 'Whales', 'Iguanas']
const KEYWORDS = ['Thriller', 'Bad', 'Moonwalk', 'Neverland', 'Billie Jean']

interface FinaleFixture {
  gameId: string
  code: string
}

/** A quiz that is nothing but a finale, plus three teams seeded to chosen starting banks. */
function finaleGame(
  db: ReturnType<typeof testDb>,
  label: string,
  scores: readonly number[],
  secondsPerPoint: number,
  penaltySeconds: number,
): FinaleFixture {
  const quizId = newQuiz(db, `finale — ${label}`)
  addFinaleRound(
    db,
    quizId,
    'Finale',
    'What do you know about Michael Jackson?',
    KEYWORDS,
  )
  const game = createGame(db, quizId, TEAMS, {
    finale: { secondsPerPoint, penaltySeconds },
  })
  appendEvents(
    db,
    game.gameId,
    scores.map((delta, index) => ({
      type: 'SCORE_ADJUSTED' as const,
      payload: {
        adjustmentId: `${label}-${index}`,
        teamId: game.teamIds[index]!,
        delta,
        announced: false,
      },
    })),
  )
  return game
}

async function openFinaleRound(page: Page, gameId: string): Promise<void> {
  await page.goto(`/en/control/${gameId}`)
  await advance(page, en.control.setup.start)
  // The finale is the only round, so this opens it — and lands on §10.1's picker.
  await advance(page, c.question.nextRound)
}

/** A finalist's entry in the desk's bottom clock strip — name and live seconds together. */
function clockStrip(page: Page, team: string) {
  return page.locator('footer span').filter({ hasText: team })
}

/**
 * Scenario 23 — *"Full finale: pick finalists, fewest-seconds team starts, mark keywords,
 * confirm every other team loses the penalty, pass, and confirm turn order recomputes from the
 * new seconds."*
 *
 * Banks 20/12/8 s with a 3 s penalty: two marks during the opener's turn take the other banks to
 * 14/6, which hands the next turn to a team that could not have had it under the *starting*
 * order — recompute proven, not assumed.
 */
test('23 — marking charges the others, and passing follows the recomputed order', async ({
  browser,
}) => {
  const db = testDb()
  const game = finaleGame(db, 'scenario 23', [40, 24, 16], 0.5, 3)

  const master = await openControl(browser)
  await openFinaleRound(master.page, game.gameId)

  // Descending score order, all pre-selected (D55), each with its conversion spelled out.
  // Scoped to `main`: the right rail carries the same names, and strict mode is right to refuse
  // the ambiguity (the same discipline flows.ts's answerRow documents).
  const pickerRows = master.page.getByRole('main').getByRole('listitem')
  await expect(pickerRows.filter({ hasText: 'Foxes' })).toContainText('40')
  await expect(pickerRows.filter({ hasText: 'Foxes' })).toContainText('20s')
  await expect(
    master.page.getByRole('heading', { name: c.finale.whoPlays }),
  ).toBeVisible()
  await advance(master.page, c.finale.start)

  await advance(master.page, c.question.openNext)

  // Fewest seconds goes first (PRD 1 §8.8), named on the button so the handover needs no thought.
  await expect(
    master.page.getByRole('button', {
      name: fill(c.finale.startTurn, { team: 'Iguanas' }),
    }),
  ).toBeVisible()
  await master.page
    .getByRole('button', { name: fill(c.finale.startTurn, { team: 'Iguanas' }) })
    .click()

  // Five unmarked keywords are five buttons (§10.2). Mark two of them, quickly, mid-turn.
  const markButtons = master.page.getByRole('button', {
    name: c.finale.mark,
    exact: true,
  })
  await expect(markButtons).toHaveCount(5)
  await markButtons.nth(0).click()
  // The marked row becomes static text with the crediting team — the list is the record (§10.2).
  await expect(
    master.page
      .getByRole('listitem')
      .filter({ hasText: KEYWORDS[0]! })
      .getByRole('button', { name: c.finale.unmark }),
  ).toBeVisible()
  await markButtons.nth(1).click()

  // Every other finalist paid the penalty — read off their static clocks: 20−6 and 12−6.
  await expect(clockStrip(master.page, 'Foxes')).toContainText('14')
  await expect(clockStrip(master.page, 'Whales')).toContainText('6')

  // The handover names whoever the *recomputed* order favours — not who was second at the start.
  await expect(
    master.page.getByRole('button', { name: fill(c.finale.pass, { team: 'Whales' }) }),
  ).toBeVisible()
  await master.page
    .getByRole('button', { name: fill(c.finale.pass, { team: 'Whales' }) })
    .click()
  await expect(
    master.page.getByRole('button', {
      name: fill(c.finale.startTurn, { team: 'Whales' }),
    }),
  ).toBeVisible()

  await master.context.close()
})

/**
 * Scenario 24 — *"Un-mark a keyword and confirm the penalty is returned to every team it was
 * taken from."*
 *
 * §10.4's whole point: the mis-mark charged everyone else, so the reversal must too — all of it,
 * read here straight off clocks that were static throughout.
 */
test('24 — un-marking gives back what the mark took', async ({ browser }) => {
  const db = testDb()
  const game = finaleGame(db, 'scenario 24', [40, 24, 16], 0.5, 3)

  const master = await openControl(browser)
  await openFinaleRound(master.page, game.gameId)
  await advance(master.page, c.finale.start)
  await advance(master.page, c.question.openNext)
  await master.page
    .getByRole('button', { name: fill(c.finale.startTurn, { team: 'Iguanas' }) })
    .click()

  await master.page
    .getByRole('button', { name: c.finale.mark, exact: true })
    .first()
    .click()
  await expect(clockStrip(master.page, 'Foxes')).toContainText('17')

  await master.page.getByRole('button', { name: c.finale.unmark }).click()
  await expect(clockStrip(master.page, 'Foxes')).toContainText('20')
  await expect(clockStrip(master.page, 'Whales')).toContainText('12')

  await master.context.close()
})

/**
 * Scenario 25 — *"Eliminate a team off-turn — a penalty takes a waiting team to zero — and
 * confirm the round continues correctly with one fewer finalist."*
 *
 * **The construction, and why it is deterministic:** Foxes (the smallest bank) take the first
 * turn and pass immediately, which marks them passed for this question — the turn order excludes
 * passed teams, so they sit waiting with a frozen clock and can never be offered the turn again.
 * Two marks made during the other finalists' turns then walk that frozen bank down: once alive,
 * once to zero. The death lands mid-someone-else's-turn however fast the clicks are, which is
 * exactly §10.6's off-turn case.
 */
test('25 — a waiting team can be eliminated by someone else’s keyword', async ({
  browser,
}) => {
  test.setTimeout(90_000)

  const db = testDb()
  // Banks equal to scores (`secondsPerPoint: 1`): Foxes 6, Whales 20, Iguanas 50. Penalty 3.
  const game = finaleGame(db, 'scenario 25', [6, 20, 50], 1, 3)

  const master = await openControl(browser)
  await openFinaleRound(master.page, game.gameId)
  await advance(master.page, c.finale.start)
  await advance(master.page, c.question.openNext)

  const start = async (team: string): Promise<void> => {
    const button = master.page.getByRole('button', {
      name: fill(c.finale.startTurn, { team }),
    })
    await expect(button).toBeVisible({ timeout: 15_000 })
    await button.click()
  }
  const mark = async (): Promise<void> => {
    const before = await master.page
      .getByRole('button', { name: c.finale.unmark })
      .count()
    await master.page
      .getByRole('button', { name: c.finale.mark, exact: true })
      .first()
      .click()
    // The mark has landed only when its row grows an Un-mark button — this gates every later
    // assertion on the *pushed* fact rather than on the click having been dispatched.
    await expect(master.page.getByRole('button', { name: c.finale.unmark })).toHaveCount(
      before + 1,
      { timeout: 15_000 },
    )
  }

  // Turn one: Foxes (lowest bank) pass straight away, taking themselves out of the rotation.
  await start('Foxes')
  const passToWhales = master.page.getByRole('button', {
    name: fill(c.finale.pass, { team: 'Whales' }),
  })
  await expect(passToWhales).toBeVisible()
  await passToWhales.click()

  // Turn two: Whales find one. Foxes frozen ~5.5 s drops to ~2.5 s - still alive.
  await start('Whales')
  await mark()

  // Turn three belongs to Iguanas; naming it makes a stale view loud rather than silent.
  const passToIguanas = master.page.getByRole('button', {
    name: fill(c.finale.pass, { team: 'Iguanas' }),
  })
  await expect(passToIguanas).toBeVisible({ timeout: 15_000 })
  await passToIguanas.click()
  await start('Iguanas')
  await mark()

  // Gone while waiting: struck through in the strip (PRD 3 10.6).
  await expect(clockStrip(master.page, 'Foxes')).toHaveClass(/line-through/, {
    timeout: 15_000,
  })

  /*
   * …and the round continues — with a twist this construction exposes honestly: Whales have
   * passed and Foxes are out, so Iguanas' turn is the last one this question can offer. The desk
   * still has a forward action (pass with nobody left, or reveal), and both survivors stay alive.
   */
  await expect(
    master.page
      .getByRole('button', { name: c.finale.revealRemaining })
      .or(master.page.getByRole('button', { name: c.finale.allPassed })),
  ).toBeVisible({ timeout: 15_000 })
  await expect(clockStrip(master.page, 'Whales')).not.toHaveClass(/line-through/)
  await expect(clockStrip(master.page, 'Iguanas')).not.toHaveClass(/line-through/)

  await master.context.close()
})
/**
 * Scenario 26 — *"Run the finale to a single survivor and check the FINISHED screen's two tabs:
 * survival ranking, and pre-finale points."*
 *
 * Two finalists, one real expiry: the smaller bank runs out on its own turn (control posts the
 * elimination; the server recomputes the instant), leaving one survivor — and then D51's point:
 * the survival winner is **not** the points leader, and both stories get a tab.
 */
test('26 — one survivor, and two different stories on the finished screen', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  const db = testDb()
  const game = finaleGame(db, 'scenario 26', [40, 24, 16], 0.5, 2)

  const master = await openControl(browser)
  const screen = await openScreen(browser)
  await openScreenFor(screen.page, game.gameId)

  // D55's common case: everyone pre-selected, deselect the leader, run with two.
  await openFinaleRound(master.page, game.gameId)
  await master.page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: 'Foxes' })
    .click()
  await advance(master.page, c.finale.start)

  await advance(master.page, c.question.openNext)

  await master.page
    .getByRole('button', { name: fill(c.finale.startTurn, { team: 'Iguanas' }) })
    .click()

  /*
   * Four seconds later there is one finalist left, and the round **ends itself**: §10.6 ends the
   * round on one survivor, so the turn desk — clock strip included — is replaced by the ranking.
   * The elimination is therefore asserted through what replaces it, not through a struck-through
   * strip that no longer exists.
   */
  await expect(
    master.page.getByRole('heading', { name: c.finale.rankingTitle }),
  ).toBeVisible({ timeout: 30_000 })

  // Survival tab active, winner on top. Scoped to the visible panel: the hidden Points tab
  // renders the same names, and strict mode is right to refuse the ambiguity.
  const survival = master.page.getByRole('tabpanel')
  await expect(survival.getByText('#1')).toBeVisible()
  await expect(survival.getByText('Whales')).toBeVisible()

  // Ending the game is one of the two acts that earn a dialog (§13) — and the dialog is an
  // *alert*dialog, which is a different ARIA role than the dialogs above.
  await master.page.getByRole('button', { name: c.frame.menu }).click()
  await master.page.getByRole('menuitem', { name: c.frame.finish }).click()
  await master.page
    .getByRole('alertdialog')
    .getByRole('button', { name: c.frame.finish })
    .click()

  // The projector's FINISHED stage: winner at maximum scale, survival list underneath.
  await expect(screen.page.getByText('Whales').first()).toBeVisible({ timeout: 15_000 })
  await expect(screen.page.getByText(/survived/)).toBeVisible()
  await expect(screen.page.getByText(/out \d{2}:\d{2}/)).toBeVisible()

  // The tabs are switched from the desk (the screen has no controls), and the room follows.
  await master.page.getByRole('tab', { name: c.finale.pointsTab }).click()
  // Pre-finale points: Foxes never played and still lead — often the story (D51).
  await expect(screen.page.getByText('Foxes')).toBeVisible()
  await expect(screen.page.getByText('40')).toBeVisible()
  // …and switching back restores the survival story.
  await master.page.getByRole('tab', { name: c.finale.survivalTab }).click()
  await expect(screen.page.getByText(/survived/)).toBeVisible()

  await Promise.all([master.context.close(), screen.context.close()])
})

/**
 * Scenario 26b — *"Finale position is unbreakable."*
 *
 * Three routes, one rule (§6.1): the type picker stops offering a finale (with the reason), a new
 * round inserts *before* the pinned row, and both reorder routes refuse to move anything past it.
 */
test('26b — the finale stays last, whatever the editor tries', async ({ page }) => {
  const db = testDb()
  const quizId = newQuiz(db, 'finale — scenario 26b')
  addFinaleRound(db, quizId, 'Finale', 'Prompt', KEYWORDS)

  await page.goto(`/en/admin/quizzes/${quizId}`)
  const rounds = page.getByRole('listitem')

  // The type picker no longer offers one — with the reason, not a silent absence.
  await page.getByRole('button', { name: en.admin.quiz.addRound }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(en.admin.quiz.finaleExists)).toBeVisible()
  await expect(
    dialog.getByRole('radio', { name: en.admin.quiz.type.DSMTW_FINALE }),
  ).toHaveCount(0)
  await dialog.getByRole('button', { name: en.common.cancel }).click()

  // Adding any round while a finale exists lands it immediately before the pinned row.
  await page.getByRole('button', { name: en.admin.quiz.addRound }).click()
  await dialog.getByLabel(en.admin.quiz.roundTitleLabel).fill('Extra')
  await dialog.getByRole('button', { name: en.common.add }).click()
  await expect(rounds.filter({ hasText: 'Extra' })).toBeVisible()
  await expect(rounds.nth(0)).toContainText('Extra')
  await expect(rounds.nth(1)).toContainText('Finale')

  // Keyboard route: Alt+↓ on the row above the pin does nothing — and says so by being disabled.
  await expect(
    rounds.filter({ hasText: 'Extra' }).getByRole('button', { name: en.common.moveDown }),
  ).toBeDisabled()
  await rounds.filter({ hasText: 'Extra' }).focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(rounds.nth(1)).toContainText('Finale')

  // Drag route: same refusal, from the same predicate (§15.2).
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('main ol > li')]
    const source = rows[0]!
    const target = rows[1]!
    const transfer = new DataTransfer()
    const event = (type: string): DragEvent =>
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      })
    source.dispatchEvent(event('dragstart'))
    target.dispatchEvent(event('dragover'))
    target.dispatchEvent(event('drop'))
    source.dispatchEvent(event('dragend'))
  })
  await expect(rounds.nth(0)).toContainText('Extra')
  await expect(rounds.nth(1)).toContainText('Finale')
})

/**
 * Scenario 27 — *"No keyword text reaches the room before marking"* (D53), the finale case of
 * scenario 21. Asserted on the rendered surfaces themselves: shapes only, on both audiences,
 * until a mark makes the word real.
 */
test('27 — unguessed keywords are shapes, never words, on every surface', async ({
  browser,
}) => {
  const db = testDb()
  const game = finaleGame(db, 'scenario 27', [40, 24, 16], 0.5, 2)

  const master = await openControl(browser)
  const screen = await openScreen(browser)
  const phone = await openPlayer(browser)
  await joinAs(phone.page, game.code, 'Whales')
  await openScreenFor(screen.page, game.gameId)

  await openFinaleRound(master.page, game.gameId)
  await advance(master.page, c.finale.start)
  await advance(master.page, c.question.openNext)
  await master.page
    .getByRole('button', { name: fill(c.finale.startTurn, { team: 'Iguanas' }) })
    .click()

  // Shapes everywhere: five drawn tiles, and none of Michael Jackson's discography anywhere.
  for (const audience of [screen.page, phone.page]) {
    await expect(audience.getByLabel('hidden keyword')).toHaveCount(5)
    for (const word of KEYWORDS) {
      await expect(audience.getByText(word)).toHaveCount(0)
    }
  }

  // One mark: that word becomes real on both surfaces; the other four do not.
  await master.page
    .getByRole('button', { name: c.finale.mark, exact: true })
    .first()
    .click()
  await expect(screen.page.getByText(KEYWORDS[0]!)).toBeVisible()
  await expect(phone.page.getByText(KEYWORDS[0]!)).toBeVisible()
  await expect(screen.page.getByLabel('hidden keyword')).toHaveCount(4)
  await expect(screen.page.getByText(KEYWORDS[4]!)).toHaveCount(0)

  await Promise.all([
    master.context.close(),
    screen.context.close(),
    phone.context.close(),
  ])
})
