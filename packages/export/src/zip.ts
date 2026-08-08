import { gamesFileSchema, quizFileSchema, type GamesFile, type QuizFile } from '@kwiz/db'
import { fail, ok, type ActionResult } from '@kwiz/domain'
import { unzipSync, zipSync } from 'fflate'
import type { z } from 'zod'

import {
  ATTACHMENT_DIR,
  exportFileName,
  GAMES_FILE,
  manifestSchema,
  MANIFEST_FILE,
  QUIZ_FILE,
  type Manifest,
} from './manifest'
import { SCHEMA_VERSION } from './version'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface AttachmentBytes {
  checksum: string
  ext: string
  sizeBytes: number
  bytes: Uint8Array
}

export interface ExportInput {
  quiz: QuizFile
  games: GamesFile['games']
  includesGames: boolean
  attachments: AttachmentBytes[]
  exportedAt: Date
}

/**
 * Writes protocol §8's zip.
 *
 * **In memory, deliberately.** At PRD 1 §2.1's scale — a pub quiz with a dozen media files — this is
 * a few megabytes and a streaming writer would be machinery with no payoff (CLAUDE.md §9). The trade
 * is explicit rather than accidental: a quiz whose attachments are gigabytes of video would need a
 * streaming zip, and that is the signal to revisit, not a bug to be surprised by.
 *
 * Attachments are stored uncompressed (`level: 0`). They are already-compressed media — PNG, JPEG,
 * MP3, MP4 — so deflating them spends CPU to grow the file by a fraction of a percent. The JSON,
 * which compresses genuinely well, is not.
 */
export function writeExport(input: ExportInput): { fileName: string; bytes: Uint8Array } {
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    quiz: {
      id: input.quiz.quiz.id,
      name: input.quiz.quiz.name,
      revision: input.quiz.quiz.revision,
    },
    includesGames: input.includesGames,
    counts: {
      rounds: input.quiz.rounds.length,
      questions: input.quiz.questions.length,
      attachments: input.attachments.length,
      games: input.games.length,
    },
    attachments: input.attachments.map((file) => ({
      checksum: file.checksum,
      ext: file.ext,
      sizeBytes: file.sizeBytes,
    })),
  }

  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [MANIFEST_FILE]: [json(manifest), { level: 6 }],
    [QUIZ_FILE]: [json(input.quiz), { level: 6 }],
  }

  // Omitted entirely rather than written empty, so `includesGames` and the file agree (§8).
  if (input.includesGames) {
    files[GAMES_FILE] = [json({ games: input.games }), { level: 6 }]
  }

  for (const file of input.attachments) {
    files[`${ATTACHMENT_DIR}${file.checksum}.${file.ext}`] = [file.bytes, { level: 0 }]
  }

  return {
    fileName: exportFileName(input.quiz.quiz.name, input.exportedAt),
    bytes: zipSync(files),
  }
}

export interface ParsedExport {
  manifest: Manifest
  quiz: QuizFile
  games: GamesFile['games']
  /** Present only for attachments whose bytes are in the zip *and* whose checksum verified. */
  attachments: Map<string, Uint8Array>
  /**
   * Per-file problems, never fatal on their own (§8.1). An export made without attachments is the
   * supported "just send me the questions" case, so missing media downgrades the import rather than
   * failing it — the master is told which files are absent and can re-upload them.
   */
  missingAttachments: { checksum: string; ext: string; reason: 'ABSENT' | 'CORRUPT' }[]
}

/**
 * Reads and validates a zip, in protocol §8.3's order: manifest, then counts, then per-file
 * checksums. Nothing is written to the database here — that is `importQuiz`, and keeping the two
 * apart is what makes "validate before anything is written" (§14.2) true rather than aspirational.
 *
 * `sha256` is injected because hashing is the app layer's job (`packages/export` has no
 * `node:crypto` dependency of its own), and because a test can then verify the *reporting* without
 * hashing anything.
 */
export function readExport(
  bytes: Uint8Array,
  sha256: (input: Uint8Array) => string,
): ActionResult<ParsedExport> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    return fail('MANIFEST_INVALID', 'that file is not a readable zip')
  }

  const manifestBytes = entries[MANIFEST_FILE]
  if (!manifestBytes) return fail('MANIFEST_INVALID', 'the zip has no manifest.json')

  const manifest = parse(manifestBytes, manifestSchema)
  if (!manifest.success)
    return fail('MANIFEST_INVALID', 'manifest.json is not a Kwiz manifest')

  // Checked first and on its own: a newer format must be refused by name, never partially imported.
  if (manifest.data.schemaVersion > SCHEMA_VERSION) {
    return fail(
      'SCHEMA_VERSION_UNSUPPORTED',
      `this file was written by a newer version of Kwiz (format ${manifest.data.schemaVersion}, this build reads ${SCHEMA_VERSION})`,
    )
  }

  const quizBytes = entries[QUIZ_FILE]
  if (!quizBytes) return fail('MANIFEST_INVALID', 'the zip has no quiz.json')

  const quiz = parse(quizBytes, quizFileSchema)
  if (!quiz.success)
    return fail('MANIFEST_INVALID', 'quiz.json does not match this schema version')

  let games: GamesFile['games'] = []
  if (manifest.data.includesGames) {
    const gamesBytes = entries[GAMES_FILE]
    if (!gamesBytes) {
      return fail(
        'MANIFEST_INVALID',
        'the manifest promises games but games.json is missing',
      )
    }
    const parsed = parse(gamesBytes, gamesFileSchema)
    if (!parsed.success) {
      return fail('MANIFEST_INVALID', 'games.json does not match this schema version')
    }
    games = parsed.data.games
  }

  /**
   * §8.1 — counts are verified against the parsed content, because a truncated zip parses perfectly
   * well and simply contains less. Without this, half a quiz imports and looks fine.
   */
  const counted = {
    rounds: quiz.data.rounds.length,
    questions: quiz.data.questions.length,
    attachments: manifest.data.attachments.length,
    games: games.length,
  }
  // Listed rather than derived from `Object.entries`, whose keys are plain strings — this way a
  // count added to the manifest without a check here is a type error.
  const keys = ['rounds', 'questions', 'attachments', 'games'] as const
  for (const key of keys) {
    const value = counted[key]
    const expected = manifest.data.counts[key]
    if (value !== expected) {
      return fail(
        'MANIFEST_INVALID',
        `the file is incomplete — the manifest lists ${expected} ${key} but the contents have ${value}`,
      )
    }
  }

  const attachments = new Map<string, Uint8Array>()
  const missingAttachments: ParsedExport['missingAttachments'] = []

  for (const file of manifest.data.attachments) {
    const stored = entries[`${ATTACHMENT_DIR}${file.checksum}.${file.ext}`]
    if (!stored) {
      missingAttachments.push({
        checksum: file.checksum,
        ext: file.ext,
        reason: 'ABSENT',
      })
      continue
    }
    // Content addressing makes this cheap to state and worth doing: the name *is* the expected hash.
    if (sha256(stored) !== file.checksum) {
      missingAttachments.push({
        checksum: file.checksum,
        ext: file.ext,
        reason: 'CORRUPT',
      })
      continue
    }
    attachments.set(file.checksum, stored)
  }

  return ok({
    manifest: manifest.data,
    quiz: quiz.data,
    games,
    attachments,
    missingAttachments,
  })
}

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

/** Parse-then-validate in one step, so a malformed JSON body and a wrong shape fail identically. */
function parse<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
): { success: true; data: T } | { success: false } {
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(bytes))
  } catch {
    return { success: false }
  }

  const result = schema.safeParse(value)
  return result.success ? { success: true, data: result.data } : { success: false }
}
