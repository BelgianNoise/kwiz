import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  collectQuizExport,
  importQuiz,
  listGames,
  listQuizzes,
  type ImportMode,
  type QuizExport,
} from '@kwiz/db'
import { EventPayloadError, fail, ok, type ActionResult } from '@kwiz/domain'
import {
  readExport,
  writeExport,
  type AttachmentBytes,
  type ParsedExport,
} from '@kwiz/export'

import type { Runtime } from './runtime'

/**
 * PRD 2 §14 — the app-layer half of export and import: the bytes.
 *
 * `@kwiz/export` owns the format and `@kwiz/db` owns the rows; **only this module touches a
 * filesystem**, which is the same split data model §8 draws for attachments. It is also why the zip
 * package takes `sha256` as an argument rather than importing `node:crypto`.
 */

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

export interface ExportOptions {
  includeGames: boolean
  includeAttachments: boolean
  /** §14.1's "Export this game" — quiz + that one game, from the game hub's overflow menu. */
  onlyGameId?: string
}

/**
 * §14.1 — *"sizes are computed, not estimated."*
 *
 * Answered without reading a byte of media: every attachment row already stores `sizeBytes`, and the
 * JSON is small enough that the media total is the number. A master on a slow USB stick gets a real
 * figure before committing to the copy.
 */
export function exportSize(
  runtime: Runtime,
  quizId: string,
  options: ExportOptions,
): ActionResult<{ bytes: number; attachments: number; games: number }> {
  const collected = collectQuizExport(runtime.database, quizId, options)
  if (!collected) return fail('GAME_NOT_FOUND', `no quiz ${quizId}`)

  /*
   * `collected.attachments` is now the quiz's whole file list regardless of the toggle (the
   * manifest needs it either way, for the missing-media report) — so *this* is the one place that
   * has to check `includeAttachments` explicitly. Without it, unticking the checkbox would still
   * show the full transfer size, which is exactly the number §14.1 exists to get right for a
   * master on a slow USB stick.
   */
  const files = options.includeAttachments ? collected.attachments : []
  return ok({
    bytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    attachments: files.length,
    games: collected.games.length,
  })
}

export async function exportQuiz(
  runtime: Runtime,
  quizId: string,
  options: ExportOptions,
): Promise<ActionResult<{ fileName: string; bytes: Uint8Array }>> {
  const collected = collectQuizExport(runtime.database, quizId, options)
  if (!collected) return fail('GAME_NOT_FOUND', `no quiz ${quizId}`)

  return ok(
    writeExport({
      quiz: collected.quiz,
      games: collected.games,
      includesGames: options.includeGames,
      // Whether the bytes themselves are read off disk and embedded — empty when unticked.
      attachments: options.includeAttachments
        ? await readAttachments(runtime, collected)
        : [],
      // The manifest's file *list* is always the full one, so an import with no bytes still
      // reports every file as missing rather than reporting none (§14.1, protocol §8.1).
      attachmentManifest: collected.attachments,
      exportedAt: new Date(),
    }),
  )
}

/**
 * A file that has gone missing since its row was written is **skipped, not fatal**.
 *
 * Pre-flight (§10) is where a master is told their media is damaged, before a room is waiting. An
 * export refusing at this point would block the one action that gets their work off a failing disk,
 * and protocol §8.1's per-file reporting means the other side learns exactly which files are absent.
 */
async function readAttachments(
  runtime: Runtime,
  collected: QuizExport,
): Promise<AttachmentBytes[]> {
  const files: AttachmentBytes[] = []

  // oxlint-disable no-await-in-loop
  for (const file of collected.attachments) {
    const path = join(
      /*turbopackIgnore: true*/ runtime.paths.attachments,
      `${file.checksum}.${file.ext}`,
    )
    const bytes = await readFile(/*turbopackIgnore: true*/ path).catch(() => undefined)
    if (bytes) files.push({ ...file, bytes: new Uint8Array(bytes) })
  }
  // oxlint-enable no-await-in-loop

  return files
}

export interface ImportPreview {
  quiz: { id: string; name: string; revision: number }
  counts: { rounds: number; questions: number; attachments: number; games: number }
  exportedAt: string
  missingAttachments: ParsedExport['missingAttachments']
  /**
   * §14.2's collision — present only when this machine already holds a quiz with the same identity.
   * `olderThanLocal` is the comparison spelled out, because two timestamps side by side still make
   * the master do the reasoning, at speed, and getting it wrong is destructive.
   */
  collision?: {
    localName: string
    localUpdatedAt: string
    localRounds: number
    localQuestions: number
    localGames: number
    olderThanLocal: boolean
  }
}

/** §14.2 — everything is validated and previewed **before anything is written** (protocol §8.3). */
export function inspectImport(
  runtime: Runtime,
  bytes: Uint8Array,
): ActionResult<{ preview: ImportPreview }> {
  const read = readExport(bytes, sha256)
  if (!read.ok || !read.data)
    return read.ok ? fail('MANIFEST_INVALID', 'unreadable') : read

  return ok({ preview: preview(runtime, read.data) })
}

function preview(runtime: Runtime, parsed: ParsedExport): ImportPreview {
  const local = listQuizzes(runtime.database).find(
    (row) => row.id === parsed.manifest.quiz.id,
  )

  /*
   * Counted, never assumed. This is the number in `Replace`'s stated cost — "deletes it and its 2
   * games" — so a wrong one understates exactly the destruction §14.2 exists to make explicit.
   */
  const localGames = local
    ? listGames(runtime.database).filter((row) => row.sourceQuizId === local.id).length
    : 0

  return {
    quiz: parsed.manifest.quiz,
    counts: parsed.manifest.counts,
    exportedAt: parsed.manifest.exportedAt,
    missingAttachments: parsed.missingAttachments,
    ...(local
      ? {
          collision: {
            localName: local.name,
            localUpdatedAt: local.updatedAt.toISOString(),
            localRounds: local.rounds,
            localQuestions: local.questions,
            localGames,
            /*
             * **Compared by `updatedAt`, not by revision** (§14.2, correcting D9). Autosaved editing
             * increments a revision per keystroke, so "rev 7 vs rev 9" orders correctly and means
             * nothing to a human. Dates are what a master can actually reason about.
             */
            olderThanLocal: new Date(parsed.manifest.exportedAt) < local.updatedAt,
          },
        }
      : {}),
  }
}

/**
 * Protocol §8.3 steps 4 and 5: the database in one transaction, **then** the files.
 *
 * Content addressing is what makes writing files after the commit safe. A file already present is
 * skipped, and a file written for a transaction that then failed is an orphan the reconciliation
 * pass sweeps (data model §8, PRD 2 §16). The failure mode is a stray file, never a missing one.
 */
export async function performImport(
  runtime: Runtime,
  bytes: Uint8Array,
  mode: ImportMode,
  randomBytes: (size: number) => Uint8Array,
): Promise<ActionResult<{ quizId: string; missing: number }>> {
  const read = readExport(bytes, sha256)
  if (!read.ok || !read.data)
    return read.ok ? fail('MANIFEST_INVALID', 'unreadable') : read

  const parsed = read.data
  let result: ReturnType<typeof importQuiz>
  try {
    result = importQuiz(runtime.database, {
      quiz: parsed.quiz,
      games: parsed.games,
      mode,
      randomBytes,
    })
  } catch (error) {
    /*
     * P2 #20 — a `games.json` that passed schema validation but carries a payload replay itself
     * rejects (conventions §10.1's "must fail loudly rather than quietly corrupt a projection")
     * surfaced as an uncaught exception here instead of the typed refusal every other bad-file
     * case in this function already returns. The write is still safe either way — the whole
     * import runs in one transaction (data model §7.1) and rolls back — only the error's *shape*
     * was inconsistent.
     */
    if (error instanceof EventPayloadError) {
      return fail('MANIFEST_INVALID', `games.json failed replay — ${error.message}`)
    }
    throw error
  }

  // oxlint-disable no-await-in-loop
  for (const [checksum, content] of parsed.attachments) {
    const ext = parsed.manifest.attachments.find(
      (file) => file.checksum === checksum,
    )?.ext
    if (!ext) continue

    const path = join(
      /*turbopackIgnore: true*/ runtime.paths.attachments,
      `${checksum}.${ext}`,
    )
    // `wx` — never overwrite. The file already there has this checksum, so it is byte-identical.
    await writeFile(/*turbopackIgnore: true*/ path, content, { flag: 'wx' }).catch(
      () => undefined,
    )
  }
  // oxlint-enable no-await-in-loop

  return ok({ quizId: result.quizId, missing: parsed.missingAttachments.length })
}
