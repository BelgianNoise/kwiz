import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { openDatabase } from '@kwiz/db'
import { expect, test } from '@playwright/test'

import { en, pastFirstRun } from '../support/flows'
import { createGame, gameContent } from '../support/game'
import {
  addFreeText,
  addMultipleChoice,
  newQuestionSetRound,
  newQuiz,
} from '../support/quiz'
import { spawnKwizServer } from '../support/spawn'

/**
 * Build-order slice 9, **scenario 3**: *"Export with history → wipe the data dir → import →
 * quiz and game are identical."*
 *
 * It owns a server of its own (`spawn.ts`), because wiping a data directory mid-run would take
 * every other worker's test down with it. This is the one scenario allowed to be a whole evening
 * in miniature: author, play, archive, lose the machine, come back.
 */

const PORT = 3911
const URL = `http://localhost:${PORT}`
const DATA_DIR = resolve('.playwright/data', `portability-${process.pid}`)

test.setTimeout(180_000)

/** What the review returns, narrowed to the fields this scenario compares. */
interface ReviewSnapshot {
  quizName: string
  code: string
  teams: { name: string; score: number; colour: string }[]
  rounds: {
    title: string
    questions: {
      prompt: string
      correctAnswer: string | null
      cells: {
        teamIdIndex: number
        answer: string | null
        verdict: string
        points: number
      }[]
    }[]
  }[]
}

function snapshot(review: {
  quizName: string
  code: string
  teams: { name: string; score: number; colour: string; id: string }[]
  rounds: {
    title: string
    questions: {
      prompt: string
      correctAnswer: string | null
      cells: { teamId: string; answer: string | null; verdict: string; points: number }[]
    }[]
  }[]
}): ReviewSnapshot {
  const indexOf = new Map(review.teams.map((team, index) => [team.id, index]))
  return {
    quizName: review.quizName,
    // The code is part of what a master re-recognises — it is on every printed QR.
    code: review.code,
    teams: review.teams.map(({ name, score, colour }) => ({ name, score, colour })),
    rounds: review.rounds.map((round) => ({
      title: round.title,
      questions: round.questions.map((question) => ({
        prompt: question.prompt,
        correctAnswer: question.correctAnswer,
        cells: question.cells.map((cell) => ({
          teamIdIndex: indexOf.get(cell.teamId) ?? -1,
          answer: cell.answer,
          verdict: cell.verdict,
          points: cell.points,
        })),
      })),
    })),
  }
}

/** A POST that throws unless the server says `{ ok: true }` — setup has no UI to show a refusal in. */
async function post(path: string, body?: unknown, headers?: Record<string, string>) {
  const response = await fetch(`${URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
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
  return parsed as Record<string, unknown> & { ok: true }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${URL}${path}`)
  if (!response.ok) throw new Error(`setup read failed: ${path} → ${response.status}`)
  return (await response.json()) as T
}

test('3 — an exported night survives losing the machine it played on', async ({
  browser,
}) => {
  mkdirSync(DATA_DIR, { recursive: true })
  let server = spawnKwizServer({ port: PORT, dataDir: DATA_DIR })
  try {
    await server.waitReady()

    // ── author (through `@kwiz/db`, per determinism rule 2) ──
    const db = openDatabase(join(DATA_DIR, 'kwiz.db'))
    const quizId = newQuiz(db, 'Night To Remember')
    const roundId = newQuestionSetRound(db, quizId, 'Round one')
    addFreeText(db, roundId, 'Capital of France?', ['paris'], { points: 10 })
    addMultipleChoice(db, roundId, 'Which is a fruit?', [
      { text: 'Tomato', isCorrect: true },
      { text: 'Anvil', isCorrect: false },
    ])
    const game = createGame(db, quizId, ['Alpha', 'Beta'])
    const content = gameContent(db, game.gameId)
    const question = content.rounds[0]!.questions[0]!

    // ── play (over HTTP, so the history is real rows the exporter will read) ──
    const joined = (await post('/api/games/join', {
      code: game.code,
      teamId: game.teamIds[0],
    })) as unknown as { data: { deviceToken: string } }
    const device = joined.data.deviceToken

    await post(`/api/games/${game.gameId}/start`)
    await post(`/api/games/${game.gameId}/rounds/${content.rounds[0]!.id}/open`)
    await post(`/api/games/${game.gameId}/questions/${question.id}/open`)
    await post(
      `/api/games/${game.gameId}/submit`,
      { gameQuestionId: question.id, text: 'paris' },
      { 'x-kwiz-device': device },
    )
    await post(`/api/games/${game.gameId}/answers/validate`, {
      gameQuestionId: question.id,
      teamId: game.teamIds[0],
      accepted: true,
    })
    await post(`/api/games/${game.gameId}/questions/${question.id}/lock`)
    await post(`/api/games/${game.gameId}/questions/${question.id}/reveal`)
    await post(`/api/games/${game.gameId}/questions/${question.id}/score`)
    await post(`/api/games/${game.gameId}/adjust-score`, {
      teamId: game.teamIds[1],
      delta: 5,
      reason: 'best heckle',
      announced: false,
    })
    await post(`/api/games/${game.gameId}/finish`)

    const before = await getJson<{ ok: boolean; data: Parameters<typeof snapshot>[0] }>(
      `/api/games/${game.gameId}/review`,
    ).then((r) => snapshot(r.data))
    const quizBefore = await getJson<{
      ok: boolean
      data: {
        rounds: {
          title: string
          questions: {
            prompt: string
            answerMethod: string
            points: number
            acceptedAnswers: string[]
            options: { text: string; isCorrect: boolean }[]
          }[]
        }[]
      }
    }>(`/api/quizzes/${quizId}`)

    // ── export, with history, through the real dialog ──
    const master = await browser.newContext()
    const page = await master.newPage()
    // A fresh machine meets §4's network picker first; walk it once so /admin is the dashboard.
    await page.goto(`${URL}/en/admin`)
    await pastFirstRun(page)
    await page.goto(`${URL}/en/admin/quizzes/${quizId}`)
    await page.getByRole('button', { name: 'Night To Remember' }).click()
    await page.getByRole('menuitem', { name: en.admin.dashboard.export }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // One played game, so the scope choice exists — and taking the history along is the point.
    // The label carries ICU plurals, so it is matched by its rendered form for count=1.
    await dialog.getByRole('radio', { name: /Quiz \+ 1 played game/ }).check()
    const zip = page.waitForEvent('download')
    await dialog.getByRole('button', { name: en.admin.export.export }).click()
    const download = await zip
    const zipPath = join(tmpdir(), `kwiz-e2e-export-${process.pid}.zip`)
    await download.saveAs(zipPath)
    await master.close()

    // ── lose the machine ──
    // The fixture connection must go before the wipe: on Windows an open handle makes rmSync
    // EPERM, which looks like a server bug and is a test-hygiene bug.
    db.raw.close()
    await server.stop()
    rmSync(DATA_DIR, { recursive: true, force: true })

    // ── come back on a blank one, and import the night ──
    server = spawnKwizServer({ port: PORT, dataDir: DATA_DIR })
    await server.waitReady()

    const context = await browser.newContext()
    const page2 = await context.newPage()
    await page2.goto(`${URL}/en/admin`)
    await pastFirstRun(page2)
    // Same strict-mode trap as `authoring.spec`'s importer: the trigger is addressed by its
    // component marker, because the hidden file input shares its accessible name.
    await page2
      .locator('main button[data-slot="button"]', {
        hasText: en.admin.import.importButton,
      })
      .click()
    await page2.locator('input[type="file"]').setInputFiles(zipPath)

    // No collision on a wiped machine: the plain dialog, no comparison table.
    const importDialog = page2.getByRole('dialog')
    await expect(importDialog.getByText(en.admin.import.collision)).toBeHidden()
    await importDialog.getByRole('button', { name: en.admin.import.import }).click()
    await expect(importDialog).toBeHidden({ timeout: 30_000 })

    // ── the quiz came back, equal where a master would notice ──
    await expect(page2.getByText('Night To Remember')).toBeVisible()
    const quizzes = await getJson<{ ok: boolean; data: { id: string; name: string }[] }>(
      '/api/quizzes',
    )
    const imported = quizzes.data.find((quiz) => quiz.name === 'Night To Remember')
    expect(imported).toBeDefined()

    const quizAfter = await getJson<{
      ok: boolean
      data: {
        rounds: {
          title: string
          questions: {
            prompt: string
            answerMethod: string
            points: number
            acceptedAnswers: string[]
            options: { text: string; isCorrect: boolean }[]
          }[]
        }[]
      }
    }>(`/api/quizzes/${imported!.id}`)
    // Import mints fresh ids (a new quiz identity per copy), so the comparison projects them
    // away and asserts everything a master would recognise as "the same quiz".
    const projectQuiz = (quiz: {
      rounds: {
        title: string
        questions: {
          prompt: string
          answerMethod: string
          points: number
          acceptedAnswers: string[]
          options: { text: string; isCorrect: boolean }[]
        }[]
      }[]
    }) =>
      quiz.rounds.map((round) => ({
        title: round.title,
        questions: round.questions.map((q) => ({
          prompt: q.prompt,
          answerMethod: q.answerMethod,
          points: q.points,
          acceptedAnswers: q.acceptedAnswers,
          options: q.options.map(({ text, isCorrect }) => ({ text, isCorrect })),
        })),
      }))
    expect(projectQuiz(quizAfter.data)).toEqual(projectQuiz(quizBefore.data))

    // ── …and so did the game, answers, verdicts and adjustments intact ──
    const games = await getJson<{
      ok: boolean
      data: { id: string; status: string; teams: number }[]
    }>('/api/games')
    const replayed = games.data.find(
      (candidate) => candidate.status === 'FINISHED' && candidate.teams === 2,
    )
    expect(replayed).toBeDefined()

    const after = await getJson<{ ok: boolean; data: Parameters<typeof snapshot>[0] }>(
      `/api/games/${replayed!.id}/review`,
    ).then((r) => snapshot(r.data))
    expect(after).toEqual(before)

    await context.close()
  } finally {
    await server.stop().catch(() => undefined)
  }
})
