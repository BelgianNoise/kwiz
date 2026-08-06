import type { QuestionConfig, RoundConfig } from './content-config'
import type { QuestionState } from './question-state'
import type {
  AnswerMethod,
  AnswerVerdict,
  AttachmentKind,
  BuzzOutcome,
  GameStatus,
  Locale,
  RoundType,
} from './vocabulary'

/**
 * The game's **content**: its game-copy subtree, read once and never changed (I16).
 *
 * Separate from the play state because it is not in the event log and never could be — a
 * question's prompt is not something that happened. `reduce` folds events over this, which is
 * what makes the whole reducer a pure function of `(content, events)`.
 */

export interface MediaContent {
  id: string
  kind: AttachmentKind
  position: number
  durationMs: number | null
  /** `IMAGE` only; audio and video are main-screen-only and not configurable (D27, I3). */
  showOnPlayerDevices: boolean
}

export interface OptionContent {
  id: string
  position: number
  text: string
  /** Never leaves `MASTER_CONTROL` before `REVEALED` (invariant 2). */
  isCorrect: boolean
}

export interface KeywordContent {
  id: string
  position: number
  /** Never leaves `MASTER_CONTROL` while unmarked (invariant 8, D53). */
  text: string
  /** The blurred shape the room sees instead. Stored, not derived (I19). */
  wordLengths: number[]
}

export interface QuestionContent {
  id: string
  roundId: string
  /** `JEOPARDY` only (I1). */
  categoryId: string | null
  position: number
  prompt: string
  answerMethod: AnswerMethod
  points: number
  /** Null means inherit the round default. Zero is invalid, not "no timer" (I12). */
  timerMs: number | null
  /** `MASTER_CONTROL` / `CONFIG` only, in every state (invariant 7). */
  masterNotes: string | null
  config: QuestionConfig
  /** `position = 0` is the canonical answer shown at reveal. */
  acceptedAnswers: string[]
  options: OptionContent[]
  /** Exactly 5 for a `DSMTW_FINALE` question (I17). */
  keywords: KeywordContent[]
  media: MediaContent[]
}

export interface CategoryContent {
  id: string
  position: number
  name: string
}

export interface RoundContent {
  id: string
  position: number
  type: RoundType
  title: string
  defaultPoints: number
  defaultTimerMs: number | null
  config: RoundConfig
  categories: CategoryContent[]
  questions: QuestionContent[]
}

export interface GameContent {
  gameId: string
  quizName: string
  code: string
  defaultPlayerLocale: Locale
  rounds: RoundContent[]
}

// ─── play state, folded from the log ───

export interface TeamState {
  id: string
  name: string
  colour: string
  position: number
  /** `sum(pointsAwarded) + sum(non-revoked adjustments)`, always (I9). */
  score: number
  deviceCount: number
  /** `DSMTW_FINALE` only. The **order** of these produces the final ranking (D51). */
  eliminatedAt: number | null
}

export interface AnswerState {
  teamId: string
  text: string | null
  selectedOptionId: string | null
  /** Committed from a stored draft at lock rather than confirmed by the team (D26). */
  isDraft: boolean
  submittedAt: number
  /** The master answered for them (D47). */
  enteredByMaster: boolean
  verdict: AnswerVerdict
  pointsAwarded: number
  validatedAt: number | null
  /** Whether the master has pushed this answer to the room (D40). */
  spotlit: boolean
}

export interface BuzzState {
  buzzId: string
  teamId: string
  receivedAt: number
  offsetMs: number
  outcome: BuzzOutcome
  /** When adjudication ended — the other end of the timer-pause interval (D35). */
  adjudicatedAt: number | null
}

export interface QuestionPlayState {
  state: QuestionState
  openedAt: number | null
  /** Absolute and **advisory**: the server never enforces it (D7, D8). */
  deadlineAt: number | null
  answers: Map<string, AnswerState>
  buzzes: BuzzState[]
  /**
   * Cleared by `BUZZERS_FORCE_REOPENED` when the master accepts they misheard (D35 rule 5).
   * Not stored anywhere — derived from denied buzzes, minus any force-reopen since.
   */
  forceReopenedAt: number | null
}

export interface AdjustmentState {
  id: string
  teamId: string
  delta: number
  reason: string | null
  /** `false` suppresses the main-screen banner only; the row exists regardless (D25). */
  announced: boolean
  revokedAt: number | null
  createdAt: number
}

export interface KeywordMarkState {
  gameKeywordId: string
  gameQuestionId: string
  /** `null` = revealed unguessed (I21). */
  teamId: string | null
  markedAt: number
  revokedAt: number | null
}

export interface FinaleTurn {
  teamId: string
  startedAt: number
  endedAt: number | null
  reason: 'PASSED' | 'ELIMINATED' | 'QUESTION_CLOSED' | null
}

export interface FinaleState {
  /** Overrides the authored defaults, and legal only while `SETUP` (D54). */
  secondsPerPoint: number | null
  penaltySeconds: number | null
  /** The master's selection at round open, minimum 2 (D55). Empty until then. */
  finalistIds: string[]
  /** Fixed at `FINALISTS_SET`, from each finalist's score at that instant. */
  startingSeconds: Map<string, number>
  turns: FinaleTurn[]
  /** Rank groups, best first — simultaneous elimination shares a rank (D51, PRD 1 §8.8). */
  ranking: string[][] | null
  endedAt: number | null
}

export interface BreakState {
  startedAt: number
  /** Absolute, so a screen connecting mid-break shows the right remaining time (D7). */
  resumesAt: number | null
}

export interface GameState {
  content: GameContent
  status: GameStatus
  startedAt: number | null
  finishedAt: number | null
  /** Regenerable while `SETUP`; overrides `content.code` once it has been. */
  code: string
  quizRevision: number

  teams: Map<string, TeamState>
  /** `deviceId → teamId`. `lastSeenAt` is deliberately absent: nothing here may read it. */
  devices: Map<string, string>

  currentRoundId: string | null
  currentQuestionId: string | null

  /** Keyed by `gameQuestionId`. Every question has an entry, `PENDING` until opened. */
  questions: Map<string, QuestionPlayState>

  adjustments: AdjustmentState[]
  /** Keyed by `gameKeywordId` — at most one live mark per keyword. */
  keywordMarks: Map<string, KeywordMarkState>
  finale: FinaleState

  break: BreakState | null
  /** Master pushed the leaderboard mid-round; cleared when the next question opens (O4). */
  scoreboardShown: boolean

  /** Jeopardy (D30). `reason` is kept because tie-breaks and overrides are decisions. */
  picker: { teamId: string; reason: 'RULE' | 'TIE_BREAK' | 'MASTER_OVERRIDE' } | null

  /** The head of the log this state was folded from — the SSE `id` for any pushed view. */
  seq: number
}

// ─── lookups over content ───

export function allQuestions(content: GameContent): QuestionContent[] {
  return content.rounds.flatMap((round) => round.questions)
}

export function findQuestion(
  content: GameContent,
  gameQuestionId: string,
): QuestionContent | undefined {
  return allQuestions(content).find((question) => question.id === gameQuestionId)
}

export function findRound(
  content: GameContent,
  roundId: string,
): RoundContent | undefined {
  return content.rounds.find((round) => round.id === roundId)
}

export function roundOf(
  content: GameContent,
  gameQuestionId: string,
): RoundContent | undefined {
  return content.rounds.find((round) =>
    round.questions.some((q) => q.id === gameQuestionId),
  )
}

/** Null means inherit the round default (I12). */
export function effectiveTimerMs(
  content: GameContent,
  question: QuestionContent,
): number | null {
  return question.timerMs ?? roundOf(content, question.id)?.defaultTimerMs ?? null
}
