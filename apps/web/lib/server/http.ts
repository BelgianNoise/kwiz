import { fail, type ActionFailure, type ActionResult, type ErrorCode } from '@kwiz/domain'
import { z } from 'zod'

/**
 * conventions §4 at the HTTP boundary.
 *
 * **The status code is a courtesy; the body is the contract.** A client branches on `error`, never on
 * the status and never on `message` (protocol §7.3) — the mapping below exists so that logs, proxies
 * and `curl` read sensibly, not so anything can depend on it.
 */
const STATUS: Record<ErrorCode, number> = {
  GAME_NOT_FOUND: 404,
  GAME_NOT_JOINABLE: 409,
  GAME_NOT_LIVE: 409,
  TEAM_NOT_FOUND: 404,
  UNKNOWN_DEVICE: 401,
  TEAM_FULL: 409,
  QUESTION_NOT_OPEN: 409,
  QUESTION_LOCKED: 409,
  ALREADY_SUBMITTED: 409,
  BUZZERS_NOT_LIVE: 409,
  TEAM_LOCKED_OUT: 409,
  NOT_IN_SETUP: 409,
  GAME_NOT_FINISHED: 409,
  RESYNC_BLOCKED: 409,
  SOURCE_QUIZ_DELETED: 409,
  // A copy bug, not a client mistake — the request was fine, the server's own write was not.
  COPY_INVALID: 500,
  QUESTION_STILL_OPEN: 409,
  SCORE_OUT_OF_RANGE: 400,
  NOT_A_FINALE_ROUND: 409,
  TOO_FEW_FINALISTS: 400,
  FINALISTS_ALREADY_SET: 409,
  TEAM_NOT_A_FINALIST: 409,
  TEAM_ELIMINATED: 409,
  NOT_TEAMS_TURN: 409,
  NO_TURN_ACTIVE: 409,
  KEYWORD_ALREADY_MARKED: 409,
  SCHEMA_VERSION_UNSUPPORTED: 400,
  CHECKSUM_MISMATCH: 400,
  IMPORT_COLLISION: 409,
  MANIFEST_INVALID: 400,
  VALIDATION_ERROR: 400,
  // The schema is behind and the master declined to migrate (D14). Temporary by nature: applying the
  // migrations fixes it without any change to the request.
  DATABASE_MIGRATION_REQUIRED: 503,
  ATTACHMENT_REJECTED: 400,
  ATTACHMENT_NOT_FOUND: 404,
}

export function actionResponse(result: ActionResult<unknown>): Response {
  return Response.json(result, {
    status: result.ok ? 200 : STATUS[result.error],
    // An action's answer is about one moment and must never be cached, least of all by a phone that
    // retried it.
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * A parsed body, or the refusal to return as-is. Narrower than `ActionResult` on purpose: `data` is
 * **required** when `ok`, so a caller cannot forget that a successful parse always has a value.
 */
export type ParseResult<T> = { ok: true; data: T } | ActionFailure

/**
 * A request body against its schema. `VALIDATION_ERROR` is deliberately separate from every domain
 * code (conventions §4): a malformed request is a bug, whereas `QUESTION_LOCKED` is normal life.
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): ParseResult<T> {
  const parsed = schema.safeParse(body)
  if (parsed.success) return { ok: true, data: parsed.data }
  return fail('VALIDATION_ERROR', 'the request body does not match this action', {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  })
}

/** An absent body is `{}`, so an action taking no arguments works with an empty POST. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return Symbol.for('kwiz.unparseable')
  }
}

export const UNPARSEABLE = Symbol.for('kwiz.unparseable')
