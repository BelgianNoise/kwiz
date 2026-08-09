import { fail, ok, type ActionResult, type Locale } from '@kwiz/domain'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import { appendAndProject } from './append'
import type { KwizDatabase, KwizTx } from './client'
import {
  acceptedAnswer,
  attachment,
  game,
  gameAcceptedAnswer,
  gameAnswer,
  gameAttachment,
  gameBuzz,
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
import {
  acceptedAnswerColumns,
  attachmentColumns,
  categoryColumns,
  keywordColumns,
  optionColumns,
  questionColumns,
  roundColumns,
} from './schema/shared'

/**
 * data model §7 — creating a game from a template, and §7.1 re-syncing one.
 *
 * **Every shared column is moved by spreading the §3 factory's key list**, never by a hand-written
 * field list. That is what makes the §7.2 column-parity guard pass by construction: a column added
 * to `questionColumns()` appears on both tables *and* is carried by the copy, with nothing to
 * remember. The guard exists to catch someone hand-rolling this later.
 *
 * Everything happens in **one transaction**, including the event: a half-copied game is unplayable
 * and hard to detect, and a copy that committed without its `GAME_CREATED` would be a game the
 * event log does not know about.
 */

/**
 * The shared column names for one factory (data model §3), read off the object it builds.
 *
 * Reflection rather than a hand-written list, which is the whole point: §7.2's parity guard exists
 * because a hand-written list is what silently loses a column, and a copy driven by the factory's own
 * keys passes it by construction.
 */
export function sharedKeys<T extends Record<string, unknown>>(
  factory: () => T,
): (keyof T & string)[] {
  return Object.keys(factory())
}

export function pickShared<K extends string, Row extends Record<K, unknown>>(
  row: Row,
  keys: readonly K[],
): Pick<Row, K> {
  const picked: Partial<Record<K, unknown>> = {}
  for (const key of keys) picked[key] = row[key]
  // Built key by key from `keys`, so it holds exactly those properties — which the accumulator's
  // type cannot express while it is being filled.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return picked as Pick<Row, K>
}

/**
 * Exported (but not re-exported from `./index`, so this stays package-internal) because
 * `authoring.ts`'s `duplicateQuiz` — template→template rather than this module's template→game-copy
 * — needs the identical guarantee: every shared column moved by its own key list, never by a
 * hand-written field list a future column can be silently missing from.
 */
export const ROUND_KEYS = sharedKeys(roundColumns)
export const CATEGORY_KEYS = sharedKeys(categoryColumns)
export const QUESTION_KEYS = sharedKeys(questionColumns)
export const ACCEPTED_ANSWER_KEYS = sharedKeys(acceptedAnswerColumns)
export const OPTION_KEYS = sharedKeys(optionColumns)
export const KEYWORD_KEYS = sharedKeys(keywordColumns)
export const ATTACHMENT_KEYS = sharedKeys(attachmentColumns)

export interface NewTeam {
  name: string
  /** Resolved hex from conventions §3's palette, never an index (data model §6.2). */
  colour: string
}

export interface CreateGameOptions {
  quizId: string
  /** Generated with `generateUnusedCode`, so the partial unique index never has to reject it. */
  code: string
  defaultPlayerLocale?: Locale
  teams?: readonly NewTeam[]
}

export interface CreatedGame {
  gameId: string
  teamIds: string[]
}

export function createGameFromQuiz(
  database: KwizDatabase,
  options: CreateGameOptions,
  now: () => Date = () => new Date(),
): ActionResult<CreatedGame> {
  const template = database.db
    .select({ id: quiz.id, name: quiz.name, revision: quiz.revision })
    .from(quiz)
    .where(eq(quiz.id, options.quizId))
    .get()
  if (!template) return fail('SOURCE_QUIZ_DELETED', `no quiz ${options.quizId}`)

  const gameId = uuidv7()
  const teams = (options.teams ?? []).map((team, position) => ({
    teamId: uuidv7(),
    name: team.name,
    colour: team.colour,
    position,
  }))

  appendAndProject(
    database,
    gameId,
    [
      {
        type: 'GAME_CREATED',
        payload: {
          quizName: template.name,
          quizRevision: template.revision,
          code: options.code,
        },
      },
      ...teams.map((team) => ({ type: 'TEAM_ADDED' as const, payload: team })),
    ],
    now,
    (tx) => {
      // The game row first: `game_event.gameId` references it, and `foreign_keys = ON` means the
      // order genuinely matters.
      tx.insert(game)
        .values({
          id: gameId,
          sourceQuizId: template.id,
          quizName: template.name,
          quizRevision: template.revision,
          code: options.code,
          status: 'SETUP',
          ...(options.defaultPlayerLocale === undefined
            ? {}
            : { defaultPlayerLocale: options.defaultPlayerLocale }),
          createdAt: now(),
        })
        .run()

      copyQuizTree(tx, gameId, options.quizId)
    },
  )

  return ok({ gameId, teamIds: teams.map((team) => team.teamId) })
}

/**
 * data model §7.1 — a master who has typed eight team names and shown the QR code should not lose
 * all of it to fix one typo in the quiz.
 *
 * **Teams and devices survive** because they reference neither questions nor rounds: a team is bound
 * to the game, a device to a team. Players who joined during setup stay joined and never notice.
 *
 * The two row-count checks are deliberately redundant with the status check. Status is a *projected*
 * column, while the row counts are the actual thing that makes a re-sync unsafe — answers and buzzes
 * reference copy rows this is about to delete — and asserting on the real condition costs one query.
 */
export function resyncGame(
  database: KwizDatabase,
  gameId: string,
  now: () => Date = () => new Date(),
): ActionResult<{ quizRevision: number }> {
  const row = database.db
    .select({
      status: game.status,
      sourceQuizId: game.sourceQuizId,
    })
    .from(game)
    .where(eq(game.id, gameId))
    .get()
  if (!row) return fail('GAME_NOT_FOUND', `no game ${gameId}`)
  if (row.status !== 'SETUP') return fail('NOT_IN_SETUP', `game is ${row.status}`)
  if (row.sourceQuizId === null) {
    return fail('SOURCE_QUIZ_DELETED', 'this game has no template to re-sync from')
  }
  const quizId = row.sourceQuizId

  const anyAnswer = database.db
    .select({ id: gameAnswer.id })
    .from(gameAnswer)
    .where(eq(gameAnswer.gameId, gameId))
    .get()
  const anyBuzz = database.db
    .select({ id: gameBuzz.id })
    .from(gameBuzz)
    .where(eq(gameBuzz.gameId, gameId))
    .get()
  if (anyAnswer || anyBuzz) {
    return fail('RESYNC_BLOCKED', 'this game already has answers or buzzes')
  }

  const template = database.db
    .select({ name: quiz.name, revision: quiz.revision })
    .from(quiz)
    .where(eq(quiz.id, quizId))
    .get()
  if (!template) return fail('SOURCE_QUIZ_DELETED', `no quiz ${quizId}`)

  appendAndProject(
    database,
    gameId,
    [{ type: 'GAME_RESYNCED', payload: { quizRevision: template.revision } }],
    now,
    (tx) => {
      // Deleting the rounds cascades through categories, questions and everything under them, so
      // this is the whole copy subtree in one statement — and `foreign_keys = ON` is what makes it
      // true rather than hopeful.
      tx.delete(gameRound).where(eq(gameRound.gameId, gameId)).run()
      copyQuizTree(tx, gameId, quizId)
      // `GAME_RESYNCED`'s projection carries the revision; the denormalised name is this function's.
      tx.update(game).set({ quizName: template.name }).where(eq(game.id, gameId)).run()
    },
  )

  return ok({ quizRevision: template.revision })
}

/**
 * §7 steps 2–7. Parents before children, with an `oldId → newId` map per level, because **copies
 * never reuse a template id** — a template row and its copy have to coexist and be tellable apart.
 *
 * No attachment bytes are copied: the copy shares the file by checksum (§8), so a game with 2 GB of
 * video costs zero bytes.
 */
function copyQuizTree(tx: KwizTx, gameId: string, quizId: string): void {
  const rounds = tx
    .select()
    .from(round)
    .where(eq(round.quizId, quizId))
    .orderBy(round.position)
    .all()

  const roundIds = new Map<string, string>()
  for (const source of rounds) {
    const id = uuidv7()
    roundIds.set(source.id, id)
    tx.insert(gameRound)
      .values({ id, gameId, sourceId: source.id, ...pickShared(source, ROUND_KEYS) })
      .run()
  }

  const categoryIds = new Map<string, string>()
  for (const [sourceRoundId, gameRoundId] of roundIds) {
    const categories = tx
      .select()
      .from(jeopardyCategory)
      .where(eq(jeopardyCategory.roundId, sourceRoundId))
      .orderBy(jeopardyCategory.position)
      .all()
    for (const source of categories) {
      const id = uuidv7()
      categoryIds.set(source.id, id)
      tx.insert(gameJeopardyCategory)
        .values({
          id,
          gameId,
          gameRoundId,
          sourceId: source.id,
          ...pickShared(source, CATEGORY_KEYS),
        })
        .run()
    }
  }

  for (const [sourceRoundId, gameRoundId] of roundIds) {
    const questions = tx
      .select()
      .from(question)
      .where(eq(question.roundId, sourceRoundId))
      .orderBy(question.position)
      .all()

    for (const source of questions) {
      const gameQuestionId = uuidv7()
      tx.insert(gameQuestion)
        .values({
          id: gameQuestionId,
          gameId,
          gameRoundId,
          // Remapped, not carried: the tile has to point at *this game's* board column (I1).
          gameCategoryId:
            source.categoryId === null
              ? null
              : (categoryIds.get(source.categoryId) ?? null),
          sourceId: source.id,
          ...pickShared(source, QUESTION_KEYS),
        })
        .run()

      for (const child of tx
        .select()
        .from(acceptedAnswer)
        .where(eq(acceptedAnswer.questionId, source.id))
        .orderBy(acceptedAnswer.position)
        .all()) {
        tx.insert(gameAcceptedAnswer)
          .values({
            id: uuidv7(),
            gameId,
            gameQuestionId,
            ...pickShared(child, ACCEPTED_ANSWER_KEYS),
          })
          .run()
      }

      for (const child of tx
        .select()
        .from(questionOption)
        .where(eq(questionOption.questionId, source.id))
        .orderBy(questionOption.position)
        .all()) {
        tx.insert(gameQuestionOption)
          .values({
            id: uuidv7(),
            gameId,
            gameQuestionId,
            ...pickShared(child, OPTION_KEYS),
          })
          .run()
      }

      for (const child of tx
        .select()
        .from(questionKeyword)
        .where(eq(questionKeyword.questionId, source.id))
        .orderBy(questionKeyword.position)
        .all()) {
        tx.insert(gameQuestionKeyword)
          .values({
            id: uuidv7(),
            gameId,
            gameQuestionId,
            ...pickShared(child, KEYWORD_KEYS),
          })
          .run()
      }

      for (const child of tx
        .select()
        .from(attachment)
        .where(eq(attachment.questionId, source.id))
        .orderBy(attachment.position)
        .all()) {
        tx.insert(gameAttachment)
          .values({
            id: uuidv7(),
            gameId,
            gameQuestionId,
            // The same checksum, so the file on disk is shared rather than copied (§8).
            ...pickShared(child, ATTACHMENT_KEYS),
          })
          .run()
      }
    }
  }
}
