import { and, asc, eq, inArray } from 'drizzle-orm'

import type { KwizDatabase } from './client'
import type { GameExport, QuizFile } from './export-schema'
import {
  acceptedAnswer,
  attachment,
  game,
  gameAcceptedAnswer,
  gameAttachment,
  gameDevice,
  gameEvent,
  gameJeopardyCategory,
  gameQuestion,
  gameQuestionKeyword,
  gameQuestionOption,
  gameRound,
  gameTeam,
  jeopardyCategory,
  question,
  questionKeyword,
  questionOption,
  quiz,
  round,
} from './schema'

/**
 * Gathering the rows behind protocol §8's `quiz.json` and `games.json`.
 *
 * **Read in dependency order and filtered by the parent's ids**, not by a join: the import inserts in
 * the same order, so an export that gathered rows a different way would be an import that violates a
 * foreign key. Reading `question` by its rounds' ids rather than by walking a join also means a
 * question orphaned by a bug is simply absent from the export rather than silently duplicated.
 */

export interface QuizExport {
  quiz: QuizFile
  games: GameExport[]
  /** Every checksum the zip must carry, from both halves — the file list, deduplicated. */
  attachments: { checksum: string; ext: string; sizeBytes: number }[]
}

export function collectQuizExport(
  database: KwizDatabase,
  quizId: string,
  options: {
    includeGames: boolean
    includeAttachments: boolean
    /**
     * PRD 2 §14.1's *"Export this game"* — **quiz + this game only**, from the game hub's overflow
     * menu. Absent means every game the quiz has, which is what the quiz-level dialog asks for.
     */
    onlyGameId?: string
  },
): QuizExport | undefined {
  const { db } = database

  const quizRow = db.select().from(quiz).where(eq(quiz.id, quizId)).get()
  if (!quizRow) return undefined

  const rounds = db
    .select()
    .from(round)
    .where(eq(round.quizId, quizId))
    .orderBy(asc(round.position))
    .all()
  const roundIds = rounds.map((row) => row.id)

  const categories = ids(roundIds, (list) =>
    db
      .select()
      .from(jeopardyCategory)
      .where(inArray(jeopardyCategory.roundId, list))
      .all(),
  )
  const questions = ids(roundIds, (list) =>
    db
      .select()
      .from(question)
      .where(inArray(question.roundId, list))
      .orderBy(asc(question.position))
      .all(),
  )
  const questionIds = questions.map((row) => row.id)

  const quizFile: QuizFile = {
    quiz: quizRow,
    rounds,
    categories,
    questions,
    keywords: ids(questionIds, (list) =>
      db
        .select()
        .from(questionKeyword)
        .where(inArray(questionKeyword.questionId, list))
        .all(),
    ),
    acceptedAnswers: ids(questionIds, (list) =>
      db
        .select()
        .from(acceptedAnswer)
        .where(inArray(acceptedAnswer.questionId, list))
        .all(),
    ),
    options: ids(questionIds, (list) =>
      db
        .select()
        .from(questionOption)
        .where(inArray(questionOption.questionId, list))
        .all(),
    ),
    attachments: ids(questionIds, (list) =>
      db.select().from(attachment).where(inArray(attachment.questionId, list)).all(),
    ),
  }

  const games = options.includeGames
    ? collectGames(database, quizId, options.onlyGameId)
    : []

  /**
   * Both halves contribute, because a game copy may reference a file whose template row has since
   * been deleted (data model §8) — the whole reason deleting a template attachment is safe. Leaving
   * those out would export a game that cannot play its own media.
   */
  const files = new Map<string, { checksum: string; ext: string; sizeBytes: number }>()
  if (options.includeAttachments) {
    for (const row of quizFile.attachments) {
      files.set(row.checksum, {
        checksum: row.checksum,
        ext: row.ext,
        sizeBytes: row.sizeBytes,
      })
    }
    for (const entry of games) {
      for (const row of entry.copy.attachments) {
        files.set(row.checksum, {
          checksum: row.checksum,
          ext: row.ext,
          sizeBytes: row.sizeBytes,
        })
      }
    }
  }

  return { quiz: quizFile, games, attachments: [...files.values()] }
}

function collectGames(
  database: KwizDatabase,
  quizId: string,
  onlyGameId?: string,
): GameExport[] {
  const { db } = database

  const rows = db
    .select()
    .from(game)
    .where(
      onlyGameId === undefined
        ? eq(game.sourceQuizId, quizId)
        : and(eq(game.sourceQuizId, quizId), eq(game.id, onlyGameId)),
    )
    .all()

  return rows.map((gameRow) => {
    // Every game-copy table carries `gameId` (data model §5), so each is one predicate — no walking
    // down from rounds to questions the way the template half has to.
    const id = gameRow.id

    return {
      game: gameRow,
      teams: db
        .select()
        .from(gameTeam)
        .where(eq(gameTeam.gameId, gameRow.id))
        .orderBy(asc(gameTeam.position))
        .all(),
      // Exported so a device's team binding survives a machine move (protocol §8.2). The tokens are
      // meaningless on a machine those phones will never reach, but they keep replay faithful.
      devices: db
        .select()
        .from(gameDevice)
        .where(eq(gameDevice.gameId, gameRow.id))
        .all(),
      copy: {
        rounds: db
          .select()
          .from(gameRound)
          .where(eq(gameRound.gameId, id))
          .orderBy(asc(gameRound.position))
          .all(),
        categories: db
          .select()
          .from(gameJeopardyCategory)
          .where(eq(gameJeopardyCategory.gameId, id))
          .all(),
        questions: db
          .select()
          .from(gameQuestion)
          .where(eq(gameQuestion.gameId, id))
          .orderBy(asc(gameQuestion.position))
          .all(),
        keywords: db
          .select()
          .from(gameQuestionKeyword)
          .where(eq(gameQuestionKeyword.gameId, id))
          .all(),
        acceptedAnswers: db
          .select()
          .from(gameAcceptedAnswer)
          .where(eq(gameAcceptedAnswer.gameId, id))
          .all(),
        options: db
          .select()
          .from(gameQuestionOption)
          .where(eq(gameQuestionOption.gameId, id))
          .all(),
        attachments: db
          .select()
          .from(gameAttachment)
          .where(eq(gameAttachment.gameId, id))
          .all(),
      },
      // `seq` order is the log's order, and replay depends on it (data model §6.4).
      events: db
        .select()
        .from(gameEvent)
        .where(eq(gameEvent.gameId, gameRow.id))
        .orderBy(asc(gameEvent.seq))
        .all(),
    }
  })
}

/**
 * `inArray` with an empty list generates `in ()`, which SQLite rejects as a syntax error — so an
 * empty parent list short-circuits. It is the ordinary case, not an edge one: a quiz with a round
 * that has no questions yet reaches this on every export.
 */
function ids<T>(parents: string[], query: (list: string[]) => T[]): T[] {
  return parents.length === 0 ? [] : query(parents)
}
