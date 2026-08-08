import { parseStoredEvent } from '@kwiz/domain'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { KwizDatabase, KwizTx } from './client'
import type { GameExport, QuizFile } from './export-schema'
import { generateUnusedCode } from './games'
import { applyProjection } from './projections'
import {
  acceptedAnswer,
  attachment,
  game,
  gameAcceptedAnswer,
  gameAttachment,
  gameEvent,
  gameJeopardyCategory,
  gameQuestion,
  gameQuestionKeyword,
  gameQuestionOption,
  gameRound,
  jeopardyCategory,
  question,
  questionKeyword,
  questionOption,
  quiz,
  round,
} from './schema'

/**
 * Protocol §8.3 step 4 — **one transaction**. Either the whole import lands or the database is
 * untouched (PRD 1 §10).
 *
 * The interesting part is not the inserts, it is that **projections are rebuilt by replaying the
 * events** rather than being carried in the zip. That keeps the file smaller, but mostly it makes
 * every import a live test of invariant I15: if the log and the projections could ever disagree,
 * importing a game is where it shows.
 */

export type ImportMode =
  /** Coexist with the original: new ids throughout, so both copies are usable (§14.2's default). */
  | 'COPY'
  /** Replace the local quiz and its games. Destructive, and §14.2 states the cost before asking. */
  | 'REPLACE'

export interface ImportInput {
  quiz: QuizFile
  games: GameExport[]
  mode: ImportMode
  /**
   * Injected rather than imported, exactly as every other caller of `generateUnusedCode` does it —
   * `packages/db` stays free of `node:crypto` and a test can hand it a fixed sequence.
   */
  randomBytes: (size: number) => Uint8Array
}

export interface ImportResult {
  quizId: string
  rounds: number
  questions: number
  games: number
}

export function importQuiz(database: KwizDatabase, input: ImportInput): ImportResult {
  return database.db.transaction((tx) => {
    if (input.mode === 'REPLACE') {
      /*
       * Deleting the quiz row is enough: every template table cascades from it, and each game
       * cascades from its own row (data model §10). The games are deleted explicitly because
       * `game.sourceQuizId` is deliberately *not* a cascading reference — a quiz deleted in the
       * ordinary way keeps its played history (§10), and only a replace means to take it too.
       */
      for (const row of tx
        .select({ id: game.id })
        .from(game)
        .where(eq(game.sourceQuizId, input.quiz.quiz.id))
        .all()) {
        tx.delete(game).where(eq(game.id, row.id)).run()
      }
      tx.delete(quiz).where(eq(quiz.id, input.quiz.quiz.id)).run()
    }

    /**
     * `COPY` assigns new ids throughout — quiz, rounds, questions, games, copy subtrees and events —
     * because the point is to coexist with the original (§8.3). Attachment **checksums** are never
     * remapped: the file is the same file, and rewriting them would duplicate every byte on disk.
     */
    const remap = new Map<string, string>()
    const id = (original: string): string => {
      if (input.mode !== 'COPY') return original
      const existing = remap.get(original)
      if (existing) return existing
      const fresh = uuidv7()
      remap.set(original, fresh)
      return fresh
    }

    insertQuizTree(tx, input.quiz, id)
    for (const entry of input.games)
      insertGame(database, tx, entry, id, input.randomBytes)

    return {
      quizId: id(input.quiz.quiz.id),
      rounds: input.quiz.rounds.length,
      questions: input.quiz.questions.length,
      games: input.games.length,
    }
  })
}

function insertQuizTree(tx: KwizTx, file: QuizFile, id: (value: string) => string): void {
  tx.insert(quiz)
    .values({ ...file.quiz, id: id(file.quiz.id) })
    .run()

  for (const row of file.rounds) {
    tx.insert(round)
      .values({ ...row, id: id(row.id), quizId: id(row.quizId) })
      .run()
  }
  for (const row of file.categories) {
    tx.insert(jeopardyCategory)
      .values({ ...row, id: id(row.id), roundId: id(row.roundId) })
      .run()
  }
  for (const row of file.questions) {
    tx.insert(question)
      .values({
        ...row,
        id: id(row.id),
        roundId: id(row.roundId),
        // Nullable: only a board question has one, and `id()` must not invent an id for `null`.
        categoryId: row.categoryId === null ? null : id(row.categoryId),
      })
      .run()
  }
  for (const row of file.keywords) {
    tx.insert(questionKeyword)
      .values({ ...row, id: id(row.id), questionId: id(row.questionId) })
      .run()
  }
  for (const row of file.acceptedAnswers) {
    tx.insert(acceptedAnswer)
      .values({ ...row, id: id(row.id), questionId: id(row.questionId) })
      .run()
  }
  for (const row of file.options) {
    tx.insert(questionOption)
      .values({ ...row, id: id(row.id), questionId: id(row.questionId) })
      .run()
  }
  for (const row of file.attachments) {
    // `checksum` is untouched on purpose — content addressing means the file is already the file.
    tx.insert(attachment)
      .values({ ...row, id: id(row.id), questionId: id(row.questionId) })
      .run()
  }
}

function insertGame(
  database: KwizDatabase,
  tx: KwizTx,
  entry: GameExport,
  id: (value: string) => string,
  randomBytes: (size: number) => Uint8Array,
): void {
  const gameId = id(entry.game.id)

  /**
   * A code must be unique among joinable games (data model §6.1), and the imported one may already
   * belong to a joinable game on this machine — importing a copy alongside its original is the
   * ordinary case (§14.2). A finished game keeps its code, since the index does not constrain it and
   * the code is part of the record.
   */
  const joinable = entry.game.status === 'SETUP' || entry.game.status === 'LIVE'
  const code = joinable ? generateUnusedCode(database, randomBytes) : entry.game.code

  tx.insert(game)
    .values({
      ...entry.game,
      id: gameId,
      code,
      sourceQuizId: entry.game.sourceQuizId === null ? null : id(entry.game.sourceQuizId),
    })
    .run()

  /*
   * `entry.teams` and `entry.devices` are deliberately **not** inserted here.
   *
   * Protocol §8.2 lists them beside the copy subtree, and the export does carry them — a zip should
   * be readable without replaying anything. But in this implementation both are written by
   * `applyProjection` from `TEAM_ADDED` and `DEVICE_JOINED` (CLAUDE.md §2.2: no projection without
   * its event), so they are as derived as `game_answer` is. Inserting them here *and* replaying the
   * log inserts each row twice, which is how the round-trip test found this: `UNIQUE constraint
   * failed: game_team.id`.
   *
   * The log is the truth. Everything it owns is rebuilt below.
   */

  for (const row of entry.copy.rounds) {
    tx.insert(gameRound)
      .values({
        ...row,
        id: id(row.id),
        gameId,
        sourceId: row.sourceId === null ? null : id(row.sourceId),
      })
      .run()
  }
  for (const row of entry.copy.categories) {
    tx.insert(gameJeopardyCategory)
      .values({ ...row, id: id(row.id), gameId, gameRoundId: id(row.gameRoundId) })
      .run()
  }
  for (const row of entry.copy.questions) {
    tx.insert(gameQuestion)
      .values({
        ...row,
        id: id(row.id),
        gameId,
        gameRoundId: id(row.gameRoundId),
        // Nullable: only a board question has one, and `id()` must not invent an id for `null`.
        gameCategoryId: row.gameCategoryId === null ? null : id(row.gameCategoryId),
        // `sourceId` points back at the *template* row, which under COPY was remapped too. Left as
        // it is when the template is not part of this import, and it is `set null` on delete anyway.
        sourceId: row.sourceId === null ? null : id(row.sourceId),
      })
      .run()
  }
  for (const row of entry.copy.keywords) {
    tx.insert(gameQuestionKeyword)
      .values({ ...row, id: id(row.id), gameId, gameQuestionId: id(row.gameQuestionId) })
      .run()
  }
  for (const row of entry.copy.acceptedAnswers) {
    tx.insert(gameAcceptedAnswer)
      .values({ ...row, id: id(row.id), gameId, gameQuestionId: id(row.gameQuestionId) })
      .run()
  }
  for (const row of entry.copy.options) {
    tx.insert(gameQuestionOption)
      .values({ ...row, id: id(row.id), gameId, gameQuestionId: id(row.gameQuestionId) })
      .run()
  }
  for (const row of entry.copy.attachments) {
    tx.insert(gameAttachment)
      .values({ ...row, id: id(row.id), gameId, gameQuestionId: id(row.gameQuestionId) })
      .run()
  }

  /**
   * The log, then the projections rebuilt from it — never the projections from the zip.
   *
   * Payloads are re-validated here even though the writer validated them on append, because
   * conventions §10.1 is explicit that a payload read back from outside this process is untrusted:
   * this one came from another machine's disk, possibly written by an older build. A payload that no
   * longer parses must fail the import loudly rather than corrupt a projection quietly.
   */
  for (const row of entry.events) {
    const event = parseStoredEvent(row)
    /*
     * The code travels in payloads too — `GAME_CREATED` carries it and `CODE_REGENERATED` is nothing
     * but it. Replaying those unchanged sets the code straight back to the source's, undoing the
     * regeneration two lines up and failing on the unique index. The round trip found this by being
     * imported onto the machine it came from: `UNIQUE constraint failed: game.code`.
     *
     * Rewritten rather than re-applied afterwards, because a projection may only be written by its
     * event (CLAUDE.md §2.2) — so the event has to say the true thing.
     */
    const moved = joinable ? withCode(remapEvent(event, id), code) : remapEvent(event, id)

    tx.insert(gameEvent)
      .values({ ...row, id: id(row.id), gameId, payload: moved.payload })
      .run()

    applyProjection(tx, gameId, moved, row.createdAt)
  }
}

/**
 * Event payloads carry ids too, and under `COPY` they must move with everything else — a `TEAM_ADDED`
 * still naming the original team id would rebuild projections pointing at rows that do not exist.
 *
 * Walked structurally rather than per event type, because there are thirty-odd types and one added
 * without a line here would fail silently, on an import, months later.
 *
 * **Only uuid-shaped strings are remapped.** The first version of this remapped every string and
 * turned a team called `Aardappel` into a uuid — the round-trip test caught it by asserting on the
 * names. Shape is the right discriminator: every id in this system is a uuidv7, and no prompt,
 * answer or team name is uuid-shaped. Ids the remap has not seen — a `buzzId`, an adjustment id, all
 * of which are rows *created* by replay rather than inserted above — get a fresh id too, which is
 * what stops "import as a copy" from colliding with the original **on the same machine** (§14.2).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function remapEvent<T extends { type: string; payload: unknown }>(
  event: T,
  id: (value: string) => string,
): T {
  return { ...event, payload: remapValue(event.payload, id) }
}

/** Replaces a `code` field wherever one appears in a payload, at any depth. */
function withCode<T extends { type: string; payload: unknown }>(
  event: T,
  code: string,
): T {
  const payload = event.payload
  if (typeof payload !== 'object' || payload === null || !('code' in payload))
    return event
  return { ...event, payload: { ...Object.fromEntries(Object.entries(payload)), code } }
}

function remapValue(value: unknown, id: (value: string) => string): unknown {
  if (typeof value === 'string') return UUID.test(value) ? id(value) : value
  if (Array.isArray(value)) return value.map((entry) => remapValue(entry, id))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, remapValue(entry, id)]),
    )
  }
  return value
}
