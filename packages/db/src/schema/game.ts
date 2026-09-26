import {
  GAME_STATUSES,
  LOCALES,
  MAIN_SCREEN_COLOUR_SCHEMES,
  MAIN_SCREEN_TYPOGRAPHIES,
} from '@kwiz/domain'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { v7 as uuidv7 } from 'uuid'

import { quiz } from './template'

/**
 * data model §6.1. Its own module because the game-copy tables all carry `gameId`, and the
 * rest of the play half references *them* — one file for `game` breaks what would otherwise
 * be a circular import.
 */
export const game = sqliteTable(
  'game',
  {
    id: text('id').primaryKey().$defaultFn(uuidv7),

    /**
     * Nullable and `SET NULL`: a game is fully self-contained in the game-copy tables, so
     * deleting a template must not destroy played history (§10).
     */
    sourceQuizId: text('source_quiz_id').references(() => quiz.id, {
      onDelete: 'set null',
    }),

    /** Denormalised at creation, so a game still displays after its template is renamed. */
    quizName: text('quiz_name').notNull(),
    quizRevision: integer('quiz_revision').notNull(),

    /** Human-readable join handle, **not** an identifier. Regenerable while `SETUP`. */
    code: text('code').notNull(),

    /** Projected from events, duplicated here so the dashboard lists games without replay. */
    status: text('status', { enum: GAME_STATUSES }).notNull().default('SETUP'),

    /** Overrides `en` for devices joining; never overrides a player's explicit choice (D29). */
    defaultPlayerLocale: text('default_player_locale', { enum: LOCALES })
      .notNull()
      .default('en'),

    /**
     * PRD 4 §5.1 / D60 — the quiz's default at creation. Write-once, like the rest of the game
     * copy (I16): a later change goes through `MAIN_SCREEN_THEME_SET` and lives only in the
     * in-memory projection (`GameState.mainScreenThemeOverride`), the same shape as the finale's
     * authored-default-plus-event-override (D54) — never an `UPDATE` on this row.
     */
    mainScreenColourScheme: text('main_screen_colour_scheme', {
      enum: MAIN_SCREEN_COLOUR_SCHEMES,
    })
      .notNull()
      .default('BROADCAST'),
    mainScreenTypography: text('main_screen_typography', {
      enum: MAIN_SCREEN_TYPOGRAPHIES,
    })
      .notNull()
      .default('IMPACT'),

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    /**
     * Codes are unique only among **joinable** games (PRD 1 §8.10), so finished codes recycle.
     * A partial unique index says exactly that; a plain unique constraint would exhaust the
     * code space over time.
     */
    uniqueIndex('game_active_code_idx')
      .on(t.code)
      .where(sql`status IN ('SETUP','LIVE')`),
    index('game_quiz_status_idx').on(t.sourceQuizId, t.status),
  ],
)
