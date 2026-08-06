import { z } from 'zod'

import {
  DO_SCORING_MODES,
  TIE_PAYOUTS,
  type AnswerMethod,
  type RoundType,
} from './vocabulary'

/**
 * Every JSON column's validator. data model §2: **a JSON column without a validator is a
 * bug**, and I6 requires `config` to validate against the schema for its `answerMethod` or
 * `type`.
 *
 * The discriminator lives in a *sibling column*, not inside the JSON, so these cannot be one
 * `z.discriminatedUnion`. They are looked up by that sibling instead — hence the two maps at
 * the bottom, which are the only correct way to validate one of these columns.
 */

/** Nothing configurable. `strict()` so a stray key is a failure, not silent baggage. */
const noConfigSchema = z.strictObject({})

// ─── question.config ───

/** conventions §10's worked example. `DO` is the only method with settings (D24). */
export const doConfigSchema = z.strictObject({
  scoringMode: z.enum(DO_SCORING_MODES),
  tiePayout: z.enum(TIE_PAYOUTS).default('FULL'),
})
export type DoConfig = z.infer<typeof doConfigSchema>

export const questionConfigSchemaByMethod = {
  FREE_TEXT: noConfigSchema,
  MULTIPLE_CHOICE: noConfigSchema,
  BUZZER: noConfigSchema,
  DO: doConfigSchema,
  KEYWORDS: noConfigSchema,
} as const satisfies Record<AnswerMethod, z.ZodType>

export type QuestionConfig = z.infer<typeof noConfigSchema> | DoConfig

// ─── round.config ───

export const jeopardyRoundConfigSchema = z.strictObject({
  /** Authoring default for new tiles (data model §4.2). Board values, so positive integers. */
  valueLadder: z.array(z.number().int().positive()).min(1),
})
export type JeopardyRoundConfig = z.infer<typeof jeopardyRoundConfigSchema>

/**
 * Authoring **defaults** only. The live values arrive via `FINALE_CONFIGURED`, because the
 * right penalty depends on how many teams are playing — known only at game setup — and
 * editing the game copy would violate I16 (D54).
 *
 * Neither field is defaulted here on purpose: conventions §5 owns
 * `FINALE_PENALTY_S_DEFAULT = 20`, and duplicating it as a zod default would create a second
 * source for the same number. PRD 2's authoring form seeds it instead.
 */
export const dsmtwFinaleRoundConfigSchema = z.strictObject({
  /** Points → seconds conversion (D54). Fractional rates are legitimate. */
  secondsPerPoint: z.number().positive(),
  /** What every *other* team loses when a keyword is marked. Zero disables the mechanic. */
  penaltySeconds: z.number().int().nonnegative(),
})
export type DsmtwFinaleRoundConfig = z.infer<typeof dsmtwFinaleRoundConfigSchema>

export const roundConfigSchemaByType = {
  QUESTION_SET: noConfigSchema,
  JEOPARDY: jeopardyRoundConfigSchema,
  DSMTW_FINALE: dsmtwFinaleRoundConfigSchema,
} as const satisfies Record<RoundType, z.ZodType>

export type RoundConfig =
  | z.infer<typeof noConfigSchema>
  | JeopardyRoundConfig
  | DsmtwFinaleRoundConfig

// ─── keyword.wordLengths ───

/**
 * Per-word character counts, e.g. `"i like cows"` → `[1,4,4]` (D53, conventions §8).
 *
 * Stored rather than derived, so a payload filter selects the shape and **never loads `text`
 * at all** for an unmarked keyword. Counts are characters, not UTF-16 code units, so a tile
 * is never misleadingly wide.
 */
export const wordLengthsSchema = z.array(z.number().int().positive()).min(1)
export type WordLengths = z.infer<typeof wordLengthsSchema>

// ─── boundary helpers ───

/**
 * Validates a `question.config` against the schema for its method. The pairing is I6, and it
 * cannot be expressed in the column type because the method is a sibling column.
 */
export function parseQuestionConfig(
  method: AnswerMethod,
  config: unknown,
): QuestionConfig {
  return questionConfigSchemaByMethod[method].parse(config) as QuestionConfig
}

export function parseRoundConfig(type: RoundType, config: unknown): RoundConfig {
  return roundConfigSchemaByType[type].parse(config) as RoundConfig
}
