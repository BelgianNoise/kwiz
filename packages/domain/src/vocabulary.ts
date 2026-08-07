/**
 * Enum value tuples, declared once and shared by the Drizzle `text({ enum })` columns and
 * the zod schemas that validate the same values.
 *
 * Drizzle generates **no `CHECK` constraint** for these (data model §2), so the database
 * will not reject a bad value. The TypeScript union and the zod schema at the boundary are
 * the whole guard — which is why they must be built from one list rather than two.
 */

export const ANSWER_METHODS = [
  'FREE_TEXT',
  'MULTIPLE_CHOICE',
  'BUZZER',
  'DO',
  'KEYWORDS',
] as const
export type AnswerMethod = (typeof ANSWER_METHODS)[number]

export const ROUND_TYPES = ['QUESTION_SET', 'JEOPARDY', 'DSMTW_FINALE'] as const
export type RoundType = (typeof ROUND_TYPES)[number]

export const ATTACHMENT_KINDS = ['IMAGE', 'AUDIO', 'VIDEO'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const GAME_STATUSES = ['SETUP', 'LIVE', 'FINISHED', 'ABANDONED'] as const
export type GameStatus = (typeof GAME_STATUSES)[number]

export const LOCALES = ['en', 'nl'] as const
export type Locale = (typeof LOCALES)[number]

/**
 * The three SSE audiences (protocol §2.1). One filter per audience, selected by the **route** —
 * never by a query parameter — so the wrong filter cannot be reached by editing a URL.
 *
 * **`CONFIG` is deliberately not here.** The configuration pages are request/response and have no
 * live requirement; giving them a stream would mean a fourth filter to keep correct for no benefit.
 */
export const AUDIENCES = ['MAIN_SCREEN', 'MASTER_CONTROL', 'PLAYER'] as const
export type Audience = (typeof AUDIENCES)[number]

/** data model §6.5. A `FREE_TEXT` answer never auto-resolves to `AUTO_WRONG` (D22). */
export const ANSWER_VERDICTS = [
  'PENDING',
  'AUTO_CORRECT',
  'AUTO_WRONG',
  'ACCEPTED',
  'DENIED',
  'NO_ANSWER',
] as const
export type AnswerVerdict = (typeof ANSWER_VERDICTS)[number]

/** data model §6.6. `NOT_FIRST` is recorded but never adjudicated. */
export const BUZZ_OUTCOMES = ['AWAITING', 'ACCEPTED', 'DENIED', 'NOT_FIRST'] as const
export type BuzzOutcome = (typeof BUZZ_OUTCOMES)[number]

export const DO_SCORING_MODES = ['WINNER_TAKES_ALL', 'PER_TEAM_SCORE'] as const
export type DoScoringMode = (typeof DO_SCORING_MODES)[number]

export const TIE_PAYOUTS = ['SPLIT', 'FULL'] as const
export type TiePayout = (typeof TIE_PAYOUTS)[number]
