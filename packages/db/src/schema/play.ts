import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { v7 as uuidv7 } from 'uuid'

import type { GameEventPayload } from '../events/payload'
import { ANSWER_VERDICTS, BUZZ_OUTCOMES } from './enums'
import { game } from './game'
import { gameQuestion, gameQuestionKeyword, gameQuestionOption } from './game-copy'

/**
 * data model §6 — the play half.
 *
 * `game_event` is the **only source of truth** (D4). The four projection tables are derived
 * caches, existing so the validation queue and review screens are indexed SQL rather than a
 * replay; they are written *exclusively* by `appendAndProject`, in the same transaction as the
 * event append, and can be dropped and rebuilt at any time (I15).
 *
 * > No code path writes a projection without appending the event that caused it. There is one
 * > writer. If you want to `UPDATE game_answer`, the change you want is an event.
 *
 * Exactly two tables escape the log, both narrowly: `game_device.lastSeenAt` and
 * `game_answer_draft`.
 */

const primaryId = () => text('id').primaryKey().$defaultFn(uuidv7)

const gameId = () =>
  text('game_id')
    .notNull()
    .references(() => game.id, { onDelete: 'cascade' })

const now = (column: string) =>
  integer(column, { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())

export const gameTeam = sqliteTable(
  'game_team',
  {
    id: primaryId(),
    gameId: gameId(),
    position: integer('position').notNull(),

    /** Not unique within a game — two teams may genuinely pick the same name (PRD 1 §8.2). */
    name: text('name').notNull(),

    /**
     * Resolved hex, e.g. `#E11D48` — **not** a palette index. Storing the index would let a
     * future palette edit retroactively recolour teams in games already played.
     */
    colour: text('colour').notNull(),

    /** Projected: `sum(answers) + sum(non-revoked adjustments)`. May be negative (D15, I9). */
    score: integer('score').notNull().default(0),

    /**
     * `DSMTW_FINALE` only (D50). Null when the team never played a finale, was not selected as
     * a finalist, or survived it. The **order** of these timestamps produces the final ranking
     * (D51), so it is projected rather than recomputed on every read.
     */
    eliminatedAt: integer('eliminated_at', { mode: 'timestamp_ms' }),

    createdAt: now('created_at'),
  },
  (t) => [index('game_team_game_position_idx').on(t.gameId, t.position)],
)

/** One row per browser playing for a team. Backs the D20 cap and survives a restart. */
export const gameDevice = sqliteTable(
  'game_device',
  {
    id: primaryId(),
    gameId: gameId(),
    teamId: text('team_id')
      .notNull()
      .references(() => gameTeam.id, { onDelete: 'cascade' }),

    /**
     * Opaque high-entropy secret held in `localStorage` and presented on every request. This is
     * device **continuity**, not authentication (PRD 1 §4).
     */
    deviceToken: text('device_token').notNull(),

    firstSeenAt: now('first_seen_at'),

    /**
     * The **only** column in the play half updated in place rather than projected from an
     * event: a heartbeat is not a game fact, and one event per device every few seconds would
     * bloat the log for zero replay value. Nothing in `packages/domain` may read it.
     */
    lastSeenAt: now('last_seen_at'),
  },
  (t) => [
    uniqueIndex('game_device_token_idx').on(t.deviceToken),
    index('game_device_team_idx').on(t.gameId, t.teamId),
  ],
)

/**
 * **Append-only.** No code may `UPDATE` or `DELETE` here. Correcting a misjudged answer or a
 * wrong score is a *new* event — a repeated `ANSWER_VALIDATED`, which supersedes the earlier
 * one, or a `SCORE_ADJUSTED` — never an edit. That is what makes "change whether an answer was
 * correct" auditable rather than destructive.
 */
export const gameEvent = sqliteTable(
  'game_event',
  {
    id: primaryId(),
    gameId: gameId(),

    /**
     * Monotonic from 1, scoped to `gameId` — **not** global (PRD 1 §6.5). Doubles as the SSE
     * event id for `Last-Event-ID` replay, which is why a `seq` from another game must never be
     * compared numerically (CLAUDE.md §2.4).
     */
    seq: integer('seq').notNull(),

    /**
     * The catalogue lives in protocol §4. Deliberately **not** a `text({ enum })` here, so
     * adding an event type needs no migration (§11).
     */
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<GameEventPayload>().notNull(),

    createdAt: now('created_at'),
  },
  (t) => [
    /** The backstop if the synchronous-append assumption is ever violated (§6.4.1 property 2). */
    uniqueIndex('game_event_game_seq_idx').on(t.gameId, t.seq),
  ],
)

/** Projection. One row per `(game, question, team)`. */
export const gameAnswer = sqliteTable(
  'game_answer',
  {
    id: primaryId(),
    gameId: gameId(),
    gameQuestionId: text('game_question_id')
      .notNull()
      .references(() => gameQuestion.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => gameTeam.id, { onDelete: 'cascade' }),

    /** `FREE_TEXT`: the typed answer. Null for `MULTIPLE_CHOICE`, `BUZZER` and `DO`. */
    text: text('text'),

    selectedOptionId: text('selected_option_id').references(() => gameQuestionOption.id, {
      onDelete: 'set null',
    }),

    /** True while only debounced drafts have arrived (D26). Presentation only, never scoring. */
    isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(true),
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),

    /** The master typed it because the team's device could not reach the server (D47). */
    enteredByMaster: integer('entered_by_master', { mode: 'boolean' })
      .notNull()
      .default(false),

    /**
     * A `FREE_TEXT` answer **never** auto-resolves to `AUTO_WRONG`: a non-match becomes
     * `PENDING` and goes to the master (D22). The machine is only ever allowed to be *right*,
     * never to reject. `AUTO_WRONG` exists solely for multiple choice.
     */
    verdict: text('verdict', { enum: ANSWER_VERDICTS }).notNull().default('PENDING'),

    pointsAwarded: integer('points_awarded').notNull().default(0),
    validatedAt: integer('validated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('game_answer_unique_idx').on(t.gameId, t.gameQuestionId, t.teamId),
    index('game_answer_question_idx').on(t.gameQuestionId),
    /** Drives the validation queue: "everything in this game still needing me". */
    index('game_answer_pending_idx').on(t.gameId, t.verdict),
  ],
)

/**
 * Projection. Every buzz, **including those arriving after the lock** — they are the record
 * behind "Team A by 0.04s" and behind any dispute (D35).
 *
 * The lockout set is deliberately not stored: it is derived as "teams with a `DENIED` buzz on
 * this question" and held in memory (§1.1).
 */
export const gameBuzz = sqliteTable(
  'game_buzz',
  {
    id: primaryId(),
    gameId: gameId(),
    gameQuestionId: text('game_question_id')
      .notNull()
      .references(() => gameQuestion.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => gameTeam.id, { onDelete: 'cascade' }),

    /** Server arrival time — the ordering authority (D35, PRD 1 §4). */
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),

    /** Ms from question open. Denormalised because it is what both screens display. */
    offsetMs: integer('offset_ms').notNull(),

    /** At most one `AWAITING` per `(game, question)` (I10). */
    outcome: text('outcome', { enum: BUZZ_OUTCOMES }).notNull(),
  },
  (t) => [index('game_buzz_question_idx').on(t.gameQuestionId, t.receivedAt)],
)

/**
 * Projection. Cannot reuse `game_answer`, which is unique per `(question, team)` — one team may
 * claim several keywords on one question.
 */
export const gameKeywordMark = sqliteTable(
  'game_keyword_mark',
  {
    id: primaryId(),
    gameId: gameId(),
    gameQuestionId: text('game_question_id')
      .notNull()
      .references(() => gameQuestion.id, { onDelete: 'cascade' }),
    gameKeywordId: text('game_keyword_id')
      .notNull()
      .references(() => gameQuestionKeyword.id, { onDelete: 'cascade' }),

    /**
     * Nullable **on purpose**: a revealed-but-unguessed keyword still gets a row, so review can
     * distinguish "nobody got it" from "we never reached that question" (I21).
     */
    teamId: text('team_id').references(() => gameTeam.id, { onDelete: 'cascade' }),

    markedAt: integer('marked_at', { mode: 'timestamp_ms' }).notNull(),

    /**
     * Set by `KEYWORD_UNMARKED`. Revoked rows are excluded from scoring and from the room's
     * view but never deleted (D41) — and it matters here because a wrongly-marked keyword also
     * charged every other team a penalty that must be reversed.
     */
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('game_keyword_mark_unique_idx').on(t.gameKeywordId),
    index('game_keyword_mark_question_idx').on(t.gameQuestionId),
  ],
)

/**
 * **Not** a projection. Debounced in-progress answers (D8), upserted directly and never
 * event-sourced: a draft is not a game fact, keystroke timing is not reproducible by replay,
 * and 20 teams typing would flood the log for zero replay value.
 *
 * Its own table rather than columns on `game_answer`, so that `game_answer` stays a pure
 * projection and **I15 holds with no carve-out**. A real table rather than memory because
 * surviving a server restart is the entire point of D8's safety net.
 */
export const gameAnswerDraft = sqliteTable(
  'game_answer_draft',
  {
    gameId: gameId(),
    gameQuestionId: text('game_question_id')
      .notNull()
      .references(() => gameQuestion.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => gameTeam.id, { onDelete: 'cascade' }),

    text: text('text'),
    selectedOptionId: text('selected_option_id').references(() => gameQuestionOption.id, {
      onDelete: 'set null',
    }),

    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  /** Makes the upsert natural and enforces one draft per team per question. */
  (t) => [primaryKey({ columns: [t.gameQuestionId, t.teamId] })],
)

/**
 * Projection. A **separate line** from question points, never folded into
 * `game_answer.pointsAwarded`, so a team's total always reconciles as
 * `sum(answers) + sum(non-revoked adjustments)` (I9).
 */
export const gameScoreAdjustment = sqliteTable(
  'game_score_adjustment',
  {
    id: primaryId(),
    gameId: gameId(),
    teamId: text('team_id')
      .notNull()
      .references(() => gameTeam.id, { onDelete: 'cascade' }),

    delta: integer('delta').notNull(),
    reason: text('reason'),

    /** False when the master ticked "don't announce" (D25). Suppresses the banner only. */
    announced: integer('announced', { mode: 'boolean' }).notNull().default(true),

    /**
     * Set by `SCORE_ADJUSTMENT_REVOKED` (D41). Excluded from totals but never deleted, so the
     * audit trail reads as "one adjustment, later revoked" rather than two deliberate decisions.
     */
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),

    createdAt: now('created_at'),
  },
  (t) => [index('game_score_adjustment_team_idx').on(t.gameId, t.teamId)],
)
