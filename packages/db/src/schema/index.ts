/**
 * The 24 tables of data model §1, in their three groups. Passed to `drizzle(sqlite, { schema })`
 * and read by `drizzle-kit`, so every table must be re-exported here or it will be silently
 * missing from generated migrations.
 */

export * from './shared'

/** Template — ordinary mutable rows (§4). */
export {
  acceptedAnswer,
  attachment,
  jeopardyCategory,
  question,
  questionKeyword,
  questionOption,
  quiz,
  round,
} from './template'

/** Play — `game` itself lives apart so the game-copy tables can reference it (§6.1). */
export { game } from './game'

/** Game copy — written once, never updated (§5, I16). */
export {
  gameAcceptedAnswer,
  gameAttachment,
  gameJeopardyCategory,
  gameQuestion,
  gameQuestionKeyword,
  gameQuestionOption,
  gameRound,
} from './game-copy'

/** Play — event log, projections, and the one non-projected scratch table (§6). */
export {
  gameAnswer,
  gameAnswerDraft,
  gameBuzz,
  gameDevice,
  gameEvent,
  gameKeywordMark,
  gameScoreAdjustment,
  gameTeam,
} from './play'
