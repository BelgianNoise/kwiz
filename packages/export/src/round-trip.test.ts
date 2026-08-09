import { createHash } from 'node:crypto'

import {
  appendAndProject,
  collectQuizExport,
  createGameFromQuiz,
  createQuestion,
  createQuiz,
  createRound,
  game,
  gameAnswer,
  gameTeam,
  importQuiz,
  insertTemplateAttachment,
  loadGameContent,
  loadQuizTree,
  quiz,
  setAcceptedAnswers,
  setKeywords,
  updateQuestion,
  type KwizDatabase,
} from '@kwiz/db'
import { freshTestDatabase } from '@kwiz/db/test-support'
import type { GameEvent } from '@kwiz/domain'
import { unzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'

import { readExport, writeExport } from './zip'

/**
 * **Export → import round-trip** (CLAUDE.md §6's required list, protocol §8).
 *
 * Two machines, two real databases, one zip between them — because the property under test is that a
 * quiz *arrives* somewhere it was never authored. A single-database test would pass while the export
 * silently omitted a table, since the rows would already be there.
 *
 * The most valuable assertion is the last one: projections are **not** in the zip, so an imported
 * game's scores exist only if replaying its log rebuilt them. Every import is a live test of I15.
 */

let source: KwizDatabase
let target: KwizDatabase

beforeEach(() => {
  source = freshTestDatabase()
  target = freshTestDatabase()
})

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

/** Deterministic, so an imported `SETUP` game's regenerated code is predictable. */
const bytes = (size: number): Uint8Array => Uint8Array.from({ length: size }, () => 7)

function unwrap<T>(result: { ok: boolean; data?: T }): T {
  if (!result.ok || result.data === undefined) throw new Error('expected success')
  return result.data
}

/** A quiz with the shapes that break naive exports: a finale, keywords, and accepted answers. */
function seedQuiz(database: KwizDatabase): string {
  const quizId = unwrap(createQuiz(database, { name: 'Pub Quiz #4' })).quizId

  const roundId = unwrap(
    createRound(database, quizId, { type: 'QUESTION_SET', title: 'Warm-up' }),
  ).roundId
  const questionId = unwrap(createQuestion(database, roundId)).questionId
  updateQuestion(database, questionId, { prompt: 'Capital of France?' })
  setAcceptedAnswers(database, questionId, ['paris', 'parijs'])

  const finaleId = unwrap(
    createRound(database, quizId, { type: 'DSMTW_FINALE', title: 'Finale' }),
  ).roundId
  const finaleQuestion = unwrap(createQuestion(database, finaleId)).questionId
  updateQuestion(database, finaleQuestion, { prompt: 'Describe a cow' })
  setKeywords(database, finaleQuestion, ['i like cows', 'moo', 'grass', 'milk', 'field'])

  return quizId
}

describe('round-trip', () => {
  it('reproduces the quiz tree on a machine that never saw it', () => {
    const quizId = seedQuiz(source)
    const exported = collectQuizExport(source, quizId, {
      includeGames: false,
    })
    if (!exported) throw new Error('expected an export')

    const zip = writeExport({
      quiz: exported.quiz,
      games: [],
      includesGames: false,
      attachments: [],
      exportedAt: new Date('2026-08-08T12:00:00.000Z'),
    })

    const read = readExport(zip.bytes, sha256)
    if (!read.ok || !read.data) throw new Error(read.ok ? 'no data' : read.message)

    importQuiz(target, {
      quiz: read.data.quiz,
      games: [],
      mode: 'COPY',
      randomBytes: bytes,
    })

    // Compared through `loadQuizTree` rather than row by row: it is what every surface reads, so
    // matching here is what "the quiz arrived" actually means.
    const [imported] = target.db.select({ id: quiz.id }).from(quiz).all()
    const before = loadQuizTree(source, quizId)
    const after = loadQuizTree(target, imported?.id ?? '')

    expect(after?.name).toBe('Pub Quiz #4')
    expect(after?.rounds).toHaveLength(before?.rounds.length ?? -1)
    expect(after?.rounds[0]?.questions[0]?.prompt).toBe('Capital of France?')
    expect(after?.rounds[1]?.type).toBe('DSMTW_FINALE')
  })

  /** I19 — `wordLengths` is stored on write, so it must survive the file rather than be recomputed. */
  it("carries the finale's word shapes without carrying anything derivable from them", () => {
    const quizId = seedQuiz(source)
    const exported = collectQuizExport(source, quizId, {
      includeGames: false,
    })
    if (!exported) throw new Error('expected an export')

    const keyword = exported.quiz.keywords.find((row) => row.text === 'i like cows')
    expect(keyword?.wordLengths).toEqual([1, 4, 4])
  })

  it('names the file after the quiz and the moment, with nothing a path could use', () => {
    const quizId = unwrap(createQuiz(source, { name: 'Round 1/2: Pub "Quiz"' })).quizId
    const exported = collectQuizExport(source, quizId, {
      includeGames: false,
    })
    if (!exported) throw new Error('expected an export')

    const zip = writeExport({
      quiz: exported.quiz,
      games: [],
      includesGames: false,
      attachments: [],
      exportedAt: new Date('2026-08-08T12:34:56.000Z'),
    })

    expect(zip.fileName).toBe('kwiz-export-round-1-2-pub-quiz-2026-08-08-12-34-56.zip')
  })
})

describe('a game travels with its history', () => {
  /**
   * The heart of protocol §8.2: the zip carries the log, never the projections, so a score on the
   * other side proves the replay ran. Scored through `appendAndProject` so the source has a real
   * history rather than hand-written rows.
   */
  it('rebuilds projections by replaying the log, not by copying them', () => {
    const quizId = seedQuiz(source)
    const created = unwrap(
      createGameFromQuiz(source, {
        quizId,
        code: 'ABC234',
        defaultPlayerLocale: 'en',
        teams: [
          { name: 'Aardappel', colour: '#EF4444' },
          { name: 'Pintjes', colour: '#22D3EE' },
        ],
      }),
    )

    const teamA = created.teamIds[0] ?? ''
    // Through the game's own content tree, so the id is the copy's — never the template's (§5).
    const content = loadGameContent(source, created.gameId)
    const gameQuestionId = content?.rounds[0]?.questions[0]?.id ?? ''

    const history: GameEvent[] = [
      { type: 'QUESTION_OPENED', payload: { gameQuestionId } },
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId,
          teamId: teamA,
          text: 'paris',
          fromDraft: false,
          enteredByMaster: false,
        },
      },
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId, teamId: teamA, accepted: true },
      },
    ]
    appendAndProject(source, created.gameId, history)

    const exported = collectQuizExport(source, quizId, {
      includeGames: true,
    })
    if (!exported) throw new Error('expected an export')
    expect(exported.games).toHaveLength(1)

    const zip = writeExport({
      quiz: exported.quiz,
      games: exported.games,
      includesGames: true,
      attachments: [],
      exportedAt: new Date('2026-08-08T12:00:00.000Z'),
    })

    const read = readExport(zip.bytes, sha256)
    if (!read.ok || !read.data) throw new Error(read.ok ? 'no data' : read.message)

    importQuiz(target, {
      quiz: read.data.quiz,
      games: read.data.games,
      mode: 'COPY',
      randomBytes: bytes,
    })

    /*
     * The point of the whole test. `game_answer` is a projection and travels in no file, so a row
     * here exists only because replaying the imported log rebuilt it — invariant I15, exercised by
     * the ordinary act of importing.
     */
    const answers = target.db.select().from(gameAnswer).all()
    expect(answers).toHaveLength(1)
    expect(answers[0]?.verdict).toBe('ACCEPTED')
    expect(answers[0]?.pointsAwarded).toBe(10)

    // And the team the score belongs to came across with a *new* id, not the source's.
    const importedTeams = target.db.select().from(gameTeam).all()
    expect(importedTeams.map((row) => row.name).sort()).toEqual(['Aardappel', 'Pintjes'])
    expect(importedTeams.map((row) => row.id)).not.toContain(teamA)
    expect(answers[0]?.teamId).toBe(
      importedTeams.find((row) => row.name === 'Aardappel')?.id,
    )
  })
  /**
   * §14.2's real case: **importing a copy onto the machine it came from.** Both games are `SETUP`, so
   * both want a joinable code, and the unique index (data model §6.1) allows exactly one.
   *
   * This is what caught the code living in event payloads: regenerating on insert is undone the
   * moment `CODE_REGENERATED` replays, and the import dies on a constraint rather than on anything
   * that points at the cause.
   */
  it('imports a copy alongside the original without colliding on the join code', () => {
    const quizId = seedQuiz(source)
    const created = unwrap(
      createGameFromQuiz(source, {
        quizId,
        code: 'ABC234',
        defaultPlayerLocale: 'en',
        teams: [{ name: 'Aardappel', colour: '#EF4444' }],
      }),
    )

    // The code a master regenerated once, which is now in the log as well as on the row.
    appendAndProject(source, created.gameId, [
      { type: 'CODE_REGENERATED', payload: { code: 'ZZZ789' } },
    ])

    const exported = collectQuizExport(source, quizId, {
      includeGames: true,
    })
    if (!exported) throw new Error('expected an export')

    const zip = writeExport({
      quiz: exported.quiz,
      games: exported.games,
      includesGames: true,
      attachments: [],
      exportedAt: new Date('2026-08-08T12:00:00.000Z'),
    })
    const read = readExport(zip.bytes, sha256)
    if (!read.ok || !read.data) throw new Error('expected a readable zip')

    // Back into the SAME database the export came from.
    importQuiz(source, {
      quiz: read.data.quiz,
      games: read.data.games,
      mode: 'COPY',
      randomBytes: bytes,
    })

    const codes = source.db
      .select()
      .from(game)
      .all()
      .map((row) => row.code)
    expect(codes).toHaveLength(2)
    expect(new Set(codes).size).toBe(2)
    expect(codes).toContain('ZZZ789')
  })
})

describe('refusing a bad file', () => {
  it('refuses a newer format by name rather than importing part of it', () => {
    const quizId = seedQuiz(source)
    const exported = collectQuizExport(source, quizId, {
      includeGames: false,
    })
    if (!exported) throw new Error('expected an export')

    const zip = writeExport({
      quiz: exported.quiz,
      games: [],
      includesGames: false,
      attachments: [],
      exportedAt: new Date(),
    })

    // Rewrite the manifest's version in place, which is exactly what a future build would produce.
    const tampered = bump(zip.bytes)
    const read = readExport(tampered, sha256)

    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toBe('SCHEMA_VERSION_UNSUPPORTED')
  })

  it('is not a zip at all', () => {
    const read = readExport(Uint8Array.from([1, 2, 3, 4, 5]), sha256)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toBe('MANIFEST_INVALID')
  })

  /**
   * §8.1 — a damaged attachment is reported per file and does **not** fail the import, because
   * "just send me the questions" is a supported way to use this (§14.1).
   */
  it('reports a corrupt attachment per file instead of failing', () => {
    const quizId = seedQuiz(source)
    const exported = collectQuizExport(source, quizId, {
      includeGames: false,
    })
    if (!exported) throw new Error('expected an export')

    const payload = Uint8Array.from([9, 9, 9, 9])
    const zip = writeExport({
      quiz: exported.quiz,
      games: [],
      includesGames: false,
      // A checksum that is not this file's — the same thing a bit-rotted USB stick produces.
      attachments: [{ checksum: 'deadbeef', ext: 'png', sizeBytes: 4, bytes: payload }],
      exportedAt: new Date(),
    })

    const read = readExport(zip.bytes, sha256)
    if (!read.ok || !read.data) throw new Error('expected the import to survive')

    expect(read.data.missingAttachments).toEqual([
      { checksum: 'deadbeef', ext: 'png', reason: 'CORRUPT' },
    ])
    expect(read.data.attachments.size).toBe(0)
  })

  /**
   * Functional review P1.4: unticking "include attachments" (§14.1) must still tell the other side
   * *which* files it didn't get, not silently claim there were none. `collectQuizExport`'s attachment
   * list is always the full one; this is what a caller who then embeds no bytes actually produces.
   */
  it('reports every referenced file as missing when attachments were not embedded, not zero', () => {
    const quizId = seedQuiz(source)
    const roundId = unwrap(
      createRound(source, quizId, { type: 'QUESTION_SET', title: 'Media round' }),
    ).roundId
    const questionId = unwrap(createQuestion(source, roundId)).questionId
    const attachmentId = insertTemplateAttachment(source, {
      questionId,
      kind: 'IMAGE',
      mimeType: 'image/png',
      originalName: 'cow.png',
      ext: 'png',
      sizeBytes: 4,
      checksum: 'feedface',
    })
    expect(attachmentId).toBeDefined()

    const exported = collectQuizExport(source, quizId, { includeGames: false })
    if (!exported) throw new Error('expected an export')
    // The bug: this must still list the file even though no bytes will be embedded below.
    expect(exported.attachments).toEqual([
      { checksum: 'feedface', ext: 'png', sizeBytes: 4 },
    ])

    const zip = writeExport({
      quiz: exported.quiz,
      games: [],
      includesGames: false,
      // Mirrors `transfer.ts`'s `includeAttachments: false` path: no bytes, but the manifest still
      // carries the full file list so the missing-media report on import is complete.
      attachments: [],
      attachmentManifest: exported.attachments,
      exportedAt: new Date(),
    })

    const read = readExport(zip.bytes, sha256)
    if (!read.ok || !read.data) throw new Error('expected the import to survive')

    expect(read.data.missingAttachments).toEqual([
      { checksum: 'feedface', ext: 'png', reason: 'ABSENT' },
    ])
    expect(read.data.attachments.size).toBe(0)
  })
})

/**
 * Rewrites `schemaVersion` inside a finished zip — exactly the file a future build would write, and
 * the only honest way to test that this build refuses it.
 */
function bump(zipBytes: Uint8Array): Uint8Array {
  const entries = unzipSync(zipBytes)
  const manifestBytes = entries['manifest.json'] ?? new Uint8Array()
  const manifest: unknown = JSON.parse(new TextDecoder().decode(manifestBytes))
  if (typeof manifest !== 'object' || manifest === null) throw new Error('no manifest')
  const patched = { ...Object.fromEntries(Object.entries(manifest)), schemaVersion: 99 }

  return zipSync({
    ...entries,
    'manifest.json': new TextEncoder().encode(JSON.stringify(patched)),
  })
}
