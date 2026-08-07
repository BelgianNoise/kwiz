import type {
  ActionResult,
  AnswerMethod,
  Locale,
  PreflightReport,
  QuizContent,
  RoundType,
} from '@kwiz/domain'

/**
 * PRD 1 §6.9 constraint 3 — **the one module that talks to the server.** Components never call
 * `fetch` themselves.
 *
 * That constraint exists to keep D2's transport swap cheap, and it pays for itself immediately here:
 * every call goes through one place that knows the response is conventions §4's `ActionResult`, so a
 * screen branches on `error` and never on a status code or a message (protocol §7.3).
 *
 * A network failure is turned into the same shape as a refusal, deliberately. A component that has
 * to handle a thrown error *and* a typed refusal will handle one of them badly, and the one it gets
 * wrong will be the one that happens in a noisy room.
 */
async function send<T>(path: string, body?: unknown): Promise<ActionResult<T>> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    })

    const parsed: unknown = await response.json()
    if (isActionResult<T>(parsed)) return parsed
    return {
      ok: false,
      error: 'VALIDATION_ERROR',
      message: `unexpected response from ${path}`,
    }
  } catch (cause) {
    // Offline, or the laptop went to sleep. Not a domain error, and the copy for it says so.
    return {
      ok: false,
      error: 'VALIDATION_ERROR',
      message: cause instanceof Error ? cause.message : 'the request failed',
    }
  }
}

function isActionResult<T>(value: unknown): value is ActionResult<T> {
  return typeof value === 'object' && value !== null && 'ok' in value
}

const authoring = <T = void>(
  path: string,
  body: unknown = {},
): Promise<ActionResult<T>> => send<T>(`/api/authoring/${path}`, body)

// ─── reads (protocol §7.4) ───

export interface QuizListEntry {
  id: string
  name: string
  description: string | null
  updatedAt: string
  rounds: number
  questions: number
}

export interface GameListEntry {
  id: string
  status: 'SETUP' | 'LIVE' | 'FINISHED' | 'ABANDONED'
  code: string
  quizName: string
  quizRevision: number
  templateRevision: number | null
  createdAt: string
  finishedAt: string | null
  teams: number
  /** A `SETUP` game behind its template, so `[Re-sync]` would actually do something (§5). */
  stale: boolean
}

export const api = {
  quizzes: (): Promise<ActionResult<QuizListEntry[]>> => send('/api/quizzes'),
  quiz: (quizId: string): Promise<ActionResult<QuizContent>> =>
    send(`/api/quizzes/${quizId}`),
  preflight: (quizId: string, teams?: number): Promise<ActionResult<PreflightReport>> =>
    send(
      `/api/quizzes/${quizId}/preflight${teams === undefined ? '' : `?teams=${teams}`}`,
    ),
  games: (): Promise<ActionResult<GameListEntry[]>> => send('/api/games'),

  // ─── quizzes ───

  createQuiz: (name: string) => authoring<{ quizId: string }>('quizzes', { name }),
  updateQuiz: (quizId: string, patch: { name?: string; description?: string | null }) =>
    authoring(`quizzes/${quizId}`, patch),
  deleteQuiz: (quizId: string) => authoring(`quizzes/${quizId}/delete`),
  duplicateQuiz: (quizId: string) =>
    authoring<{ quizId: string }>(`quizzes/${quizId}/duplicate`),

  // ─── rounds ───

  createRound: (quizId: string, input: { type: RoundType; title: string }) =>
    authoring<{ roundId: string }>(`quizzes/${quizId}/rounds`, input),
  updateRound: (
    roundId: string,
    patch: {
      title?: string
      defaultPoints?: number
      defaultTimerMs?: number | null
      config?: unknown
    },
  ) => authoring(`rounds/${roundId}`, patch),
  deleteRound: (roundId: string) => authoring(`rounds/${roundId}/delete`),
  /** The keyboard route and the drag route are the same call, so they refuse identically (§15.2). */
  moveRound: (roundId: string, direction: 'UP' | 'DOWN') =>
    authoring(`rounds/${roundId}/move`, { direction }),
  setValueLadder: (roundId: string, valueLadder: number[]) =>
    authoring(`rounds/${roundId}/ladder`, { valueLadder }),

  // ─── the board's columns ───

  createCategory: (roundId: string, name: string) =>
    authoring<{ categoryId: string }>(`rounds/${roundId}/categories`, { name }),
  renameCategory: (categoryId: string, name: string) =>
    authoring(`categories/${categoryId}`, { name }),
  deleteCategory: (categoryId: string) => authoring(`categories/${categoryId}/delete`),

  // ─── questions ───

  createQuestion: (
    roundId: string,
    input: { categoryId?: string; points?: number } = {},
  ) => authoring<{ questionId: string }>(`rounds/${roundId}/questions`, input),
  updateQuestion: (
    questionId: string,
    patch: {
      prompt?: string
      answerMethod?: AnswerMethod
      points?: number
      timerMs?: number | null
      masterNotes?: string | null
      config?: unknown
    },
  ) => authoring(`questions/${questionId}`, patch),
  deleteQuestion: (questionId: string) => authoring(`questions/${questionId}/delete`),
  moveQuestion: (questionId: string, direction: 'UP' | 'DOWN') =>
    authoring(`questions/${questionId}/move`, { direction }),
  setAcceptedAnswers: (questionId: string, answers: string[]) =>
    authoring(`questions/${questionId}/accepted-answers`, { answers }),
  setOptions: (questionId: string, options: { text: string; isCorrect: boolean }[]) =>
    authoring(`questions/${questionId}/options`, { options }),
  setKeywords: (questionId: string, keywords: string[]) =>
    authoring(`questions/${questionId}/keywords`, { keywords }),

  // ─── attachments ───

  deleteAttachment: (attachmentId: string) =>
    authoring(`attachments/${attachmentId}/delete`),
  setAttachmentVisibility: (attachmentId: string, showOnPlayerDevices: boolean) =>
    authoring(`attachments/${attachmentId}/visibility`, { showOnPlayerDevices }),

  /**
   * Multipart, because that is what a file input sends — and the only call here that is not JSON.
   * Playability was already verified in the browser before this is reached (O6).
   */
  uploadAttachment: async (
    questionId: string,
    file: File,
  ): Promise<ActionResult<{ id: string; url: string; durationMs: number | null }>> => {
    const form = new FormData()
    form.append('file', file)
    form.append('questionId', questionId)
    try {
      const response = await fetch('/api/attachments', { method: 'POST', body: form })
      const parsed: unknown = await response.json()
      if (
        isActionResult<{ id: string; url: string; durationMs: number | null }>(parsed)
      ) {
        return parsed
      }
      return { ok: false, error: 'ATTACHMENT_REJECTED', message: 'unexpected response' }
    } catch (cause) {
      return {
        ok: false,
        error: 'ATTACHMENT_REJECTED',
        message: cause instanceof Error ? cause.message : 'the upload failed',
      }
    }
  },

  // ─── games (PRD 2 §11) ───

  createGame: (input: {
    quizId: string
    teams: { name: string; colour: string }[]
    defaultPlayerLocale: Locale
    finale?: { secondsPerPoint: number; penaltySeconds: number }
  }) => send<{ gameId: string; code: string }>('/api/games', input),
}
