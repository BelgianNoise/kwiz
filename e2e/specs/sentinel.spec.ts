import { expect, test, type Page } from '@playwright/test'

import { testDb } from '../support/db'
import {
  advance,
  en,
  fill,
  joinAs,
  judge,
  openScreenFor,
  startFirstQuestion,
} from '../support/flows'
import { appendEvents, createGame, gameContent } from '../support/game'
import {
  addFinaleRound,
  addFreeText,
  addJeopardyRound,
  setMasterNotes,
  newQuestionSetRound,
  newQuiz,
  setPrompt,
} from '../support/quiz'
import { openControl, openPlayer, openScreen } from '../support/surfaces'

/**
 * Build-order slice 9, **scenario 21** — the network-level sentinel assertion.
 *
 * The unit test (protocol §6.2) proves the payload filters are correct. This one proves **the
 * filters are the thing being used**: every byte the player devices and the projector actually
 * receive — SSE frames, JSON responses, rendered DOM — is collected across a full question's
 * states and searched for the secrets. A filter that is correct but bypassed by some route fails
 * here and only here.
 *
 * The secrets are distinctive strings seeded through fixtures; the complement is asserted too, so
 * the test cannot be satisfied by a filter that returns nothing.
 */

const c = en.control

/** Distinctive enough that a substring match anywhere is a leak, never a coincidence. */
const SECRET = {
  correctAnswer: 'ZZ_SECRET_CORRECT_ANSWER_ZZ',
  masterNotes: 'ZZ_SECRET_MASTER_NOTES_ZZ',
  teamBAnswer: 'ZZ_SECRET_TEAM_B_ANSWER_ZZ',
  unopenedTile: 'ZZ_SECRET_UNOPENED_TILE_PROMPT_ZZ',
  keywordHidden: 'ZZ_SECRET_UNMARKED_KEYWORD_ZZ',
  keywordSibling: 'plain keyword five',
} as const

/**
 * Listens on a page for every channel state reaches it through: `EventSource` frames and JSON
 * fetch bodies. DOM snapshots are pushed explicitly at each checkpoint, where "what was on
 * screen" is part of the claim.
 */
async function installWireTap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const kwizWireTap: string[] = []
    ;(window as unknown as { kwizWireTap: string[] }).kwizWireTap = kwizWireTap

    // Subclass rather than monkey-patch a wrapper object: `new` keeps working, and every other
    // EventSource behaviour (reconnect, Last-Event-ID) is inherited untouched.
    //
    // The protocol's frames are **named** events (`state` and `notice`), so listening for the
    // default `message` event would capture nothing — which is exactly the kind of silent
    // blind spot this spec exists to make impossible in the filter, and therefore cannot
    // tolerate in itself.
    class TappedEventSource extends EventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        for (const type of ['state', 'notice', 'message']) {
          this.addEventListener(type, (event) => {
            const data = 'data' in event ? String(event.data) : ''
            if (data) kwizWireTap.push('SSE:' + type + ':' + data)
          })
        }
      }
    }
    window.EventSource = TappedEventSource

    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      try {
        const type = response.headers.get('content-type') ?? ''
        if (type.includes('json')) {
          kwizWireTap.push('REST:' + (await response.clone().text()))
        }
      } catch {
        // A body that cannot be cloned cannot leak through this tap either.
      }
      return response
    }
  })
}

/** Everything this page has received so far, frames and snapshots alike. */
async function wireSoFar(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { kwizWireTap: string[] }).kwizWireTap.join('\n'),
  )
}

/** Adds the current DOM to the wire, because the rendered page is also a response body. */
async function snapshot(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { kwizWireTap: string[] }).kwizWireTap.push(
      'DOM:' + document.body.innerHTML,
    )
  })
}

test('21 — nothing secret crosses the wire to a player or the room, in any state', async ({
  browser,
}) => {
  test.setTimeout(240_000)

  const db = testDb()
  const quizId = newQuiz(db, 'sentinel — scenario 21')

  // Round one: one free-text question carrying three of the secrets.
  const qsRound = newQuestionSetRound(db, quizId, 'Round one')
  const freeText = addFreeText(
    db,
    qsRound,
    'The free-text question?',
    [SECRET.correctAnswer],
    { points: 10 },
  )
  setMasterNotes(db, freeText, SECRET.masterNotes)

  // A Jeopardy round with two tiles: the 200 carries the sealed prompt and its round is never
  // opened at all — the strongest form of "unopened" (the room never sees either prompt).
  const board = addJeopardyRound(db, quizId, 'Board', ['Cat One'], [100, 200])
  setPrompt(db, board.tiles[1]!.questionId, SECRET.unopenedTile)

  // A finale whose first keyword is the secret; its siblings stay plain.
  addFinaleRound(db, quizId, 'Finale', 'The finale?', [
    SECRET.keywordHidden,
    'plain keyword two',
    'plain keyword three',
    'plain keyword four',
    SECRET.keywordSibling,
  ])

  const game = createGame(db, quizId, ['Team A', 'Team B'], {
    // Small distinct banks (6 s / 3 s at 1 point per second), so the finale turn has an
    // unambiguous fewest-seconds starter and nobody is eliminated at once (D56).
    finale: { secondsPerPoint: 1, penaltySeconds: 2 },
  })
  // The game copy mints fresh round ids (I16), so the master action later targets the *game's*
  // finale round resolved from the copy tree — never a template id from the fixture calls.
  const content = gameContent(db, game.gameId)
  const finaleRoundId = content.rounds.at(-1)!.id
  appendEvents(
    db,
    game.gameId,
    [6, 3].map((delta, index) => ({
      type: 'SCORE_ADJUSTED' as const,
      payload: {
        // Namespaced by `game.gameId` for the same reason jeopardy.spec.ts's own seed is: a
        // Playwright retry re-runs this test against a *new* game with the *same* literal, and
        // `game_score_adjustment.id` is a bare global primary key.
        adjustmentId: `${game.gameId}-sentinel-${index}`,
        teamId: game.teamIds[index]!,
        delta,
        announced: false,
      },
    })),
  )

  // ── four surfaces; the room's two audiences are tapped ──
  const master = await openControl(browser)
  const screen = await openScreen(browser)
  const phoneA = await openPlayer(browser)
  const phoneB = await openPlayer(browser)
  for (const tapped of [screen.page, phoneA.page, phoneB.page]) {
    await installWireTap(tapped)
  }

  await joinAs(phoneA.page, game.code, 'Team A')
  await joinAs(phoneB.page, game.code, 'Team B')
  await openScreenFor(screen.page, game.gameId)
  await master.page.goto(`/en/control/${game.gameId}`)
  await startFirstQuestion(master.page)

  // ── OPEN ──
  await phoneA.page.getByLabel(en.player.game.yourAnswer).fill('an ordinary answer')
  await phoneA.page.getByRole('button', { name: en.player.game.submit }).click()
  await expect(phoneA.page.getByText(en.player.game.lockedIn)).toBeVisible()
  await phoneB.page.getByLabel(en.player.game.yourAnswer).fill(SECRET.teamBAnswer)
  await phoneB.page.getByRole('button', { name: en.player.game.submit }).click()
  const openScreenWire = await wireSoFar(screen.page)
  const openPhoneWire = await wireSoFar(phoneA.page)

  // Both verdicts given inline (D42) — otherwise the round-end sweep would hold the desk and
  // there would be no "Start the next round" to press.
  await judge(master.page, 'Team A', 'accept')
  await judge(master.page, 'Team B', 'accept')

  // ── LOCKED ──
  await advance(master.page, c.question.close)
  const lockedScreenWire = await wireSoFar(screen.page)
  const lockedPhoneWire = await wireSoFar(phoneA.page)
  await snapshot(screen.page)
  await snapshot(phoneA.page)

  // ── REVEALED ──
  await advance(master.page, c.question.reveal)
  await expect(screen.page.getByText(SECRET.correctAnswer)).toBeVisible()
  await snapshot(screen.page)
  await snapshot(phoneA.page)

  // ── SCORED → straight into the finale, unmarked ──
  await advance(master.page, c.question.score)
  /*
   * The board round is **never opened** — that is the strongest form of the sealed-tile claim:
   * its prompts exist only in master-only payloads for the whole run. (A real evening would
   * eventually expose every tile it plays, which is why the sealed tile here lives in a round
   * this journey skips entirely.) Opening a specific round is a master action like any other,
   * so the harness posts it directly rather than driving desk buttons that do not exist for
   * "skip ahead three rounds".
   */
  const opened = await master.page.request.post(
    `/api/games/${game.gameId}/rounds/${finaleRoundId}/open`,
    { data: {} },
  )
  if (!opened.ok()) {
    throw new Error(`round open refused: ${opened.status()} ${await opened.text()}`)
  }
  await advance(master.page, c.finale.start)
  await advance(master.page, c.question.openNext)
  await master.page
    .getByRole('button', { name: fill(c.finale.startTurn, { team: 'Team B' }) })
    .click()
  await expect(screen.page.getByLabel('hidden keyword')).toHaveCount(5)
  const preMarkPhone = await wireSoFar(phoneA.page)
  const preMarkScreen = await wireSoFar(screen.page)
  for (const tapped of [screen.page, phoneA.page, phoneB.page]) await snapshot(tapped)

  // ── MARKED: one keyword becomes public; its siblings must not ──
  await master.page
    .getByRole('button', { name: c.finale.mark, exact: true })
    .first()
    .click()
  await expect(screen.page.getByText(SECRET.keywordHidden)).toBeVisible()
  // The phone lags the screen by one push; gate on its DOM before reading its wire.
  await expect(phoneA.page.getByText(SECRET.keywordHidden)).toBeVisible({
    timeout: 15_000,
  })
  const postMarkScreen = await wireSoFar(screen.page)
  const postMarkPhone = await wireSoFar(phoneA.page)
  for (const tapped of [screen.page, phoneA.page, phoneB.page]) await snapshot(tapped)

  // ══ the assertions ══

  // Master notes never reach either audience — through any channel, at any instant.
  for (const wire of [
    openScreenWire,
    openPhoneWire,
    lockedScreenWire,
    lockedPhoneWire,
    preMarkScreen,
    preMarkPhone,
    postMarkScreen,
    postMarkPhone,
  ]) {
    expect(wire).not.toContain(SECRET.masterNotes)
  }

  // The correct answer is absent before the reveal…
  for (const wire of [openScreenWire, openPhoneWire, lockedScreenWire, lockedPhoneWire]) {
    expect(wire).not.toContain(SECRET.correctAnswer)
  }
  // …and present afterwards, on both audiences — an allowlist, not a void.
  expect(postMarkScreen).toContain(SECRET.correctAnswer)
  expect(postMarkPhone).toContain(SECRET.correctAnswer)

  // Team B's answer never reaches the other team's phone, nor the room (nothing was spotlit).
  expect(openPhoneWire).not.toContain(SECRET.teamBAnswer)
  expect(postMarkScreen).not.toContain(SECRET.teamBAnswer)

  // The unopened tile's prompt stayed sealed for the whole run.
  expect(postMarkScreen).not.toContain(SECRET.unopenedTile)
  expect(postMarkPhone).not.toContain(SECRET.unopenedTile)

  // The unmarked keyword is absent until its mark makes it public — siblings stay hidden.
  expect(preMarkScreen).not.toContain(SECRET.keywordHidden)
  expect(preMarkPhone).not.toContain(SECRET.keywordHidden)
  expect(postMarkPhone).toContain(SECRET.keywordHidden)
  expect(postMarkPhone).not.toContain(SECRET.keywordSibling)

  await Promise.all([
    master.context.close(),
    screen.context.close(),
    phoneA.context.close(),
    phoneB.context.close(),
  ])
})
