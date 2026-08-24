import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { openDatabase } from '@kwiz/db'
import { expect, test } from '@playwright/test'

import { en } from '../support/flows'
import { createGame, gameContent } from '../support/game'
import { addFreeText, newQuestionSetRound, newQuiz } from '../support/quiz'
import { spawnKwizServer, type SpawnedServer } from '../support/spawn'

/**
 * Build-order slice 9, **scenario 22** — the two failures only this level can have.
 *
 * **Cross-game isolation** (D21): two live games on one server at once; nothing either audience
 * sees may belong to the other game. **Kill and restart mid-game** (D4, D38): every surface
 * reconnects and resumes the exact state it had, with no user action — the whole payoff of the
 * event log plus pushed views, provable in no smaller a test.
 *
 * It owns a server (`spawn.ts`), because killing the shared one would take every other worker's
 * test down with it.
 */

const PORT = 3921
const URL = `http://localhost:${PORT}`
const DATA_DIR = resolve('.playwright/data', `isolation-${process.pid}`)

test.setTimeout(180_000)

/** A POST that throws unless the server says `{ ok: true }` — setup has no UI to refuse in. */
async function post(path: string, body?: unknown): Promise<void> {
  const response = await fetch(`${URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const parsed: unknown = await response.json()
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('ok' in parsed) ||
    parsed.ok !== true
  ) {
    throw new Error(`setup call failed: ${path} → ${JSON.stringify(parsed)}`)
  }
}

test('22 — two games stay apart, and every surface survives losing the server', async ({
  browser,
}) => {
  mkdirSync(DATA_DIR, { recursive: true })
  let server: SpawnedServer | undefined
  let db: ReturnType<typeof openDatabase> | undefined

  try {
    server = spawnKwizServer({ port: PORT, dataDir: DATA_DIR })
    await server.waitReady()

    // ── two quizzes, two games, each with its own question to answer ──
    const fixtureDb = openDatabase(join(DATA_DIR, 'kwiz.db'))
    db = fixtureDb
    const buildOne = (prompt: string) => {
      const quizId = newQuiz(fixtureDb, prompt)
      const roundId = newQuestionSetRound(fixtureDb, quizId, 'Round one')
      addFreeText(fixtureDb, roundId, prompt, [prompt.toLowerCase()], { points: 10 })
      return { quizId, roundId }
    }

    const quiz1 = buildOne('Game one question?')
    const quiz2 = buildOne('Game two question?')
    const g1 = createGame(fixtureDb, quiz1.quizId, ['Xavier', 'Yusuf'])
    const g2 = createGame(fixtureDb, quiz2.quizId, ['Priya', 'Quentin'])
    const c1 = gameContent(db, g1.gameId)
    const c2 = gameContent(db, g2.gameId)

    for (const [game, content] of [
      [g1, c1],
      [g2, c2],
    ] as const) {
      await post(`/api/games/${game.gameId}/start`)
      await post(`/api/games/${game.gameId}/rounds/${content.rounds[0]!.id}/open`)
      await post(
        `/api/games/${game.gameId}/questions/${content.rounds[0]!.questions[0]!.id}/open`,
      )
    }

    // ── four surfaces live at once: two desks, one phone per game ──
    const master1 = await browser.newContext()
    const master2 = await browser.newContext()
    const phoneX = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    })
    const phoneP = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    })

    const p1 = await master1.newPage()
    const p2 = await master2.newPage()
    const px = await phoneX.newPage()
    const pp = await phoneP.newPage()

    await px.goto(`${URL}/en/play/${g1.code}`)
    await px.getByRole('button', { name: 'Xavier' }).click()
    await expect(px).toHaveURL(new RegExp(`/play/${g1.code}/game$`))
    await pp.goto(`${URL}/en/play/${g2.code}`)
    await pp.getByRole('button', { name: 'Priya' }).click()
    await expect(pp).toHaveURL(new RegExp(`/play/${g2.code}/game$`))

    await p1.goto(`${URL}/en/control/${g1.gameId}`)
    await p2.goto(`${URL}/en/control/${g2.gameId}`)

    const t = en.player.game
    const q1Prompt = 'Game one question?'
    const q2Prompt = 'Game two question?'

    // Both phones answer their own game's question.
    await px.getByLabel(t.yourAnswer).fill('answer one')
    await px.getByRole('button', { name: t.submit }).click()
    await expect(px.getByText(t.lockedIn)).toBeVisible()
    await pp.getByLabel(t.yourAnswer).fill('answer two')
    await pp.getByRole('button', { name: t.submit }).click()
    await expect(pp.getByText(t.lockedIn)).toBeVisible()

    // ══ isolation: nothing crosses between the two games ══
    await expect(p1.getByRole('heading', { name: q1Prompt })).toBeVisible()
    for (const stranger of [q2Prompt, 'Priya', 'Quentin']) {
      await expect(p1.getByText(stranger)).toHaveCount(0)
    }
    await expect(p2.getByRole('heading', { name: q2Prompt })).toBeVisible()
    for (const stranger of [q1Prompt, 'Xavier', 'Yusuf', 'answer one']) {
      await expect(p2.getByText(stranger)).toHaveCount(0)
    }
    await expect(px.getByText(q2Prompt)).toHaveCount(0)
    await expect(pp.getByText(q1Prompt)).toHaveCount(0)

    // ── kill the server mid-game, in front of everyone ──
    await server.stop()

    // ── restart on the same data directory ──
    server = spawnKwizServer({ port: PORT, dataDir: DATA_DIR })
    await server.waitReady()

    /*
     * **Nobody touches anything.** No reload, no rejoin, no navigation: the streams retry on
     * their own (D2), the registry replays both logs lazily, and the next pushed view is the
     * state that was lost (D38). That is the entire claim under test.
     */
    await expect(px.getByText(t.lockedIn)).toBeVisible({ timeout: 30_000 })
    await expect(px.getByText('answer one')).toBeVisible()
    await expect(pp.getByText(t.lockedIn)).toBeVisible({ timeout: 30_000 })
    await expect(p1.getByRole('heading', { name: q1Prompt })).toBeVisible({
      timeout: 30_000,
    })
    await expect(p2.getByRole('heading', { name: q2Prompt })).toBeVisible({
      timeout: 30_000,
    })

    // …and the isolation still holds after the restart, too.
    await expect(p1.getByText('Priya')).toHaveCount(0)
    await expect(p2.getByText('Xavier')).toHaveCount(0)

    for (const context of [master1, master2, phoneX, phoneP]) {
      await context.close()
    }
  } finally {
    db?.raw.close()
    await server?.stop().catch(() => undefined)
  }
})
