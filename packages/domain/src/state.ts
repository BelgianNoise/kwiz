import type { QuestionConfig, RoundConfig } from './content-config'
import type { QuestionState } from './question-state'
import type {
  AnswerMethod,
  AnswerVerdict,
  AttachmentKind,
  BuzzOutcome,
  GameStatus,
  Locale,
  MainScreenColourScheme,
  MainScreenTypography,
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
  /**
   * Authoring display only (PRD 2 §7.1, data model §4.7) — **never** part of an audience view.
   *
   * The on-disk name is the content hash, so this is the master's own filename kept purely so a
   * question with three images is tellable apart. Payload filters construct rather than strip
   * (CLAUDE.md §2.3), so neither field reaches a view unless someone adds it by name.
   */
  originalName: string
  sizeBytes: number
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
  /** The quiz's default at the moment this game was created (D60); `mainScreenThemeOverride` may replace it. */
  mainScreenColourScheme: MainScreenColourScheme
  mainScreenTypography: MainScreenTypography
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
  /**
   * How many times a **settled** verdict was changed (PRD 2 §13.1).
   *
   * The review grid marks corrected cells and counts them per round, *"visible, not hidden, because
   * an auditable correction is the point."* Only a flip counts: the first judgement of a `PENDING`
   * free-text answer is the master doing their job, not changing their mind — whereas turning an
   * auto-`ACCEPTED` into a `DENIED`, or back, is exactly the thing they want to be able to see.
   *
   * Derived by counting, not stored: `ANSWER_VALIDATED` supersedes rather than accumulating, so
   * nothing else in the state remembers that a decision was ever different.
   */
  corrections: number
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

/**
 * A finale turn. `endedAt`/`reason` are set by whatever stopped it — and **every transition that can
 * stop a finale question being `OPEN` has to end the open turn**, or the clock keeps charging a team
 * for a question nobody is playing. There is no compiler-enforced link, so the two call sites are
 * named here: `endOpenFinaleTurn` in `decide.ts`, invoked from `LOCK_QUESTION` and `SKIP_QUESTION`.
 * A future transition that closes a question needs a third call, by convention only.
 */
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

/**
 * Which of the `FINISHED` screen's two tabs the room is on (D51, PRD 4 §10.2).
 *
 * `RESULT` decides the game — survival order out of the finale. `POINTS` is the pre-finale
 * leaderboard, kept because the team that scored highest is often *not* the one that won. The tabs
 * render on the projected screen but are switched from control, since that surface has no controls
 * of its own (PRD 4 §2.3).
 */
export type FinishedTab = 'RESULT' | 'POINTS'

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

  /**
   * Rounds the master has closed.
   *
   * `ROUND_CLOSED` deliberately leaves `currentRoundId` pointing at the closed round — the desk's
   * timeline is still about it — so without this the room saw that round's *intro* again in the gap
   * before the next one opened. PRD 4 §3 puts a leaderboard between rounds, and §4's waiting screen
   * is for before the game starts, so neither of the two stages this would otherwise resolve to is
   * the right one.
   */
  closedRoundIds: Set<string>

  /** Keyed by `gameQuestionId`. Every question has an entry, `PENDING` until opened. */
  questions: Map<string, QuestionPlayState>

  adjustments: AdjustmentState[]
  /** Keyed by `gameKeywordId` — at most one live mark per keyword. */
  keywordMarks: Map<string, KeywordMarkState>
  finale: FinaleState

  break: BreakState | null
  /** Master pushed the leaderboard mid-round; cleared when the next question opens (O4). */
  scoreboardShown: boolean

  /**
   * Ranks as of the last time the room was shown a leaderboard, and as of the time before that.
   *
   * PRD 4 §10's `▲2` is *"rank movement since the last leaderboard"*, which is the cheapest drama
   * available and the thing that makes a leaderboard a moment rather than a table. It needs a
   * baseline, and a baseline is not derivable from scores alone — two teams can swap twice between
   * showings and end where they started. So each showing captures the ranks it displayed, and the
   * *previous* capture is what the arrows are measured against. `null` on the first leaderboard of a
   * game: nothing has moved yet, and inventing a `▲` would be a lie about a game that just started.
   */
  leaderboardRanks: Map<string, number> | null
  previousLeaderboardRanks: Map<string, number> | null

  /** PRD 4 §10.2's two tabs, switched from control (D51). */
  finishedTab: FinishedTab

  /**
   * Overrides `content.mainScreenColourScheme`/`mainScreenTypography` once set (D60).
   *
   * `null` until the master changes it on this game, at which point it wins over the copied
   * default forever after — the same "authored default, event overrides it" shape as
   * `FinaleState.secondsPerPoint`/`penaltySeconds` (D54), and for the same reason: the game copy
   * itself is write-once (I16), so a later change has to live beside it rather than in it. Unlike
   * the finale settings, legal at **any** status, including `LIVE` — a theme that reads badly on
   * a real projector is worth fixing without restarting the game.
   */
  mainScreenThemeOverride: {
    colourScheme: MainScreenColourScheme
    typography: MainScreenTypography
  } | null

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
