import {
  collectQuizExport,
  createGameFromQuiz,
  createQuestion,
  createQuiz,
  createRound,
  setAcceptedAnswers,
  updateQuestion,
} from '@kwiz/db'
import { writeExport } from '@kwiz/export'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestRuntime, type TestRuntime } from './test-runtime'
import { performImport } from './transfer'

/**
 * P2 #20 — `performImport` didn't catch a replay-time `EventPayloadError`, so a `games.json` that
 * passes schema validation but carries a payload `parseStoredEvent` rejects surfaced as an
 * uncaught exception instead of the typed refusal every other bad-file case in this function
 * already returns.
 */

let runtime: TestRuntime

beforeEach(() => {
  runtime = createTestRuntime()
})

const bytes = (size: number): Uint8Array => Uint8Array.from({ length: size }, () => 7)

function unwrap<T>(result: { ok: boolean; data?: T }): T {
  if (!result.ok || result.data === undefined) throw new Error('expected success')
  return result.data
}

describe('performImport', () => {
  it('reports a corrupted event payload as MANIFEST_INVALID rather than throwing', async () => {
    const quizId = unwrap(createQuiz(runtime.database, { name: 'Pub Quiz' })).quizId
    const roundId = unwrap(
      createRound(runtime.database, quizId, { type: 'QUESTION_SET', title: 'Round' }),
    ).roundId
    const questionId = unwrap(createQuestion(runtime.database, roundId)).questionId
    updateQuestion(runtime.database, questionId, { prompt: 'Capital of France?' })
    setAcceptedAnswers(runtime.database, questionId, ['paris'])
    const created = unwrap(
      createGameFromQuiz(runtime.database, {
        quizId,
        code: 'ABC234',
        teams: [{ name: 'Aardappel', colour: '#EF4444' }],
      }),
    )

    const exported = collectQuizExport(runtime.database, quizId, { includeGames: true })
    if (!exported) throw new Error('expected an export')

    // A shape-valid row (schema-level checks pass — `rowSchema` doesn't look inside a JSON
    // column) whose payload is missing everything `TEAM_ADDED` requires — exactly the kind of
    // corruption `parseStoredEvent` exists to catch at replay, not at manifest-parse time.
    const gameExport = exported.games.find((entry) => entry.game.id === created.gameId)
    if (!gameExport) throw new Error('expected the game in the export')
    const corrupted = {
      ...gameExport,
      events: gameExport.events.map((event) =>
        event.type === 'TEAM_ADDED' ? { ...event, payload: {} } : event,
      ),
    }

    const zip = writeExport({
      quiz: exported.quiz,
      games: [corrupted],
      includesGames: true,
      attachments: [],
      exportedAt: new Date(),
    })

    const result = await performImport(runtime, zip.bytes, 'COPY', bytes)
    expect(result).toMatchObject({ ok: false, error: 'MANIFEST_INVALID' })
  })
})
