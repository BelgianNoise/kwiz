import { MAIN_SCREEN_COLOUR_SCHEMES, MAIN_SCREEN_TYPOGRAPHIES } from '@kwiz/domain'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { v7 as uuidv7 } from 'uuid'

import {
  acceptedAnswerColumns,
  attachmentColumns,
  categoryColumns,
  keywordColumns,
  optionColumns,
  questionColumns,
  roundColumns,
} from './shared'

/**
 * data model §4 — the template half. Ordinary **mutable** rows: a master edits their quiz and
 * rows change. Editing one never alters an already-played game, because a game owns a deep
 * copy (§5, PRD 1 §8.1).
 */

const primaryId = () => text('id').primaryKey().$defaultFn(uuidv7)
const createdAt = (column: string) =>
  integer(column, { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())

export const quiz = sqliteTable('quiz', {
  id: primaryId(),
  name: text('name').notNull(),
  description: text('description'),

  /**
   * PRD 4 §5.1 / D60 — the default copied onto every game created from this quiz (PRD 2 §6). A
   * game may override its own copy afterwards (`game.mainScreenColourScheme`/`mainScreenTypography`
   * plus `MAIN_SCREEN_THEME_SET`); this column never changes retroactively for a played game.
   */
  mainScreenColourScheme: text('main_screen_colour_scheme', {
    enum: MAIN_SCREEN_COLOUR_SCHEMES,
  })
    .notNull()
    .default('BROADCAST'),
  mainScreenTypography: text('main_screen_typography', { enum: MAIN_SCREEN_TYPOGRAPHIES })
    .notNull()
    .default('IMPACT'),

  /**
   * Bumped on every save of the quiz **or any descendant**, so import collision handling (D9)
   * can show the master which side is newer. Enforced in the repository layer — a schema
   * cannot express "a descendant changed".
   */
  revision: integer('revision').notNull().default(1),

  createdAt: createdAt('created_at'),
  updatedAt: createdAt('updated_at'),
})

export const round = sqliteTable(
  'round',
  {
    id: primaryId(),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quiz.id, { onDelete: 'cascade' }),
    ...roundColumns(),
  },
  (t) => [index('round_quiz_position_idx').on(t.quizId, t.position)],
)

/** Board columns; `JEOPARDY` rounds only. */
export const jeopardyCategory = sqliteTable(
  'jeopardy_category',
  {
    id: primaryId(),
    roundId: text('round_id')
      .notNull()
      .references(() => round.id, { onDelete: 'cascade' }),
    ...categoryColumns(),
  },
  (t) => [index('jeopardy_category_round_position_idx').on(t.roundId, t.position)],
)

export const question = sqliteTable(
  'question',
  {
    id: primaryId(),
    roundId: text('round_id')
      .notNull()
      .references(() => round.id, { onDelete: 'cascade' }),

    /** `JEOPARDY` only — which board column this tile sits in. Null otherwise (I1). */
    categoryId: text('category_id').references(() => jeopardyCategory.id, {
      onDelete: 'cascade',
    }),

    ...questionColumns(),
  },
  (t) => [
    index('question_round_position_idx').on(t.roundId, t.position),
    index('question_category_position_idx').on(t.categoryId, t.position),
  ],
)

/** `DSMTW_FINALE` only — exactly 5 rows per question, positions 0–4 (I17, D50). */
export const questionKeyword = sqliteTable(
  'question_keyword',
  {
    id: primaryId(),
    questionId: text('question_id')
      .notNull()
      .references(() => question.id, { onDelete: 'cascade' }),
    ...keywordColumns(),
  },
  (t) => [index('question_keyword_question_idx').on(t.questionId, t.position)],
)

/**
 * An array from day one even where v1's UI shows one field (D33): retrofitting one-to-many
 * later would touch the schema, the export format, the matcher, the validation queue and the
 * authoring form.
 *
 * `FREE_TEXT` auto-matches lowercase+trim against *any* row (D22). `BUZZER` is reference only
 * — shown to the master for adjudication and at reveal, never auto-matched, because nothing
 * was typed.
 */
export const acceptedAnswer = sqliteTable(
  'accepted_answer',
  {
    id: primaryId(),
    questionId: text('question_id')
      .notNull()
      .references(() => question.id, { onDelete: 'cascade' }),
    ...acceptedAnswerColumns(),
  },
  (t) => [index('accepted_answer_question_idx').on(t.questionId, t.position)],
)

/** `MULTIPLE_CHOICE` only, 2–4 rows, exactly one correct (I4). */
export const questionOption = sqliteTable(
  'question_option',
  {
    id: primaryId(),
    questionId: text('question_id')
      .notNull()
      .references(() => question.id, { onDelete: 'cascade' }),
    ...optionColumns(),
  },
  (t) => [index('question_option_question_idx').on(t.questionId, t.position)],
)

/** Metadata only; bytes are content-addressed on disk by SHA-256 (§8). */
export const attachment = sqliteTable(
  'attachment',
  {
    id: primaryId(),
    questionId: text('question_id')
      .notNull()
      .references(() => question.id, { onDelete: 'cascade' }),
    ...attachmentColumns(),
    createdAt: createdAt('created_at'),
  },
  (t) => [
    index('attachment_question_idx').on(t.questionId, t.position),
    index('attachment_checksum_idx').on(t.checksum),
  ],
)
