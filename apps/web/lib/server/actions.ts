import { randomBytes } from 'node:crypto'

import {
  deleteDraft,
  findDeviceByToken,
  generateUnusedCode,
  questionDrafts,
  resyncGame,
  saveDraft,
  touchDevice,
} from '@kwiz/db'
import {
  acceptsSubmissions,
  fail,
  ok,
  type ActionResult,
  type Command,
  type GameState,
} from '@kwiz/domain'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import { parseBody } from './http'
import type { Runtime } from './runtime'
import { publishState, publishToTeam, runCommand, type CommandContext } from './service'

/**
 * protocol §7.1–§7.2 — **every client→server action, in one table.**
 *
 * One dispatch module rather than 38 route files, because PRD 1 §6.9 constraint 2 names *"the
 * action-dispatch module"* as one of the three files a transport migration would touch. It is also
 * how the whole catalogue stays greppable: a route added without a schema is visible here, and a
 * schema without a route is dead code.
 *
 * The layering, kept strictly:
 *
 * - **This file** validates shape, resolves identity, and mints the ids and tokens a pure decision
 *   function may not invent.
 * - **`decide`** in `packages/domain` decides. Every refusal is one of conventions §4's codes.
 * - **`appendAndProject`** commits, and only then is anything pushed (PRD 1 §6.4).
 *
 * Two endpoints are deliberately not commands. `draft` appends **no event at all** (protocol §4.8) —
 * keystroke timing is not a game fact — and `resync` belongs to `@kwiz/db`, which owns both the
 * precondition and the copy subtree it replaces (data model §7.1).
 */

const NO_BODY = z.object({})
const teamIdSchema = z.string().min(1)

const answerSchema = z.object({
  gameQuestionId: z.string().min(1),
  text: z.string().optional(),
  selectedOptionId: z.string().min(1).optional(),
})

/** Who a route needs to be. There is no authorisation here — `PLAYER` needs a token for identity. */
type RouteAudience = 'PLAYER' | 'MASTER'

interface Route {
  name: string
  /** `:name` segments become params. Matched by exact length, so `break` and `break/end` differ. */
  pattern: readonly string[]
  audience: RouteAudience
}

const route = (name: string, pattern: string, audience: RouteAudience): Route => ({
  name,
  pattern: pattern.split('/'),
  audience,
})

/** protocol §7.1 and §7.2, in the order the spec lists them. */
export const ROUTES: readonly Route[] = [
  // §7.1 player
  route('switch-team', 'switch-team', 'PLAYER'),
  route('draft', 'draft', 'PLAYER'),
  route('submit', 'submit', 'PLAYER'),
  route('buzz', 'buzz', 'PLAYER'),

  // §7.2 lifecycle
  route('start', 'start', 'MASTER'),
  route('finish', 'finish', 'MASTER'),
  route('abandon', 'abandon', 'MASTER'),
  route('round-open', 'rounds/:roundId/open', 'MASTER'),
  route('round-close', 'rounds/:roundId/close', 'MASTER'),

  // §7.2 question flow
  route('question-open', 'questions/:questionId/open', 'MASTER'),
  route('question-lock', 'questions/:questionId/lock', 'MASTER'),
  route('question-reveal', 'questions/:questionId/reveal', 'MASTER'),
  route('question-score', 'questions/:questionId/score', 'MASTER'),
  route('question-skip', 'questions/:questionId/skip', 'MASTER'),

  // §7.2 buzzer, validation, DO
  route('adjudicate', 'buzzes/:buzzId/adjudicate', 'MASTER'),
  route('reopen-buzzers', 'questions/:questionId/reopen-buzzers', 'MASTER'),
  route('validate', 'answers/validate', 'MASTER'),
  route('spotlight', 'answers/spotlight', 'MASTER'),
  route('do-winners', 'questions/:questionId/do-winners', 'MASTER'),
  route('do-scores', 'questions/:questionId/do-scores', 'MASTER'),
  route('submit-for-team', 'answers/submit-for-team', 'MASTER'),

  // §7.2 pacing
  route('scoreboard', 'scoreboard', 'MASTER'),
  route('break', 'break', 'MASTER'),
  route('break-end', 'break/end', 'MASTER'),
  route('picker', 'picker', 'MASTER'),

  // §7.2 DSMTW_FINALE
  route('finale-config', 'finale/config', 'MASTER'),
  route('finale-finalists', 'finale/finalists', 'MASTER'),
  route('finale-turn-start', 'finale/turn/start', 'MASTER'),
  route('finale-turn-pass', 'finale/turn/pass', 'MASTER'),
  route('finale-keyword-mark', 'finale/keywords/:keywordId/mark', 'MASTER'),
  route('finale-keyword-unmark', 'finale/keywords/:keywordId/unmark', 'MASTER'),
  route('finale-reveal', 'finale/reveal', 'MASTER'),
  route('finale-eliminate', 'finale/eliminate', 'MASTER'),

  // §7.2 scores & setup
  route('adjust-score', 'adjust-score', 'MASTER'),
  route('revoke-adjustment', 'adjustments/:adjustmentId/revoke', 'MASTER'),
  route('regenerate-code', 'regenerate-code', 'MASTER'),
  route('resync', 'resync', 'MASTER'),
] as const

export interface MatchedRoute {
  route: Route
  params: Record<string, string>
}

export function matchRoute(segments: readonly string[]): MatchedRoute | undefined {
  for (const candidate of ROUTES) {
    if (candidate.pattern.length !== segments.length) continue
    const params: Record<string, string> = {}
    let matched = true
    for (const [index, part] of candidate.pattern.entries()) {
      const actual = segments[index] ?? ''
      if (part.startsWith(':')) params[part.slice(1)] = actual
      else if (part !== actual) {
        matched = false
        break
      }
    }
    if (matched) return { route: candidate, params }
  }
  return undefined
}

export interface ActionInput {
  runtime: Runtime
  gameId: string
  segments: readonly string[]
  body: unknown
  /** `X-Kwiz-Device`, required on every player action (protocol §7.1). */
  deviceToken: string | null
  now: number
}

/**
 * Runs one action. Returns conventions §4's result, which the route turns into a response.
 *
 * **No action returns game state** (protocol §7): the resulting view arrives on the SSE stream, so
 * there is exactly one path by which a client learns anything about the game.
 */
export function runAction(input: ActionInput): ActionResult<unknown> {
  const matched = matchRoute(input.segments)
  if (!matched) {
    return fail('VALIDATION_ERROR', `no action at ${input.segments.join('/')}`)
  }

  const { runtime, gameId, now } = input
  const state = runtime.registry.get(gameId)
  if (!state) return fail('GAME_NOT_FOUND', `no game ${gameId}`)

  const context: CommandContext = { runtime, gameId, now }

  // Player identity, resolved once. A token from another game reads as unknown rather than as a team
  // in the wrong one (D21) — `findDeviceByToken` is scoped to the game for exactly that reason.
  let device: { id: string; teamId: string } | undefined
  if (matched.route.audience === 'PLAYER') {
    if (!input.deviceToken) {
      return fail('UNKNOWN_DEVICE', 'this action needs an X-Kwiz-Device header')
    }
    device = findDeviceByToken(runtime.database, gameId, input.deviceToken)
    if (!device) return fail('UNKNOWN_DEVICE', 'that device token is not in this game')
    // The one column in the play half updated in place rather than projected (protocol §4.8).
    touchDevice(runtime.database, device.id, new Date(now))
  }

  return execute(matched, input, context, state, device)
}

/** One branch per endpoint: splitting it would hide the catalogue this module exists to show. */
function execute(
  matched: MatchedRoute,
  input: ActionInput,
  context: CommandContext,
  state: GameState,
  device: { id: string; teamId: string } | undefined,
): ActionResult<unknown> {
  const { runtime, gameId, body, now } = input
  const { params } = matched
  const questionId = params.questionId ?? ''
  const teamId = device?.teamId

  /** A command, run through the standard loop. */
  const run = (command: Command): ActionResult<unknown> => runCommand(context, command)

  switch (matched.route.name) {
    // ─── §7.1 player ───

    case 'switch-team': {
      const parsed = parseBody(z.object({ toTeamId: teamIdSchema }), body)
      if (!parsed.ok) return parsed
      if (!device) return fail('UNKNOWN_DEVICE', 'no device for this token')
      return run({
        type: 'SWITCH_TEAM',
        deviceId: device.id,
        toTeamId: parsed.data.toTeamId,
        maxDevicesPerTeam: runtime.config.KWIZ_MAX_DEVICES_PER_TEAM,
      })
    }

    /**
     * **No event, by design** (protocol §4.8): a draft is not a game fact and keystroke timing is not
     * reproducible by replay. It is upserted to its own table and pushed to the team's *other*
     * devices (D45) — never to the room, and never to the master, whose view carries drafts only once
     * they have been committed at lock (D26).
     */
    case 'draft': {
      const parsed = parseBody(answerSchema, body)
      if (!parsed.ok) return parsed
      const draft = parsed.data
      if (teamId === undefined) return fail('UNKNOWN_DEVICE', 'no team for this device')

      const play = state.questions.get(draft.gameQuestionId)
      if (!play || !acceptsSubmissions(play.state)) {
        return fail('QUESTION_NOT_OPEN', 'drafts are only kept while a question is open')
      }
      // Rejected once the team has submitted (protocol §7.1): submission is final, so a later draft
      // could only ever resurface as a contradiction of it.
      if (play.answers.has(teamId)) {
        return fail('ALREADY_SUBMITTED', 'this team has already submitted', {
          answer: {
            text: play.answers.get(teamId)?.text ?? null,
            optionId: play.answers.get(teamId)?.selectedOptionId ?? null,
          },
        })
      }

      saveDraft(
        runtime.database,
        {
          gameId,
          gameQuestionId: draft.gameQuestionId,
          teamId,
          text: draft.text ?? null,
          selectedOptionId: draft.selectedOptionId ?? null,
        },
        new Date(now),
      )
      publishToTeam(context, teamId)
      return ok()
    }

    case 'submit': {
      const parsed = parseBody(answerSchema, body)
      if (!parsed.ok) return parsed
      if (teamId === undefined) return fail('UNKNOWN_DEVICE', 'no team for this device')
      const answer = parsed.data

      const result = run({
        type: 'SUBMIT_ANSWER',
        gameQuestionId: answer.gameQuestionId,
        teamId,
        ...(answer.text === undefined ? {} : { text: answer.text }),
        ...(answer.selectedOptionId === undefined
          ? {}
          : { selectedOptionId: answer.selectedOptionId }),
      })
      if (result.ok) {
        // Submitting deletes the draft (protocol §4.3), so a stale one can never resurface at lock.
        deleteDraft(runtime.database, answer.gameQuestionId, teamId)
      }
      return result
    }

    case 'buzz': {
      const parsed = parseBody(z.object({ gameQuestionId: z.string().min(1) }), body)
      if (!parsed.ok) return parsed
      if (teamId === undefined) return fail('UNKNOWN_DEVICE', 'no team for this device')
      return run({
        type: 'BUZZ',
        // Minted here: a client-supplied id would let one phone overwrite another's buzz.
        buzzId: uuidv7(),
        gameQuestionId: parsed.data.gameQuestionId,
        teamId,
        // **The server's arrival time is the ordering authority** (D35). A client timestamp would be
        // the one thing in this game worth cheating on.
        receivedAt: now,
      })
    }

    // ─── §7.2 lifecycle ───

    case 'start':
      return withNoBody(body, () => run({ type: 'START_GAME' }))
    case 'finish':
      return withNoBody(body, () => run({ type: 'FINISH_GAME' }))
    case 'abandon':
      return withNoBody(body, () => run({ type: 'ABANDON_GAME' }))
    case 'round-open':
      return withNoBody(body, () =>
        run({ type: 'OPEN_ROUND', gameRoundId: params.roundId ?? '' }),
      )
    case 'round-close':
      return withNoBody(body, () =>
        run({ type: 'CLOSE_ROUND', gameRoundId: params.roundId ?? '' }),
      )

    // ─── §7.2 question flow ───

    case 'question-open':
      // The server computes `deadlineAt` from the question's timer — the client never sends one (D7).
      return withNoBody(body, () =>
        run({ type: 'OPEN_QUESTION', gameQuestionId: questionId }),
      )

    case 'question-lock':
      return withNoBody(body, () =>
        run({
          type: 'LOCK_QUESTION',
          gameQuestionId: questionId,
          // Read here rather than in `decide`, which cannot reach a database. Committing them is what
          // surfaces D26's "not confirmed by team" marker.
          drafts: questionDrafts(runtime.database, questionId),
        }),
      )

    case 'question-reveal':
      return withNoBody(body, () =>
        run({ type: 'REVEAL_QUESTION', gameQuestionId: questionId }),
      )
    case 'question-score':
      return withNoBody(body, () =>
        run({ type: 'SCORE_QUESTION', gameQuestionId: questionId }),
      )
    case 'question-skip':
      return withNoBody(body, () =>
        run({ type: 'SKIP_QUESTION', gameQuestionId: questionId }),
      )

    // ─── §7.2 buzzer, validation, DO ───

    case 'adjudicate': {
      const parsed = parseBody(z.object({ accepted: z.boolean() }), body)
      if (!parsed.ok) return parsed
      return run({
        type: 'ADJUDICATE_BUZZ',
        buzzId: params.buzzId ?? '',
        accepted: parsed.data.accepted,
      })
    }

    case 'reopen-buzzers':
      return withNoBody(body, () =>
        run({ type: 'REOPEN_BUZZERS', gameQuestionId: questionId }),
      )

    case 'validate': {
      const parsed = parseBody(
        z.object({
          gameQuestionId: z.string().min(1),
          teamId: teamIdSchema,
          accepted: z.boolean(),
        }),
        body,
      )
      if (!parsed.ok) return parsed
      // Also the revalidation path: a repeat supersedes the earlier verdict (protocol §4.3).
      return run({ type: 'VALIDATE_ANSWER', ...parsed.data })
    }

    case 'spotlight': {
      const parsed = parseBody(
        z.object({
          gameQuestionId: z.string().min(1),
          teamId: teamIdSchema,
          spotlit: z.boolean(),
        }),
        body,
      )
      if (!parsed.ok) return parsed
      return run({ type: 'SPOTLIGHT_ANSWER', ...parsed.data })
    }

    case 'do-winners': {
      const parsed = parseBody(z.object({ teamIds: z.array(teamIdSchema) }), body)
      if (!parsed.ok) return parsed
      // `[]` is the explicit "nobody got it" (D23), not a missing field.
      return run({
        type: 'SET_DO_WINNERS',
        gameQuestionId: questionId,
        teamIds: parsed.data.teamIds,
      })
    }

    case 'do-scores': {
      const parsed = parseBody(
        z.object({
          scores: z.array(z.object({ teamId: teamIdSchema, score: z.number().int() })),
        }),
        body,
      )
      if (!parsed.ok) return parsed
      return run({
        type: 'SET_DO_SCORES',
        gameQuestionId: questionId,
        scores: parsed.data.scores,
      })
    }

    case 'submit-for-team': {
      const parsed = parseBody(answerSchema.extend({ teamId: teamIdSchema }), body)
      if (!parsed.ok) return parsed
      const proxy = parsed.data
      const result = run({
        type: 'SUBMIT_FOR_TEAM',
        gameQuestionId: proxy.gameQuestionId,
        teamId: proxy.teamId,
        ...(proxy.text === undefined ? {} : { text: proxy.text }),
        ...(proxy.selectedOptionId === undefined
          ? {}
          : { selectedOptionId: proxy.selectedOptionId }),
      })
      if (result.ok) deleteDraft(runtime.database, proxy.gameQuestionId, proxy.teamId)
      return result
    }

    // ─── §7.2 pacing ───

    case 'scoreboard': {
      const parsed = parseBody(z.object({ shown: z.boolean() }), body)
      if (!parsed.ok) return parsed
      return run({ type: 'TOGGLE_SCOREBOARD', shown: parsed.data.shown })
    }

    case 'break': {
      const parsed = parseBody(
        z.object({ durationMs: z.number().int().positive().optional() }),
        body,
      )
      if (!parsed.ok) return parsed
      // Re-posting during a break extends it; omitting `durationMs` is an open-ended break.
      return run({
        type: 'START_BREAK',
        ...(parsed.data.durationMs === undefined
          ? {}
          : { durationMs: parsed.data.durationMs }),
      })
    }

    case 'break-end':
      return withNoBody(body, () => run({ type: 'END_BREAK' }))

    case 'picker': {
      const parsed = parseBody(
        z.object({
          teamId: teamIdSchema,
          reason: z
            .enum(['RULE', 'TIE_BREAK', 'MASTER_OVERRIDE'])
            .default('MASTER_OVERRIDE'),
        }),
        body,
      )
      if (!parsed.ok) return parsed
      return run({ type: 'ASSIGN_PICKER', ...parsed.data })
    }

    // ─── §7.2 DSMTW_FINALE ───

    case 'finale-config': {
      const parsed = parseBody(
        z.object({
          secondsPerPoint: z.number().positive(),
          penaltySeconds: z.number().int().nonnegative(),
        }),
        body,
      )
      if (!parsed.ok) return parsed
      return run({ type: 'CONFIGURE_FINALE', ...parsed.data })
    }

    case 'finale-finalists': {
      const parsed = parseBody(z.object({ teamIds: z.array(teamIdSchema) }), body)
      if (!parsed.ok) return parsed
      // The minimum of two is `TOO_FEW_FINALISTS` from the domain, not a schema error: it is a rule
      // of the round (D55), and the master should see the same refusal the desk explains.
      return run({ type: 'SET_FINALISTS', teamIds: parsed.data.teamIds })
    }

    case 'finale-turn-start': {
      const parsed = parseBody(z.object({ teamId: teamIdSchema }), body)
      if (!parsed.ok) return parsed
      return run({ type: 'START_TURN', teamId: parsed.data.teamId })
    }

    case 'finale-turn-pass':
      return withNoBody(body, () => run({ type: 'PASS_TURN' }))

    case 'finale-keyword-mark':
      return withNoBody(body, () =>
        run({ type: 'MARK_KEYWORD', gameKeywordId: params.keywordId ?? '' }),
      )

    case 'finale-keyword-unmark':
      return withNoBody(body, () =>
        run({ type: 'UNMARK_KEYWORD', gameKeywordId: params.keywordId ?? '' }),
      )

    case 'finale-reveal': {
      const parsed = parseBody(z.object({ gameQuestionId: z.string().min(1) }), body)
      if (!parsed.ok) return parsed
      return run({ type: 'REVEAL_KEYWORDS', gameQuestionId: parsed.data.gameQuestionId })
    }

    case 'finale-eliminate': {
      const parsed = parseBody(z.object({ teamId: teamIdSchema }), body)
      if (!parsed.ok) return parsed
      // The server recomputes the instant and ignores anything the client thinks it knows about when
      // the clock hit zero (protocol §4.6).
      return run({ type: 'ELIMINATE_TEAM', teamId: parsed.data.teamId })
    }

    // ─── §7.2 scores & setup ───

    case 'adjust-score': {
      const parsed = parseBody(
        z.object({
          teamId: teamIdSchema,
          delta: z.number().int(),
          reason: z.string().min(1).optional(),
          announced: z.boolean().default(true),
        }),
        body,
      )
      if (!parsed.ok) return parsed
      return run({
        type: 'ADJUST_SCORE',
        // The row id lives in the event because `SCORE_ADJUSTMENT_REVOKED` refers to it, and a
        // projection rebuild with a generated id would orphan every revocation (protocol §4.7).
        adjustmentId: uuidv7(),
        ...parsed.data,
      })
    }

    case 'revoke-adjustment':
      return withNoBody(body, () =>
        run({ type: 'REVOKE_ADJUSTMENT', adjustmentId: params.adjustmentId ?? '' }),
      )

    case 'regenerate-code':
      return withNoBody(body, () =>
        run({
          type: 'REGENERATE_CODE',
          // CSPRNG bytes from here, mapped to Crockford Base32 by `@kwiz/domain` (conventions §2).
          code: generateUnusedCode(runtime.database, (size) => randomBytes(size)),
        }),
      )

    /**
     * data model §7.1 — owned by `@kwiz/db` end to end, because the copy subtree and the event have
     * to commit together and the precondition is a row count rather than anything in `GameState`.
     */
    case 'resync': {
      const result = resyncGame(runtime.database, gameId, () => new Date(now))
      if (!result.ok) return result
      // The copy subtree changed, so the in-memory content is stale — a re-read, not a catch-up.
      runtime.registry.evict(gameId)
      publishState(context)
      return ok()
    }

    default:
      return fail('VALIDATION_ERROR', `unhandled action ${matched.route.name}`)
  }
}

/** Actions whose body is `{}`. Still validated, so a typo'd field is a refusal rather than ignored. */
function withNoBody(
  body: unknown,
  then: () => ActionResult<unknown>,
): ActionResult<unknown> {
  const parsed = parseBody(NO_BODY, body)
  return parsed.ok ? then() : parsed
}
