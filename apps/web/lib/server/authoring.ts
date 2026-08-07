import {
  createCategory,
  createQuestion,
  createQuiz,
  createRound,
  deleteAttachment,
  deleteCategory,
  deleteQuestion,
  deleteQuiz,
  deleteRound,
  duplicateQuiz,
  moveQuestion,
  moveRound,
  renameCategory,
  setAcceptedAnswers,
  setAttachmentVisibility,
  setKeywords,
  setOptions,
  setValueLadder,
  updateQuestion,
  updateQuiz,
  updateRound,
} from '@kwiz/db'
import {
  ANSWER_METHODS,
  DO_SCORING_MODES,
  dsmtwFinaleRoundConfigSchema,
  fail,
  jeopardyRoundConfigSchema,
  ROUND_TYPES,
  TIE_PAYOUTS,
  type ActionResult,
} from '@kwiz/domain'
import { z } from 'zod'

import { parseBody } from './http'
import type { Runtime } from './runtime'

/**
 * PRD 2's authoring mutations — **an endpoint catalogue the protocol never had.**
 *
 * protocol §7 covers the play half and §7.4 the unbounded reads; nothing documented how a master
 * creates a round or renames a category, because those surfaces did not exist yet. Written here in
 * the same shape as slice 3's play actions and recorded in protocol §7.6, rather than left as an
 * undocumented API that the next agent has to reverse-engineer from a form.
 *
 * Three things this layer deliberately does not do:
 *
 * - **No game logic.** Every rule — the finale's position, contiguous positions, the value ladder
 *   governing tiles — lives in `@kwiz/db`'s repositories, where it is testable without HTTP.
 * - **No events.** The template half is ordinary mutable rows (data model §1); `appendAndProject`
 *   owns the play half and nothing here goes near it.
 * - **No `PUT`/`PATCH`/`DELETE`.** Everything is a `POST`, as in §7.1–§7.2: one method, one shape,
 *   one place to look. The path says what happens.
 */

const NO_BODY = z.object({})
const id = z.string().min(1)

/** Autosaved on a ~600 ms debounce (§15.1), so every field is optional and sent alone. */
const quizPatchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
})

/**
 * `config` is one of the three round shapes (content-config), and **which one depends on the round's
 * `type` — a sibling column this route cannot see**. So the boundary checks it is one of them, and
 * `updateRound` checks it is the *right* one, which is where I6 actually belongs.
 */
const roundPatchSchema = z.object({
  title: z.string().min(1).optional(),
  defaultPoints: z.number().int().nonnegative().optional(),
  defaultTimerMs: z.number().int().positive().nullable().optional(),
  config: z
    .union([jeopardyRoundConfigSchema, dsmtwFinaleRoundConfigSchema, z.object({})])
    .optional(),
})

const doConfig = z.object({
  scoringMode: z.enum(DO_SCORING_MODES),
  tiePayout: z.enum(TIE_PAYOUTS).default('FULL'),
})

const questionPatchSchema = z.object({
  prompt: z.string().optional(),
  answerMethod: z.enum(ANSWER_METHODS).optional(),
  points: z.number().int().nonnegative().optional(),
  /** Zero is invalid, not "no timer" — null is (I12). */
  timerMs: z.number().int().positive().nullable().optional(),
  masterNotes: z.string().nullable().optional(),
  config: z.union([doConfig, z.object({})]).optional(),
})

interface AuthoringRoute {
  name: string
  pattern: readonly string[]
}

const route = (name: string, pattern: string): AuthoringRoute => ({
  name,
  pattern: pattern.split('/'),
})

/** Every authoring mutation, in the order PRD 2 introduces them. */
export const AUTHORING_ROUTES: readonly AuthoringRoute[] = [
  route('quiz-create', 'quizzes'),
  route('quiz-update', 'quizzes/:quizId'),
  route('quiz-delete', 'quizzes/:quizId/delete'),
  route('quiz-duplicate', 'quizzes/:quizId/duplicate'),

  route('round-create', 'quizzes/:quizId/rounds'),
  route('round-update', 'rounds/:roundId'),
  route('round-delete', 'rounds/:roundId/delete'),
  route('round-move', 'rounds/:roundId/move'),
  route('round-ladder', 'rounds/:roundId/ladder'),

  route('category-create', 'rounds/:roundId/categories'),
  route('category-rename', 'categories/:categoryId'),
  route('category-delete', 'categories/:categoryId/delete'),

  route('question-create', 'rounds/:roundId/questions'),
  route('question-update', 'questions/:questionId'),
  route('question-delete', 'questions/:questionId/delete'),
  route('question-move', 'questions/:questionId/move'),
  route('question-accepted-answers', 'questions/:questionId/accepted-answers'),
  route('question-options', 'questions/:questionId/options'),
  route('question-keywords', 'questions/:questionId/keywords'),

  route('attachment-delete', 'attachments/:attachmentId/delete'),
  route('attachment-visibility', 'attachments/:attachmentId/visibility'),
] as const

export interface MatchedAuthoringRoute {
  route: AuthoringRoute
  params: Record<string, string>
}

export function matchAuthoringRoute(
  segments: readonly string[],
): MatchedAuthoringRoute | undefined {
  for (const candidate of AUTHORING_ROUTES) {
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

export interface AuthoringInput {
  runtime: Runtime
  segments: readonly string[]
  body: unknown
  now: Date
}

export function runAuthoring(input: AuthoringInput): ActionResult<unknown> {
  const matched = matchAuthoringRoute(input.segments)
  if (!matched) {
    return fail('VALIDATION_ERROR', `no authoring action at ${input.segments.join('/')}`)
  }
  return execute(matched, input)
}

/** One branch per endpoint, for the same reason as the play half: the catalogue stays visible. */
function execute(
  matched: MatchedAuthoringRoute,
  input: AuthoringInput,
): ActionResult<unknown> {
  const database = input.runtime.database
  const { body, now } = input
  const { params } = matched
  const quizId = params.quizId ?? ''
  const roundId = params.roundId ?? ''
  const questionId = params.questionId ?? ''
  const categoryId = params.categoryId ?? ''
  const attachmentId = params.attachmentId ?? ''

  switch (matched.route.name) {
    // ─── quizzes ───

    case 'quiz-create': {
      const parsed = parseBody(z.object({ name: z.string().min(1) }), body)
      return parsed.ok ? createQuiz(database, parsed.data, now) : parsed
    }

    case 'quiz-update': {
      const parsed = parseBody(quizPatchSchema, body)
      return parsed.ok ? updateQuiz(database, quizId, parsed.data, now) : parsed
    }

    case 'quiz-delete':
      // Safe: games keep their own copies, so played history survives (data model §10). The
      // confirmation that says so is PRD 2 §5's, and it is the UI's.
      return withNoBody(body, () => deleteQuiz(database, quizId))

    case 'quiz-duplicate':
      return withNoBody(body, () => duplicateQuiz(database, quizId, now))

    // ─── rounds ───

    case 'round-create': {
      const parsed = parseBody(
        z.object({ type: z.enum(ROUND_TYPES), title: z.string().min(1) }),
        body,
      )
      // The repository, not this layer, refuses a second finale and inserts before an existing
      // one (§6.1) — an imported quiz never passed through the editor that prevents it.
      return parsed.ok ? createRound(database, quizId, parsed.data, now) : parsed
    }

    case 'round-update': {
      const parsed = parseBody(roundPatchSchema, body)
      return parsed.ok ? updateRound(database, roundId, parsed.data, now) : parsed
    }

    case 'round-delete':
      return withNoBody(body, () => deleteRound(database, roundId, now))

    case 'round-move': {
      const parsed = parseBody(z.object({ direction: z.enum(['UP', 'DOWN']) }), body)
      // Both the drag and `Alt+↑/↓` land here, which is what makes them refuse identically (§15.2).
      return parsed.ok ? moveRound(database, roundId, parsed.data.direction, now) : parsed
    }

    case 'round-ladder': {
      const parsed = parseBody(
        z.object({ valueLadder: z.array(z.number().int().positive()).min(1) }),
        body,
      )
      return parsed.ok
        ? setValueLadder(database, roundId, parsed.data.valueLadder, now)
        : parsed
    }

    // ─── the board's columns ───

    case 'category-create': {
      const parsed = parseBody(z.object({ name: z.string().min(1) }), body)
      return parsed.ok ? createCategory(database, roundId, parsed.data.name, now) : parsed
    }

    case 'category-rename': {
      const parsed = parseBody(z.object({ name: z.string().min(1) }), body)
      return parsed.ok
        ? renameCategory(database, categoryId, parsed.data.name, now)
        : parsed
    }

    case 'category-delete':
      // Takes its tiles with it, which the confirmation names before this is reached (§8).
      return withNoBody(body, () => deleteCategory(database, categoryId, now))

    // ─── questions ───

    case 'question-create': {
      const parsed = parseBody(
        z.object({
          categoryId: id.nullable().optional(),
          points: z.number().int().nonnegative().optional(),
        }),
        body,
      )
      return parsed.ok ? createQuestion(database, roundId, parsed.data, now) : parsed
    }

    case 'question-update': {
      const parsed = parseBody(questionPatchSchema, body)
      return parsed.ok ? updateQuestion(database, questionId, parsed.data, now) : parsed
    }

    case 'question-delete':
      return withNoBody(body, () => deleteQuestion(database, questionId, now))

    case 'question-move': {
      const parsed = parseBody(z.object({ direction: z.enum(['UP', 'DOWN']) }), body)
      return parsed.ok
        ? moveQuestion(database, questionId, parsed.data.direction, now)
        : parsed
    }

    case 'question-accepted-answers': {
      const parsed = parseBody(z.object({ answers: z.array(z.string()) }), body)
      // `position = 0` is the canonical answer shown at reveal, so order is the client's to state.
      return parsed.ok
        ? setAcceptedAnswers(database, questionId, parsed.data.answers, now)
        : parsed
    }

    case 'question-options': {
      const parsed = parseBody(
        z.object({
          options: z.array(z.object({ text: z.string(), isCorrect: z.boolean() })).max(4),
        }),
        body,
      )
      return parsed.ok
        ? setOptions(database, questionId, parsed.data.options, now)
        : parsed
    }

    case 'question-keywords': {
      const parsed = parseBody(
        // Exactly five, always (I17) — the sheet renders five slots and sends five.
        z.object({ keywords: z.array(z.string()).length(5) }),
        body,
      )
      return parsed.ok
        ? setKeywords(database, questionId, parsed.data.keywords, now)
        : parsed
    }

    // ─── attachments ───

    case 'attachment-delete':
      // The row goes; the file stays for the reconciliation pass (data model §8), because an
      // orphaned file is the recoverable direction and a missing one is not.
      return withNoBody(body, () => deleteAttachment(database, attachmentId, now))

    case 'attachment-visibility': {
      const parsed = parseBody(z.object({ showOnPlayerDevices: z.boolean() }), body)
      return parsed.ok
        ? setAttachmentVisibility(
            database,
            attachmentId,
            parsed.data.showOnPlayerDevices,
            now,
          )
        : parsed
    }

    default:
      return fail('VALIDATION_ERROR', `unhandled authoring action ${matched.route.name}`)
  }
}

function withNoBody(
  body: unknown,
  then: () => ActionResult<unknown>,
): ActionResult<unknown> {
  const parsed = parseBody(NO_BODY, body)
  return parsed.ok ? then() : parsed
}
