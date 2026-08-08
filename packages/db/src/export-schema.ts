import { getTableColumns } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

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
 * The shape of `quiz.json` and `games.json` (protocol §8), **generated from the tables**.
 *
 * This is exactly the case conventions §10.3 carves out for `drizzle-zod`: the export payload really
 * is "these tables' columns", so generating keeps the two in step automatically. Hand-writing fifteen
 * row schemas would guarantee that the next column added to `question` is silently dropped from every
 * export, and the failure would be a quiz that imports with a field missing and no error anywhere.
 *
 * Contrast with an action body, which §10.3 says must **not** be generated: `submit` takes
 * `{gameQuestionId, text?}`, not a `game_answer` row, and generating from the table would let a
 * client set columns it has no business setting. Here the whole row is the point.
 */

/**
 * JSON has no date type, so every `timestamp_ms` column crosses the wire as an ISO string and must be
 * coerced back on the way in.
 *
 * **Driven by the table's own metadata**, not a hand-kept list of column names. Two reasons: a date
 * column added later is handled with no edit here, and the alternative — a `JSON.parse` reviver that
 * converts anything *looking* like a date — would silently turn a question whose answer is
 * `2026-08-08T18:22:04.000Z` into a `Date` and fail the import with an error about the wrong field.
 * Structure is knowable; string contents are not.
 */
function dateColumnNames(table: SQLiteTable): string[] {
  return Object.entries(getTableColumns(table))
    .filter(([, column]) => column.dataType === 'date')
    .map(([name]) => name)
}

/**
 * Revives before validating, rather than passing per-column refinements to `createSelectSchema`.
 *
 * Both express the same rule; only this one compiles. Handing drizzle-zod a refinement map built at
 * runtime defeats its per-column typing and TypeScript gives up with *"type instantiation is
 * excessively deep"* on a table with a dozen columns. Reviving first keeps the generated schema
 * exactly as generated — every column still validated against the table it came from.
 */
function reviveDates(value: unknown, names: string[]): unknown {
  if (typeof value !== 'object' || value === null) return value

  // `Object.entries` on an object typed `unknown` needs no assertion, unlike spreading it.
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  for (const name of names) {
    const raw = row[name]
    // Only strings are touched. A `null` timestamp stays null, and a number stays a number.
    if (typeof raw === 'string') row[name] = new Date(raw)
  }
  return row
}

/**
 * Generic in the table so `z.infer` below still yields the real row types — the schema stays the one
 * source of truth (conventions §10) and `QuizFile` is inferred from it, not declared beside it.
 *
 * The assertion restates what the generated schema already enforces at runtime: `createSelectSchema`
 * builds its object from this table's columns, so its output *is* `T['$inferSelect']`. TypeScript
 * cannot follow that through `preprocess`, and confining the claim to this one line is why every
 * caller below is plain.
 */
function rowSchema<T extends SQLiteTable>(table: T): z.ZodType<T['$inferSelect']> {
  const names = dateColumnNames(table)
  const generated: z.ZodType = createSelectSchema(table)
  const schema =
    names.length === 0
      ? generated
      : z.preprocess((value) => reviveDates(value, names), generated)

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return schema as z.ZodType<T['$inferSelect']>
}

export const quizFileSchema = z.object({
  quiz: rowSchema(quiz),
  rounds: z.array(rowSchema(round)),
  categories: z.array(rowSchema(jeopardyCategory)),
  questions: z.array(rowSchema(question)),
  keywords: z.array(rowSchema(questionKeyword)),
  acceptedAnswers: z.array(rowSchema(acceptedAnswer)),
  options: z.array(rowSchema(questionOption)),
  attachments: z.array(rowSchema(attachment)),
})

export type QuizFile = z.infer<typeof quizFileSchema>

/**
 * One game: its row, its teams and devices, its **own copy subtree** (data model §5) and its full
 * event log.
 *
 * Projections are absent by design (protocol §8.2) — `game_answer`, `game_buzz`,
 * `game_keyword_mark` and `game_score_adjustment` are rebuilt by replaying `events` on import, which
 * makes every import a live test of invariant I15. `game_answer_draft` is dropped outright: an
 * uncommitted draft is meaningless on a machine the phone that typed it will never reach (§4.8).
 */
export const gameExportSchema = z.object({
  game: rowSchema(game),
  teams: z.array(rowSchema(gameTeam)),
  devices: z.array(rowSchema(gameDevice)),
  copy: z.object({
    rounds: z.array(rowSchema(gameRound)),
    categories: z.array(rowSchema(gameJeopardyCategory)),
    questions: z.array(rowSchema(gameQuestion)),
    keywords: z.array(rowSchema(gameQuestionKeyword)),
    acceptedAnswers: z.array(rowSchema(gameAcceptedAnswer)),
    options: z.array(rowSchema(gameQuestionOption)),
    attachments: z.array(rowSchema(gameAttachment)),
  }),
  events: z.array(rowSchema(gameEvent)),
})

export type GameExport = z.infer<typeof gameExportSchema>

export const gamesFileSchema = z.object({ games: z.array(gameExportSchema) })

export type GamesFile = z.infer<typeof gamesFileSchema>
