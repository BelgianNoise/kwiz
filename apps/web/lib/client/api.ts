import type {
  ActionResult,
  AnswerMethod,
  GameReview,
  Locale,
  PreflightReport,
  QuizContent,
  RoundType,
} from '@kwiz/domain'

import type { ImportPreview } from '@/lib/server/transfer'

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
async function send<T>(
  path: string,
  body?: unknown,
  /** `X-Kwiz-Device` on player actions (protocol §7.1), and nothing else uses it. */
  extraHeaders?: Record<string, string>,
): Promise<ActionResult<T>> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? { ...(extraHeaders ? { headers: extraHeaders } : {}) }
        : {
            headers: { 'content-type': 'application/json', ...extraHeaders },
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
  /**
   * PRD 2 §13's whole surface in one read (protocol §7.4).
   *
   * Deliberately **not** on the stream: it is O(questions × teams) (D39), and it is re-fetched after
   * a correction rather than patched locally — the server's fold is the only thing that knows what a
   * verdict flip did to a score.
   */
  review: (gameId: string): Promise<ActionResult<GameReview>> =>
    send(`/api/games/${gameId}/review`),

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
  /** §8 — column order is what the room reads left to right, so it is authored (I7). */
  moveCategory: (categoryId: string, direction: 'LEFT' | 'RIGHT') =>
    authoring(`categories/${categoryId}/move`, { direction }),
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

  /*
   * Three of slice 3's play-half actions (protocol §7.2) that the **config** surface drives rather
   * than master control: PRD 2 §12's `[↻]`, its re-sync banner and its overflow menu. They go through
   * the same endpoints as everything else — the surface a request comes from is not a thing the
   * server knows or should care about.
   */
  regenerateCode: (gameId: string) => send(`/api/games/${gameId}/regenerate-code`, {}),

  /**
   * §11.2 — legal at every status, so this is the same call before doors open and mid-round. The
   * optional `startingScore` rides along and becomes an ordinary, revocable adjustment (D41).
   */
  addTeam: (
    gameId: string,
    input: { name: string; colour: string; startingScore?: number; reason?: string },
  ) => send(`/api/games/${gameId}/teams`, input),
  updateTeam: (
    gameId: string,
    teamId: string,
    patch: { name?: string; colour?: string },
  ) => send(`/api/games/${gameId}/teams/${teamId}`, patch),
  resyncGame: (gameId: string) => send(`/api/games/${gameId}/resync`, {}),
  abandonGame: (gameId: string) => send(`/api/games/${gameId}/abandon`, {}),
  /** §12.1 — per game, never in bulk (data model Q5). Cascades; the quiz is untouched. */
  deleteGame: (gameId: string) => send(`/api/games/${gameId}/delete`, {}),

  // ─── this machine (PRD 2 §4, §16) ───

  chooseAddress: (address: string) => send('/api/settings/network/choose', { address }),
  setMute: (muted: boolean) => send('/api/settings/sound/mute', { muted }),
  reclaimSpace: () =>
    send<{ removed: number; bytes: number }>('/api/settings/storage/reclaim', {}),

  /** §4's probe. A GET, so it goes through `send` with no body — the same envelope as everything else. */
  probeStatus: (address: string) =>
    send<{ reached: boolean; userAgent: string | null }>(
      `/api/probe?address=${encodeURIComponent(address)}`,
    ),

  // ─── export and import (PRD 2 §14) ───

  /** §14.1 — real numbers before the master commits to a copy onto a slow USB stick. */
  exportSize: (
    quizId: string,
    options: { includeGames: boolean; includeAttachments: boolean; onlyGameId?: string },
  ) =>
    send<{ bytes: number; attachments: number; games: number }>('/api/transfer', {
      quizId,
      ...options,
      intent: 'size',
    }),

  /**
   * The one call that does not go through `send`: the response is a zip, not an `ActionResult`.
   *
   * The download is triggered from an object URL rather than by navigating, so a failure surfaces
   * here as a typed refusal instead of replacing the page the master is working on with an error.
   */
  downloadExport: async (
    quizId: string,
    options: { includeGames: boolean; includeAttachments: boolean; onlyGameId?: string },
  ): Promise<ActionResult> => {
    try {
      const response = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quizId, ...options, intent: 'download' }),
      })

      if (!response.ok || !response.headers.get('content-type')?.includes('zip')) {
        const parsed: unknown = await response.json().catch(() => undefined)
        if (isActionResult<void>(parsed)) return parsed
        return { ok: false, error: 'VALIDATION_ERROR', message: 'the export failed' }
      }

      const disposition = response.headers.get('content-disposition') ?? ''
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'kwiz-export.zip'
      const url = URL.createObjectURL(await response.blob())

      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)

      return { ok: true }
    } catch (cause) {
      return {
        ok: false,
        error: 'VALIDATION_ERROR',
        message: cause instanceof Error ? cause.message : 'the export failed',
      }
    }
  },

  /** §14.2 — validates and previews. Writes nothing, which is what makes the dialog trustworthy. */
  inspectImport: (file: File) => transfer<{ preview: ImportPreview }>(file, 'inspect'),
  performImport: (file: File, mode: 'COPY' | 'REPLACE') =>
    transfer<{ quizId: string; missing: number }>(file, 'import', mode),
}

/**
 * protocol §7.2's master actions, as **master control** drives them (PRD 3).
 *
 * Bound to one game rather than taking a `gameId` per call, because D21 means every one of them
 * carries it and a surface that has to remember to thread it will eventually not. There is no
 * "the current game" anywhere in this file for the same reason.
 *
 * **None of these returns game state** (protocol §7): the resulting view arrives on the SSE stream,
 * so there is exactly one path by which the desk learns anything. A caller that awaits one of these
 * is waiting for the *refusal*, not for the result.
 */
export function control(gameId: string) {
  const post = (path: string, body: unknown = {}): Promise<ActionResult> =>
    send(`/api/games/${gameId}/${path}`, body)

  return {
    // ─── lifecycle (§4, §9.2) ───
    start: () => post('start'),
    finish: () => post('finish'),
    abandon: () => post('abandon'),
    openRound: (roundId: string) => post(`rounds/${roundId}/open`),
    closeRound: (roundId: string) => post(`rounds/${roundId}/close`),

    // ─── the question (§5) ───
    openQuestion: (questionId: string) => post(`questions/${questionId}/open`),
    lockQuestion: (questionId: string) => post(`questions/${questionId}/lock`),
    revealQuestion: (questionId: string) => post(`questions/${questionId}/reveal`),
    scoreQuestion: (questionId: string) => post(`questions/${questionId}/score`),
    /** §9.1 — pointer-only, never a keystroke: a stray key must not discard a question. */
    skipQuestion: (questionId: string) => post(`questions/${questionId}/skip`),

    // ─── validation and the reveal (§5.3, §6) ───
    /** Also the revalidation path: an auto verdict can be overridden by clicking it (§6.1). */
    validate: (gameQuestionId: string, teamId: string, accepted: boolean) =>
      post('answers/validate', { gameQuestionId, teamId, accepted }),
    spotlight: (gameQuestionId: string, teamId: string, spotlit: boolean) =>
      post('answers/spotlight', { gameQuestionId, teamId, spotlit }),
    /** §11.3 — the one path allowed to overwrite a submission, and it resets the verdict (D47). */
    submitForTeam: (
      gameQuestionId: string,
      teamId: string,
      answer: { text?: string; selectedOptionId?: string },
    ) => post('answers/submit-for-team', { gameQuestionId, teamId, ...answer }),

    // ─── buzzer (§7) ───
    adjudicate: (buzzId: string, accepted: boolean) =>
      post(`buzzes/${buzzId}/adjudicate`, { accepted }),
    /** §7.1's `[Reopen for everyone]` — the master simply misheard (D35 rule 5). */
    reopenBuzzers: (questionId: string) => post(`questions/${questionId}/reopen-buzzers`),

    // ─── DO (§8) ───
    /** `[]` is the explicit *"nobody got it"* (D23), not an omission. */
    doWinners: (questionId: string, teamIds: string[]) =>
      post(`questions/${questionId}/do-winners`, { teamIds }),
    doScores: (questionId: string, scores: { teamId: string; score: number }[]) =>
      post(`questions/${questionId}/do-scores`, { scores }),

    // ─── pacing (§11.1, §11.2) ───
    showScoreboard: (shown: boolean) => post('scoreboard', { shown }),

    /**
     * PRD 4 §6.1 — tell the room's equaliser and elapsed clock what this desk's transport is doing.
     *
     * The `<audio>` element stays here (PRD 3 §5.1); only the *fact* that it is playing crosses over.
     * Appends nothing: playback is not a game fact, so this is the one master call that moves no `seq`.
     */
    setMediaPlayback: (mediaId: string, playing: boolean, positionMs: number) =>
      post('media/playback', { mediaId, playing, positionMs }),

    /** PRD 4 §10.2 / D51 — the projected `FINISHED` screen's two tabs, switched from here. */
    setFinishedTab: (tab: 'RESULT' | 'POINTS') => post('finished-tab', { tab }),
    /** Re-posting during a break is `[Extend break]`; omitting the duration is open-ended. */
    startBreak: (durationMs?: number) =>
      post('break', durationMs === undefined ? {} : { durationMs }),
    endBreak: () => post('break/end'),
    /** §9's `[Change ▾]` and the tie-break buttons are the same call (D30). */
    assignPicker: (teamId: string, reason: 'TIE_BREAK' | 'MASTER_OVERRIDE') =>
      post('picker', { teamId, reason }),

    // ─── the finale (§10) ───
    setFinalists: (teamIds: string[]) => post('finale/finalists', { teamIds }),
    startTurn: (teamId: string) => post('finale/turn/start', { teamId }),
    passTurn: () => post('finale/turn/pass'),
    markKeyword: (keywordId: string) => post(`finale/keywords/${keywordId}/mark`),
    /** §10.4 — reverses the mark **and the seconds it took from every other team**. */
    unmarkKeyword: (keywordId: string) => post(`finale/keywords/${keywordId}/unmark`),
    revealKeywords: (gameQuestionId: string) => post('finale/reveal', { gameQuestionId }),
    /**
     * §10.6 — the browser only reports that a clock has run out; the **server recomputes the exact
     * instant from the log**, so a slow tab cannot skew the ranking.
     */
    eliminate: (teamId: string) => post('finale/eliminate', { teamId }),

    // ─── scores (§11) ───
    adjustScore: (input: {
      teamId: string
      delta: number
      reason?: string
      announced: boolean
    }) => post('adjust-score', input),
    revokeAdjustment: (adjustmentId: string) =>
      post(`adjustments/${adjustmentId}/revoke`),
  }
}

export type ControlApi = ReturnType<typeof control>

async function transfer<T>(
  file: File,
  intent: 'inspect' | 'import',
  mode?: 'COPY' | 'REPLACE',
): Promise<ActionResult<T>> {
  const form = new FormData()
  form.append('file', file)
  form.append('intent', intent)
  if (mode) form.append('mode', mode)

  try {
    const response = await fetch('/api/transfer', { method: 'POST', body: form })
    const parsed: unknown = await response.json()
    if (isActionResult<T>(parsed)) return parsed
    return { ok: false, error: 'MANIFEST_INVALID', message: 'unexpected response' }
  } catch (cause) {
    return {
      ok: false,
      error: 'MANIFEST_INVALID',
      message: cause instanceof Error ? cause.message : 'the import failed',
    }
  }
}

/**
 * PRD 5 — **the player half of protocol §7.1**, as one object bound to a game and a device.
 *
 * The mirror of `control(gameId)`, with one difference that matters: every call carries
 * `X-Kwiz-Device`. That is identity, not authorisation (PRD 1 §4) — it tells the server *which team
 * this is*, which is the only thing a player action needs that a master action does not.
 *
 * `join` is deliberately **not** here: it resolves a game by code rather than by id, and it is the one
 * call a device makes *before* it has a token to bind (see `joinGame`).
 */
export function player(gameId: string, deviceToken: string) {
  const post = (path: string, body: unknown = {}): Promise<ActionResult> =>
    send(`/api/games/${gameId}/${path}`, body, { 'x-kwiz-device': deviceToken })

  return {
    /**
     * D45 — the shared draft. Debounced by the caller (~500 ms) and flushed on blur, so this is a
     * plain write: every one of the team's devices sees the result on the stream.
     */
    draft: (
      gameQuestionId: string,
      answer: { text?: string; selectedOptionId?: string },
    ) => post('draft', { gameQuestionId, ...answer }),

    /**
     * D43 — final. A second submission of the **same** value is the retry path and a no-op; a
     * different one is refused with `ALREADY_SUBMITTED` and the team's canonical answer attached, so
     * the second device can show what its team actually said (protocol §7.3).
     */
    submit: (
      gameQuestionId: string,
      answer: { text?: string; selectedOptionId?: string },
    ) => post('submit', { gameQuestionId, ...answer }),

    /** §8 — the buzz. Repeated taps are harmless: the first counts and the rest are no-ops. */
    buzz: (gameQuestionId: string) => post('buzz', { gameQuestionId }),

    /** §2.4 — a player who tapped the wrong row. Their draft for the current question goes (P4). */
    switchTeam: (toTeamId: string) => post('switch-team', { toTeamId }),
  }
}

export type PlayerApi = ReturnType<typeof player>

/**
 * `POST /api/games/join` — the only action addressed by **code** rather than by game id, because a
 * phone that has just scanned a QR knows nothing else (protocol §7.1).
 *
 * It is also the only one that returns data rather than pushing it: the fresh `deviceToken`.
 */
export function joinGame(
  code: string,
  teamId: string,
): Promise<ActionResult<{ gameId: string; teamId: string; deviceToken: string }>> {
  return send('/api/games/join', { code, teamId })
}
