import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  findAttachmentFile,
  insertTemplateAttachment,
  referencedChecksums,
} from './attachments'
import {
  createQuestion,
  createQuiz,
  createRound,
  setAcceptedAnswers,
  updateQuestion,
} from './authoring'
import type { KwizDatabase } from './client'
import { createGameFromQuiz } from './instantiate'
import { attachment, gameAttachment } from './schema'
import { freshTestDatabase } from './test-support'

/**
 * Code review — `attachments.ts` had no test file at all. None of `insertTemplateAttachment`,
 * `findAttachmentFile` (the game-copy-then-template fallback) or `referencedChecksums` (the GC
 * set union) were exercised anywhere.
 */

let database: KwizDatabase
let quizId: string
let roundId: string
let questionId: string

beforeEach(() => {
  database = freshTestDatabase()
  quizId = unwrap(createQuiz(database, { name: 'Pub Quiz' })).quizId
  roundId = unwrap(
    createRound(database, quizId, { type: 'QUESTION_SET', title: 'Round' }),
  ).roundId
  questionId = unwrap(createQuestion(database, roundId)).questionId
})

function unwrap<T>(result: { ok: boolean; data?: T }): T {
  if (!result.ok || result.data === undefined) throw new Error('expected success')
  return result.data
}

const newAttachment = (
  over: Partial<Parameters<typeof insertTemplateAttachment>[1]> = {},
) => ({
  questionId,
  kind: 'IMAGE' as const,
  mimeType: 'image/png',
  originalName: 'photo.png',
  ext: 'png',
  sizeBytes: 1_024,
  checksum: 'a'.repeat(64),
  ...over,
})

describe('insertTemplateAttachment', () => {
  it("appends to the end of the question's media list, position explicit", () => {
    const first = insertTemplateAttachment(
      database,
      newAttachment({ checksum: 'a'.repeat(64) }),
    )
    const second = insertTemplateAttachment(
      database,
      newAttachment({ checksum: 'b'.repeat(64) }),
    )
    if (!first || !second) throw new Error('expected two attachment ids')

    const rows = database.db.select().from(attachment).all()
    const positions = new Map(rows.map((row) => [row.id, row.position]))
    expect(positions.get(first)).toBe(0)
    expect(positions.get(second)).toBe(1)
  })

  it('is undefined against a question that does not exist', () => {
    expect(
      insertTemplateAttachment(database, newAttachment({ questionId: 'nope' })),
    ).toBeUndefined()
  })

  it('defaults showOnPlayerDevices to false, even for an image (D27, I3)', () => {
    const id = insertTemplateAttachment(database, newAttachment())
    const row = database.db
      .select()
      .from(attachment)
      .where(eq(attachment.id, id ?? ''))
      .get()
    expect(row?.showOnPlayerDevices).toBe(false)
  })
})

describe('findAttachmentFile', () => {
  it('finds a template attachment when no game copy exists yet', () => {
    const id = insertTemplateAttachment(
      database,
      newAttachment({ checksum: 'c'.repeat(64) }),
    )
    if (!id) throw new Error('expected an attachment id')

    expect(findAttachmentFile(database, id)).toEqual({
      checksum: 'c'.repeat(64),
      ext: 'png',
      mimeType: 'image/png',
    })
  })

  it('prefers the game copy over the template row once a game exists', () => {
    updateQuestion(database, questionId, { prompt: 'Capital of France?' })
    setAcceptedAnswers(database, questionId, ['paris'])
    insertTemplateAttachment(database, newAttachment({ checksum: 'd'.repeat(64) }))

    const created = unwrap(createGameFromQuiz(database, { quizId, code: 'ABCD02' }))
    const copyRow = database.db.select().from(gameAttachment).all()[0]
    if (!copyRow) throw new Error('expected a copied attachment row')

    // The template and its copy are two different rows sharing one file by checksum (§8) — the
    // copy's *id* is what resolves here, never the template's.
    expect(findAttachmentFile(database, copyRow.id)).toEqual({
      checksum: 'd'.repeat(64),
      ext: 'png',
      mimeType: 'image/png',
    })
    expect(created.gameId).toBeTruthy()
  })

  it('is undefined for an id that resolves to neither table', () => {
    expect(findAttachmentFile(database, 'nope')).toBeUndefined()
  })
})

describe('referencedChecksums', () => {
  it('is the union of both tables, deduplicated', () => {
    insertTemplateAttachment(database, newAttachment({ checksum: 'e'.repeat(64) }))
    updateQuestion(database, questionId, { prompt: 'Capital of France?' })
    setAcceptedAnswers(database, questionId, ['paris'])
    unwrap(createGameFromQuiz(database, { quizId, code: 'ABCD03' }))

    // A second, template-only attachment with no game ever copying it.
    const questionTwoId = unwrap(createQuestion(database, roundId)).questionId
    insertTemplateAttachment(
      database,
      newAttachment({ questionId: questionTwoId, checksum: 'f'.repeat(64) }),
    )

    const checksums = referencedChecksums(database)
    expect(checksums.has('e'.repeat(64))).toBe(true)
    expect(checksums.has('f'.repeat(64))).toBe(true)
    // Exactly one entry for the copied file, even though it exists as two rows now.
    expect([...checksums].filter((c) => c === 'e'.repeat(64))).toHaveLength(1)
  })

  it('is empty against a database with no attachments at all', () => {
    expect(referencedChecksums(database).size).toBe(0)
  })
})
