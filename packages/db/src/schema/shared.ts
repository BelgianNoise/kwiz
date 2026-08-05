import { integer, text } from 'drizzle-orm/sqlite-core'

import { ANSWER_METHODS, ATTACHMENT_KINDS, ROUND_TYPES } from './enums'
import type { QuestionConfig, RoundConfig, WordLengths } from './json'

/**
 * data model §3 — the columns seven template tables share with their game-scoped twin.
 *
 * **These MUST be factories, not plain objects.** Drizzle column builders are stateful and
 * are consumed when a table is constructed; reusing one builder instance across two tables
 * produces subtly wrong schemas. Call the factory once per table.
 *
 * Maintaining two parallel definitions by hand is how a column gets added to `question` and
 * forgotten in `game_question` — silent data loss in every game created afterwards. Adding a
 * column here adds it to both, and Drizzle Kit generates both migrations (§11).
 *
 * Only identity and parentage differ between a table and its twin; that difference is written
 * out explicitly in each table. `columnParity` in `./parity.ts` is the guard.
 */

export const questionColumns = () => ({
  position: integer('position').notNull(),
  prompt: text('prompt').notNull(),
  answerMethod: text('answer_method', { enum: ANSWER_METHODS }).notNull(),

  /** A Jeopardy tile's board value; also the per-team maximum for `PER_TEAM_SCORE` (D24). */
  points: integer('points').notNull(),

  /** Null means *inherit the round default*. Zero is invalid, not "no timer" (I12). */
  timerMs: integer('timer_ms'),

  /** Never leaves `MASTER_CONTROL` or `CONFIG` (PRD 1 §7 invariant 7). */
  masterNotes: text('master_notes'),

  config: text('config', { mode: 'json' }).$type<QuestionConfig>().notNull(),
})

export const roundColumns = () => ({
  position: integer('position').notNull(),
  type: text('type', { enum: ROUND_TYPES }).notNull(),
  title: text('title').notNull(),
  defaultPoints: integer('default_points').notNull().default(10),
  defaultTimerMs: integer('default_timer_ms'),
  config: text('config', { mode: 'json' }).$type<RoundConfig>().notNull(),
})

export const attachmentColumns = () => ({
  position: integer('position').notNull(),
  kind: text('kind', { enum: ATTACHMENT_KINDS }).notNull(),
  mimeType: text('mime_type').notNull(),

  /** Display metadata **only**, never used to build a path (§4.7). */
  originalName: text('original_name').notNull(),

  /** Derived from the *detected* type, never from the uploaded filename. */
  ext: text('ext').notNull(),

  sizeBytes: integer('size_bytes').notNull(),

  /** SHA-256, and also the on-disk filename (§8). */
  checksum: text('checksum').notNull(),

  /** `IMAGE` only; audio and video are main-screen-only and not configurable (D27, I3). */
  showOnPlayerDevices: integer('show_on_player_devices', { mode: 'boolean' })
    .notNull()
    .default(false),

  durationMs: integer('duration_ms'),
})

export const optionColumns = () => ({
  position: integer('position').notNull(),
  text: text('text').notNull(),

  /**
   * **The most dangerous column in this schema** (§4.6). It must never reach a `PLAYER` or
   * `MAIN_SCREEN` payload before `REVEALED` (PRD 1 §7 invariant 2) — and not merely as
   * `false`: it is *absent from the projection*. Option identity is a UUID precisely so a
   * client can submit a choice without the server having sent anything that ranks the options.
   */
  isCorrect: integer('is_correct', { mode: 'boolean' }).notNull().default(false),
})

export const acceptedAnswerColumns = () => ({
  /** `position = 0` is the canonical answer shown at reveal; the rest are alternatives. */
  position: integer('position').notNull(),
  text: text('text').notNull(),
})

export const keywordColumns = () => ({
  /** 0–4; exactly 5 per question (I17). */
  position: integer('position').notNull(),

  /** NEVER sent to the room while unguessed (D53). */
  text: text('text').notNull(),

  /**
   * Character count per word — the shape of the phrase without any of its characters.
   * Derived from `text` on write (I19) and stored, so the payload filter selects this and
   * never loads `text` at all until the keyword is marked. That is the difference between a
   * rule and a guarantee.
   */
  wordLengths: text('word_lengths', { mode: 'json' }).$type<WordLengths>().notNull(),
})

export const categoryColumns = () => ({
  position: integer('position').notNull(),
  name: text('name').notNull(),
})
