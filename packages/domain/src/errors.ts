/**
 * conventions §4 — the complete typed error catalogue, and the uniform result shape.
 *
 * **Clients branch on `error`, never on `message`** (protocol §7.3). That is the whole reason these
 * are typed: `ALREADY_SUBMITTED` means stop retrying and show the team's answer, `QUESTION_LOCKED`
 * means stop retrying and show the locked state, and a network failure means keep retrying.
 * Collapsing them into one generic failure is how a client ends up looping forever.
 *
 * `message` is **English, for developers and logs**. User-facing copy comes from `errors.<CODE>` in
 * the messages module, which mirrors this list key for key.
 */
export const ERROR_CODES = [
  // ─── resolution ───
  'GAME_NOT_FOUND',
  'GAME_NOT_JOINABLE',
  /**
   * A play action against a game that is not `LIVE` — finished, abandoned, or still in `SETUP`.
   *
   * **Not in conventions §4's first draft**, which covered joining (`GAME_NOT_JOINABLE`) but left
   * every one of the 33 master actions without a status guard. Added in the same change as the
   * actions that need it; conventions §4 updated to match.
   */
  'GAME_NOT_LIVE',
  'TEAM_NOT_FOUND',
  'UNKNOWN_DEVICE',
  // ─── joining ───
  'TEAM_FULL',
  // ─── answering ───
  'QUESTION_NOT_OPEN',
  'QUESTION_LOCKED',
  'ALREADY_SUBMITTED',
  'BUZZERS_NOT_LIVE',
  'TEAM_LOCKED_OUT',
  // ─── master actions ───
  'NOT_IN_SETUP',
  'RESYNC_BLOCKED',
  'SOURCE_QUIZ_DELETED',
  'QUESTION_STILL_OPEN',
  'SCORE_OUT_OF_RANGE',
  // ─── DSMTW_FINALE (D50) ───
  'NOT_A_FINALE_ROUND',
  'TOO_FEW_FINALISTS',
  'FINALISTS_ALREADY_SET',
  'TEAM_NOT_A_FINALIST',
  'TEAM_ELIMINATED',
  'NOT_TEAMS_TURN',
  'NO_TURN_ACTIVE',
  'KEYWORD_ALREADY_MARKED',
  // ─── import ───
  'SCHEMA_VERSION_UNSUPPORTED',
  'CHECKSUM_MISMATCH',
  'IMPORT_COLLISION',
  'MANIFEST_INVALID',
  // ─── boundary ───
  'VALIDATION_ERROR',
  /**
   * The database has pending migrations the master declined to apply (D14, PRD 1 §6.7). The server
   * boots into a blocked state and every surface renders one screen; an action must say so with a
   * code rather than fail opaquely. Also absent from conventions §4's first draft.
   */
  'DATABASE_MIGRATION_REQUIRED',
  // ─── attachments ───
  /** Outside conventions §7's MIME allowlist, or over `KWIZ_MAX_UPLOAD_MB`. */
  'ATTACHMENT_REJECTED',
  'ATTACHMENT_NOT_FOUND',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/**
 * conventions §4's response shape, uniform across every action.
 *
 * `data` is present only where an action has something to return that the SSE stream cannot carry —
 * `join` returning a fresh `deviceToken` is the motivating case. **No action returns game state**
 * (protocol §7): the resulting view arrives on the stream, so there is exactly one path by which a
 * client learns anything about the game.
 */
export type ActionResult<T = void> = { ok: true; data?: T } | ActionFailure

/**
 * The refusal half, named so a function can promise *only* a refusal.
 *
 * `ActionResult<never>` would not do: its success branch still exists, so a caller narrowing on
 * `!result.ok` learns nothing the type system can use, and anything assigning a refusal into a
 * `{ ok: true; data: T }` slot fails to compile for the wrong reason.
 */
export interface ActionFailure {
  ok: false
  error: ErrorCode
  message: string
  detail?: unknown
}

export function ok<T>(data?: T): ActionResult<T> {
  return data === undefined ? { ok: true } : { ok: true, data }
}

export function fail(error: ErrorCode, message: string, detail?: unknown): ActionFailure {
  return detail === undefined
    ? { ok: false, error, message }
    : { ok: false, error, message, detail }
}
