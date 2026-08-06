import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { v7 as uuidv7 } from 'uuid'

import { game } from './game'
import {
  acceptedAnswerColumns,
  attachmentColumns,
  categoryColumns,
  keywordColumns,
  optionColumns,
  questionColumns,
  roundColumns,
} from './shared'
import { jeopardyCategory, question, round } from './template'

/**
 * data model §5 — a deep copy of the quiz tree, taken once when a game is created (§7) and
 * **never updated afterwards** (I16). This is what delivers PRD 1 §8.1's promise that editing
 * a quiz never alters an already-played game, which a revision number alone cannot, because
 * template rows are mutable.
 *
 * Two deliberate shapes throughout:
 *
 * - **`gameId` on every table**, not just a path up through `game_round`. Denormalised so
 *   "all questions in this game" is one indexed query and deletion is a direct cascade.
 * - **A nullable `sourceId`** with `SET NULL`, so a master can jump from "this question was
 *   ambiguous when we played it" to the template question to fix it — and it goes null
 *   harmlessly if the template is later deleted.
 */

const primaryId = () => text('id').primaryKey().$defaultFn(uuidv7)

const gameId = () =>
  text('game_id')
    .notNull()
    .references(() => game.id, { onDelete: 'cascade' })

export const gameRound = sqliteTable(
  'game_round',
  {
    id: primaryId(),
    gameId: gameId(),
    sourceId: text('source_id').references(() => round.id, { onDelete: 'set null' }),
    ...roundColumns(),
  },
  (t) => [index('game_round_game_position_idx').on(t.gameId, t.position)],
)

export const gameJeopardyCategory = sqliteTable(
  'game_jeopardy_category',
  {
    id: primaryId(),
    gameId: gameId(),
    gameRoundId: text('game_round_id')
      .notNull()
      .references(() => gameRound.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').references(() => jeopardyCategory.id, {
      onDelete: 'set null',
    }),
    ...categoryColumns(),
  },
  (t) => [
    index('game_jeopardy_category_round_position_idx').on(t.gameRoundId, t.position),
  ],
)

export const gameQuestion = sqliteTable(
  'game_question',
  {
    id: primaryId(),
    gameId: gameId(),
    gameRoundId: text('game_round_id')
      .notNull()
      .references(() => gameRound.id, { onDelete: 'cascade' }),
    gameCategoryId: text('game_category_id').references(() => gameJeopardyCategory.id, {
      onDelete: 'cascade',
    }),
    sourceId: text('source_id').references(() => question.id, { onDelete: 'set null' }),
    ...questionColumns(),
  },
  (t) => [
    index('game_question_round_position_idx').on(t.gameRoundId, t.position),
    index('game_question_category_position_idx').on(t.gameCategoryId, t.position),
    index('game_question_game_idx').on(t.gameId),
  ],
)

/*
 * No `sourceId` on the three tables below. Navigating back to the template is only useful at
 * question granularity — a master fixes *a question*, not *an option* — and three more
 * nullable FKs would be maintenance for no user-visible capability.
 */

const gameQuestionId = () =>
  text('game_question_id')
    .notNull()
    .references(() => gameQuestion.id, { onDelete: 'cascade' })

export const gameAcceptedAnswer = sqliteTable(
  'game_accepted_answer',
  {
    id: primaryId(),
    gameId: gameId(),
    gameQuestionId: gameQuestionId(),
    ...acceptedAnswerColumns(),
  },
  (t) => [index('game_accepted_answer_question_idx').on(t.gameQuestionId, t.position)],
)

export const gameQuestionOption = sqliteTable(
  'game_question_option',
  {
    id: primaryId(),
    gameId: gameId(),
    gameQuestionId: gameQuestionId(),
    ...optionColumns(),
  },
  (t) => [index('game_question_option_question_idx').on(t.gameQuestionId, t.position)],
)

export const gameQuestionKeyword = sqliteTable(
  'game_question_keyword',
  {
    id: primaryId(),
    gameId: gameId(),
    gameQuestionId: gameQuestionId(),
    ...keywordColumns(),
  },
  (t) => [index('game_question_keyword_question_idx').on(t.gameQuestionId, t.position)],
)

/** One row per `(question, attachment)`. The *file* is deduplicated by checksum (§8, Q6). */
export const gameAttachment = sqliteTable(
  'game_attachment',
  {
    id: primaryId(),
    gameId: gameId(),
    gameQuestionId: gameQuestionId(),
    ...attachmentColumns(),
  },
  (t) => [
    index('game_attachment_question_idx').on(t.gameQuestionId, t.position),
    index('game_attachment_checksum_idx').on(t.checksum),
  ],
)
