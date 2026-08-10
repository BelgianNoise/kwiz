import { normaliseAnswer } from './answers'
import { doConfigSchema } from './content-config'
import {
  activeFinalists,
  currentFinaleTurn,
  finaleRemainingSeconds,
  finaleTurnOrder,
  firstBuzzTeamId,
  buzzersLive,
  isLockedOut,
  lockedOutTeamIds,
  passedThisQuestion,
  standings,
  timerFor,
  awaitingBuzz,
  suggestedPicker,
  type Standing,
  type Timer,
} from './derive'
import { missedSoFar, type MissedSoFar } from './late-team'
import { questionFindings, type PreflightCode } from './preflight'
import { revealsCorrectAnswer } from './question-state'
import {
  allQuestions,
  findQuestion,
  roundOf,
  type GameState,
  type MediaContent,
  type OptionContent,
  type QuestionContent,
  type QuestionPlayState,
  type RoundContent,
} from './state'
import type {
  AnswerVerdict,
  BuzzOutcome,
  DoScoringMode,
  GameStatus,
  Locale,
  RoundType,
  TiePayout,
} from './vocabulary'

/**
 * protocol §5–§6 — one filter per audience.
 *
 * **Every one of these is an allowlist that CONSTRUCTS.** None takes internal state and deletes
 * from it. That is not style: a filter that strips fields fails silently the day someone adds a
 * field, whereas a filter that builds up fails visibly, by omitting it. If you catch yourself
 * writing `delete view.correctAnswer` or `{ ...state, correctAnswer: undefined }`, the code is
 * wrong even when the output looks right.
 *
 * The enforcement is `views.sentinel.test.ts`, which asserts distinctive secret strings appear
 * nowhere in `JSON.stringify(view)` across every (audience × question state) pair. **Add a
 * sentinel when you add a secret.**
 */

// ─── shared shapes ───

export interface TeamPublic {
  id: string
  name: string
  colour: string
  score: number
}

export interface MediaRef {
  id: string
  kind: MediaContent['kind']
  url: string
  durationMs: number | null
}

export interface FinaleKeywordView {
  id: string
  position: number
  /** Always present: the blurred shape (D53). */
  wordLengths: number[]
  /** Present **only** once marked or revealed. Absent otherwise — not empty, absent. */
  text?: string
  teamId?: string | null
}

export interface FinaleView {
  prompt: string
  keywords: FinaleKeywordView[]
  clocks: {
    teamId: string
    name: string
    colour: string
    /** Seconds at the START of the turn; clients count down from `turnStartedAt` (D52). */
    secondsAtTurnStart: number
    onTurn: boolean
    eliminated: boolean
  }[]
  turnStartedAt: number | null
  currentTeamId: string | null
  nextTeamId: string | null
  penaltySeconds: number
  questionNumber: number
  questionTotal: number
}

export interface BoardView {
  categories: { id: string; name: string }[]
  /** Values and used-state **only**. Never prompts (invariant 5). */
  tiles: { id: string; categoryId: string; points: number; used: boolean }[]
}

const mediaRef = (media: MediaContent): MediaRef => ({
  id: media.id,
  kind: media.kind,
  url: `/api/attachment/${media.id}`,
  durationMs: media.durationMs,
})

/**
 * `{ id, text }` — no correctness marker before `REVEALED` (invariant 2). Shared between the
 * main-screen and player views so a future edit adding `isCorrect` back in cannot land at only
 * one of the two call sites and silently reopen the leak invariant 2 exists to prevent.
 */
const publicOptions = (options: OptionContent[]): { id: string; text: string }[] =>
  options.map((option) => ({ id: option.id, text: option.text }))

const teamPublic = (team: {
  id: string
  name: string
  colour: string
  score: number
}): TeamPublic => ({
  id: team.id,
  name: team.name,
  colour: team.colour,
  score: team.score,
})

/**
 * A keyword as the **room** may see it. `text` is attached only once a live mark exists — the
 * payload for an unmarked keyword carries the shape and nothing else, which is why `wordLengths` is
 * stored rather than derived here (I19): this function never has to hold `text` in a variable.
 */
function keywordView(
  state: GameState,
  keyword: { id: string; position: number; text: string; wordLengths: number[] },
): FinaleKeywordView {
  const mark = state.keywordMarks.get(keyword.id)
  const live = mark && mark.revokedAt === null

  const base: FinaleKeywordView = {
    id: keyword.id,
    position: keyword.position,
    wordLengths: keyword.wordLengths,
  }
  // Built up, never stripped: an unmarked keyword's payload simply has no `text` key.
  return live ? { ...base, text: keyword.text, teamId: mark.teamId } : base
}

function finaleView(
  state: GameState,
  question: QuestionContent,
  now: number,
): FinaleView {
  const round = roundOf(state.content, question.id)
  const turn = currentFinaleTurn(state)
  const order = finaleTurnOrder(state, question.id, now)
  const finaleQuestions = round?.questions ?? []

  return {
    prompt: question.prompt,
    keywords: question.keywords.map((keyword) => keywordView(state, keyword)),
    clocks: state.finale.finalistIds.map((teamId) => {
      const team = state.teams.get(teamId)
      const onTurn = turn?.teamId === teamId
      return {
        teamId,
        name: team?.name ?? '',
        colour: team?.colour ?? '',
        // At the *start* of the turn: the client counts down from `turnStartedAt`, because the
        // server never pushes a tick (D52).
        secondsAtTurnStart: finaleRemainingSeconds(state, teamId, turn?.startedAt ?? now),
        onTurn,
        eliminated: (team?.eliminatedAt ?? null) !== null,
      }
    }),
    turnStartedAt: turn?.startedAt ?? null,
    currentTeamId: turn?.teamId ?? null,
    nextTeamId: order.find((teamId) => teamId !== turn?.teamId) ?? null,
    penaltySeconds: state.finale.penaltySeconds ?? 0,
    questionNumber: finaleQuestions.findIndex((q) => q.id === question.id) + 1,
    questionTotal: finaleQuestions.length,
  }
}

function boardView(state: GameState, roundId: string): BoardView {
  const round = state.content.rounds.find((r) => r.id === roundId)
  return {
    categories: (round?.categories ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((category) => ({ id: category.id, name: category.name })),
    // No `prompt` key at all — invariant 5 is enforced by this object's shape.
    tiles: (round?.questions ?? []).map((question) => ({
      id: question.id,
      categoryId: question.categoryId ?? '',
      points: question.points,
      used: (state.questions.get(question.id)?.state ?? 'PENDING') !== 'PENDING',
    })),
  }
}

// ─── stage resolution ───

type StageKind =
  | 'FINISHED'
  | 'BREAK'
  | 'LEADERBOARD'
  | 'FINALE'
  | 'QUESTION'
  | 'JEOPARDY_BOARD'
  | 'ROUND_INTRO'
  | 'WAITING'

/**
 * Which stage the room and the players are on. One resolver for both audiences, so a screen and a
 * phone can never disagree about what is happening.
 */
function stageKind(state: GameState): StageKind {
  if (state.status === 'FINISHED' || state.status === 'ABANDONED') return 'FINISHED'
  if (state.break) return 'BREAK'
  if (state.status === 'SETUP') return 'WAITING'
  if (state.scoreboardShown) return 'LEADERBOARD'

  const question = state.currentQuestionId
    ? findQuestion(state.content, state.currentQuestionId)
    : undefined

  // A skipped question stays `currentQuestionId` — the master went around it — but it is done, so
  // it must not be presented as an open question accepting answers (D46). Falling through lands on
  // the round intro, which is what the room should see while the master moves on.
  const play = question ? state.questions.get(question.id) : undefined
  if (question && play && play.state !== 'SKIPPED') {
    const round = roundOf(state.content, question.id)
    if (round?.type === 'DSMTW_FINALE') return 'FINALE'
    return 'QUESTION'
  }

  const round = state.currentRoundId
    ? state.content.rounds.find((r) => r.id === state.currentRoundId)
    : undefined
  if (round?.type === 'JEOPARDY') return 'JEOPARDY_BOARD'
  if (round) return 'ROUND_INTRO'
  return 'WAITING'
}

/** The state a question is *presented* in. `PENDING` and `SKIPPED` never reach the room. */
type VisibleQuestionState = 'OPEN' | 'LOCKED' | 'REVEALED' | 'SCORED'

/**
 * `PENDING` and `SKIPPED` are unreachable here: `stageKind` only yields `QUESTION` for a current
 * question, which cannot be `PENDING`, and explicitly excludes `SKIPPED`. The fallback exists so
 * the type is total, not because either state is expected.
 */
const visibleState = (play: QuestionPlayState): VisibleQuestionState =>
  play.state === 'PENDING' || play.state === 'SKIPPED' ? 'OPEN' : play.state

// ─── MAIN_SCREEN ───

export interface MainScreenQuestion {
  id: string
  prompt: string
  points: number
  media: MediaRef[]
  timer: Timer | null
  state: VisibleQuestionState
  options?: { id: string; text: string }[]
  buzzes?: { teamId: string; offsetMs: number; outcome: BuzzOutcome }[]
  lockedOutTeamIds?: string[]
  correctAnswer?: string
  correctOptionId?: string
  spotlitAnswers?: { teamId: string; text: string; correct: boolean | null }[]
  optionDistribution?: { optionId: string; teamIds: string[] }[]
  awarded?: { teamId: string; points: number }[]
}

export interface MainScreenView {
  code: string
  joinUrl: string
  teams: TeamPublic[]
  stage:
    | { kind: 'WAITING_FOR_PLAYERS'; joinedTeamIds: string[] }
    | { kind: 'ROUND_INTRO'; title: string; roundNumber: number; totalRounds: number }
    | { kind: 'LEADERBOARD'; standings: Standing[] }
    | { kind: 'BREAK'; resumesAt: number | null; standings: Standing[] }
    | { kind: 'QUESTION'; question: MainScreenQuestion }
    | { kind: 'FINALE'; finale: FinaleView }
    | { kind: 'JEOPARDY_BOARD'; board: BoardView; currentPickerTeamId: string | null }
    | { kind: 'FINISHED'; standings: Standing[] }
}

export function toMainScreenView(
  state: GameState,
  now: number,
  joinUrl = '',
): MainScreenView {
  const teams = [...state.teams.values()]
    .sort((a, b) => a.position - b.position)
    .map(teamPublic)

  return {
    code: state.code,
    joinUrl,
    teams,
    stage: mainScreenStage(state, now),
  }
}

function mainScreenStage(state: GameState, now: number): MainScreenView['stage'] {
  const kind = stageKind(state)

  switch (kind) {
    case 'FINISHED':
      return { kind: 'FINISHED', standings: standings(state) }
    case 'BREAK':
      return {
        kind: 'BREAK',
        resumesAt: state.break?.resumesAt ?? null,
        standings: standings(state),
      }
    case 'LEADERBOARD':
      return { kind: 'LEADERBOARD', standings: standings(state) }
    case 'WAITING':
      return {
        kind: 'WAITING_FOR_PLAYERS',
        joinedTeamIds: [...new Set(state.devices.values())],
      }
    case 'JEOPARDY_BOARD':
      return {
        kind: 'JEOPARDY_BOARD',
        board: boardView(state, state.currentRoundId ?? ''),
        currentPickerTeamId: state.picker?.teamId ?? null,
      }
    case 'ROUND_INTRO': {
      const index = state.content.rounds.findIndex((r) => r.id === state.currentRoundId)
      return {
        kind: 'ROUND_INTRO',
        title: state.content.rounds[index]?.title ?? '',
        roundNumber: index + 1,
        totalRounds: state.content.rounds.length,
      }
    }
    case 'FINALE': {
      const question = findQuestion(state.content, state.currentQuestionId ?? '')
      // A finale round with no open question falls back rather than inventing a stage.
      if (!question) return { kind: 'LEADERBOARD', standings: standings(state) }
      return { kind: 'FINALE', finale: finaleView(state, question, now) }
    }
    case 'QUESTION': {
      const question = findQuestion(state.content, state.currentQuestionId ?? '')
      const play = question && state.questions.get(question.id)
      if (!question || !play) return { kind: 'LEADERBOARD', standings: standings(state) }
      return {
        kind: 'QUESTION',
        question: mainScreenQuestion(question, play, now),
      }
    }
    default:
      // `stageKind` is exhaustive; `default` rather than a trailing return, which reads as a
      // missing case.
      return { kind: 'LEADERBOARD', standings: standings(state) }
  }
}

function mainScreenQuestion(
  question: QuestionContent,
  play: QuestionPlayState,
  now: number,
): MainScreenQuestion {
  const revealed = revealsCorrectAnswer(play.state)

  // Only ever what the room may see. `masterNotes` and `isCorrect` have no key here at all, and
  // submission progress is deliberately absent — nothing renders it, and an unused field on an
  // audience payload is what gets rendered by accident later (protocol §5.2).
  const view: MainScreenQuestion = {
    id: question.id,
    prompt: question.prompt,
    points: question.points,
    // Main-screen-visible media is everything: `showOnPlayerDevices` gates the *player* only (D27).
    media: question.media.map(mediaRef),
    timer: timerFor(play, now),
    state: visibleState(play),
  }

  if (question.answerMethod === 'MULTIPLE_CHOICE') {
    // Ids are UUIDs so nothing in the payload even ranks the options (protocol §6.3).
    view.options = publicOptions(question.options)
  }

  if (question.answerMethod === 'BUZZER') {
    // Safe at any state: a buzz is not an answer.
    view.buzzes = play.buzzes.map((buzz) => ({
      teamId: buzz.teamId,
      offsetMs: buzz.offsetMs,
      outcome: buzz.outcome,
    }))
    view.lockedOutTeamIds = lockedOutTeamIds(play)
  }

  if (revealed) {
    view.correctAnswer = question.acceptedAnswers[0]
    const correct = question.options.find((option) => option.isCorrect)
    if (correct) view.correctOptionId = correct.id

    if (question.answerMethod === 'MULTIPLE_CHOICE') {
      // Compact at any team count, and the visual highlight of an MC reveal (D40).
      view.optionDistribution = question.options.map((option) => ({
        optionId: option.id,
        teamIds: [...play.answers.values()]
          .filter((answer) => answer.selectedOptionId === option.id)
          .map((answer) => answer.teamId),
      }))
    } else {
      // **Only** answers the master has spotlighted (D40) — never the full set. A 20-row answer
      // table is illegible at projector scale, and each team already has its verdict on its phone.
      view.spotlitAnswers = [...play.answers.values()]
        .filter((answer) => answer.spotlit && answer.text !== null)
        .map((answer) => ({
          teamId: answer.teamId,
          text: answer.text ?? '',
          correct: verdictToPublic(answer.verdict),
        }))
    }
  }

  if (play.state === 'SCORED') {
    view.awarded = [...play.answers.values()].map((answer) => ({
      teamId: answer.teamId,
      points: answer.pointsAwarded,
    }))
  }

  return view
}

/** `null` while the master has not decided — the room is not told a verdict is outstanding. */
function verdictToPublic(verdict: AnswerVerdict): boolean | null {
  if (verdict === 'AUTO_CORRECT' || verdict === 'ACCEPTED') return true
  if (verdict === 'AUTO_WRONG' || verdict === 'DENIED') return false
  return null
}

// ─── PLAYER ───

export interface PlayerQuestion {
  id: string
  prompt: string
  answerMethod: 'FREE_TEXT' | 'MULTIPLE_CHOICE' | 'BUZZER' | 'DO'
  media: MediaRef[]
  timer: Timer | null
  state: VisibleQuestionState
  points: number
  options?: { id: string; text: string }[]
  buzzersLive?: boolean
  iAmLockedOut?: boolean
  firstBuzzTeamId?: string | null
  correctAnswer?: string
  correctOptionId?: string
  myVerdict?: 'CORRECT' | 'INCORRECT' | 'PENDING'
  myPoints?: number
}

export interface MyAnswer {
  text: string | null
  optionId: string | null
  submitted: boolean
  submittedAt: number | null
}

/**
 * A team's in-progress draft for one question, keyed by `gameQuestionId`.
 *
 * Drafts are **not events** (protocol §4.8) — keystroke timing is not reproducible by replay — so
 * they cannot come from `GameState`. They are passed in instead, which keeps this layer pure while
 * making D45 impossible to forget: shared drafts are a *parameter* of the player view, not
 * something a caller has to remember to merge in afterwards.
 */
export interface DraftAnswer {
  text: string | null
  optionId: string | null
}

export type DraftLookup = ReadonlyMap<string, DraftAnswer>

export interface PlayerView {
  team: TeamPublic
  otherTeams: TeamPublic[]
  locale: Locale
  stage:
    | { kind: 'WAITING'; teamCount: number }
    | { kind: 'BETWEEN_QUESTIONS' }
    | { kind: 'BREAK'; resumesAt: number | null; standings: Standing[] }
    | { kind: 'QUESTION'; question: PlayerQuestion; myAnswer: MyAnswer | null }
    | { kind: 'FINALE'; finale: FinaleView; iAmFinalist: boolean }
    | { kind: 'JEOPARDY_BOARD'; board: BoardView; currentPickerTeamId: string | null }
    | { kind: 'FINISHED'; standings: Standing[] }
}

export function toPlayerView(
  state: GameState,
  teamId: string,
  now: number,
  /** The team's drafts (D45). Omitted means none — never means "do not share them". */
  drafts: DraftLookup = new Map(),
): PlayerView {
  const me = state.teams.get(teamId)

  return {
    team: teamPublic(me ?? { id: teamId, name: '', colour: '', score: 0 }),
    // Names, colours and scores — the leaderboard is public. **Never a single character of another
    // team's answer** (invariant 3), which is why this maps to `TeamPublic` and nothing wider.
    otherTeams: [...state.teams.values()]
      .filter((team) => team.id !== teamId)
      .sort((a, b) => a.position - b.position)
      .map(teamPublic),
    locale: state.content.defaultPlayerLocale,
    stage: playerStage(state, teamId, now, drafts),
  }
}

function playerStage(
  state: GameState,
  teamId: string,
  now: number,
  drafts: DraftLookup,
): PlayerView['stage'] {
  const kind = stageKind(state)

  switch (kind) {
    case 'FINISHED':
      return { kind: 'FINISHED', standings: standings(state) }
    case 'BREAK':
      return {
        kind: 'BREAK',
        resumesAt: state.break?.resumesAt ?? null,
        standings: standings(state),
      }
    case 'WAITING':
      return { kind: 'WAITING', teamCount: state.teams.size }
    // A player has no leaderboard stage of its own; the scoreboard is a main-screen device.
    case 'LEADERBOARD':
    case 'ROUND_INTRO':
      return { kind: 'BETWEEN_QUESTIONS' }
    case 'JEOPARDY_BOARD':
      return {
        kind: 'JEOPARDY_BOARD',
        board: boardView(state, state.currentRoundId ?? ''),
        currentPickerTeamId: state.picker?.teamId ?? null,
      }
    case 'FINALE': {
      const question = findQuestion(state.content, state.currentQuestionId ?? '')
      if (!question) return { kind: 'BETWEEN_QUESTIONS' }
      return {
        kind: 'FINALE',
        // The same `FinaleView` the room gets: neither audience may see keyword text before it is
        // marked, so there is one shape and one filter for both (invariant 8).
        finale: finaleView(state, question, now),
        iAmFinalist: state.finale.finalistIds.includes(teamId),
      }
    }
    case 'QUESTION': {
      const question = findQuestion(state.content, state.currentQuestionId ?? '')
      const play = question && state.questions.get(question.id)
      if (!question || !play) return { kind: 'BETWEEN_QUESTIONS' }
      return {
        kind: 'QUESTION',
        question: playerQuestion(question, play, teamId, now),
        myAnswer: myAnswer(play, teamId, drafts.get(question.id)),
      }
    }
    default:
      // `stageKind` is exhaustive; `default` rather than a trailing return, which reads as a
      // missing case.
      return { kind: 'BETWEEN_QUESTIONS' }
  }
}

function playerQuestion(
  question: QuestionContent,
  play: QuestionPlayState,
  teamId: string,
  now: number,
): PlayerQuestion {
  const revealed = revealsCorrectAnswer(play.state)

  const view: PlayerQuestion = {
    id: question.id,
    prompt: question.prompt,
    // `KEYWORDS` cannot appear: a finale question is delivered through the FINALE stage, never
    // through QUESTION (protocol §5.3), so it is coerced rather than widening the union.
    answerMethod: question.answerMethod === 'KEYWORDS' ? 'DO' : question.answerMethod,
    // Images with `showOnPlayerDevices` only. Audio and video are main-screen-only (D27, I3).
    media: question.media
      .filter((media) => media.kind === 'IMAGE' && media.showOnPlayerDevices)
      .map(mediaRef),
    timer: timerFor(play, now),
    state: visibleState(play),
    points: question.points,
  }

  if (question.answerMethod === 'MULTIPLE_CHOICE') {
    view.options = publicOptions(question.options)
  }

  if (question.answerMethod === 'BUZZER') {
    view.buzzersLive = buzzersLive(play)
    // Drives the disabled-with-a-reason state rather than a silent dead button (D35).
    view.iAmLockedOut = isLockedOut(play, teamId)
    // Who beat us — public, and part of the fun.
    view.firstBuzzTeamId = firstBuzzTeamId(play)
  }

  if (revealed) {
    view.correctAnswer = question.acceptedAnswers[0]
    const correct = question.options.find((option) => option.isCorrect)
    if (correct) view.correctOptionId = correct.id

    const mine = play.answers.get(teamId)
    if (mine) {
      const publicVerdict = verdictToPublic(mine.verdict)
      view.myVerdict =
        publicVerdict === null ? 'PENDING' : publicVerdict ? 'CORRECT' : 'INCORRECT'
      view.myPoints = mine.pointsAwarded
    }
  }

  return view
}

/**
 * Shared across **all** of the team's devices (D45), including the draft, so two devices cannot
 * diverge — and `submitted` locks the input on every one of them at once (D43).
 */
function myAnswer(
  play: QuestionPlayState,
  teamId: string,
  draft: DraftAnswer | undefined,
): MyAnswer | null {
  const mine = play.answers.get(teamId)

  // A submission wins over a draft: submission is final (D43), so once one exists the draft is
  // stale by definition and `submitted: true` locks the input on every device at once.
  if (mine) {
    return {
      text: mine.text,
      optionId: mine.selectedOptionId,
      submitted: !mine.isDraft,
      submittedAt: mine.submittedAt,
    }
  }

  // No submission yet, so the draft is what every one of the team's devices should show — that is
  // what stops two phones diverging (D45).
  if (draft) {
    return {
      text: draft.text,
      optionId: draft.optionId,
      submitted: false,
      submittedAt: null,
    }
  }

  return null
}

/**
 * What a `state` frame carries: exactly one of the three filtered views (protocol §5).
 *
 * Named as a union rather than left as `unknown` at the transport boundary so that a client — and a
 * test — can narrow it by shape instead of asserting. The members are structurally distinct:
 * `attention` marks master control, `team` marks a player, and neither appears on the main screen.
 */
export type AudienceView = MainScreenView | PlayerView | MasterControlView

// ─── MASTER_CONTROL ───

export interface ValidationItem {
  teamId: string
  teamName: string
  teamColour: string
  answerText: string | null
  verdict: AnswerVerdict
  isDraft: boolean
  enteredByMaster: boolean
  /** A soft aid only: identical text is linked so an inconsistent pair is hard to miss. */
  hasIdenticalSibling: boolean
  /** PRD 3 §5.3 — whether this answer is currently on the projector, so the toggle can say so. */
  spotlit: boolean
}

export interface MasterQuestionDetail {
  gameQuestionId: string
  prompt: string
  answerMethod: 'FREE_TEXT' | 'MULTIPLE_CHOICE' | 'BUZZER' | 'DO'
  points: number
  state: QuestionPlayState['state']
  timer: Timer | null
  masterNotes: string | null
  acceptedAnswers: string[]
  options?: { id: string; text: string; isCorrect: boolean }[]
  media: MediaRef[]
  teamAnswers: ValidationItem[]
  buzzes?: { buzzId: string; teamId: string; offsetMs: number; outcome: BuzzOutcome }[]
  lockedOutTeamIds?: string[]
  /** PRD 2 §10's *play anyway* marker (`⚠`). The code only — copy lives in the messages module. */
  failsPreflight?: PreflightCode
}

/**
 * One row of PRD 3 §2.1's timeline: `Q1✓ Q2✓ Q3✓ [Q4] Q5 Q6⚠ Q7`.
 *
 * The **current round's** questions, so this is O(questions in a round) — the same bound
 * `MasterBoardView` already accepts for a Jeopardy board's tiles, and nowhere near D39's
 * O(questions × teams) ceiling. `prompt` is master-only, for the same reason a tile's is: the master
 * has to be able to answer *"what did I skip?"* without navigating away from the desk.
 */
export interface TimelineEntry {
  gameQuestionId: string
  position: number
  prompt: string
  state: QuestionPlayState['state']
  failsPreflight?: PreflightCode
}

/**
 * PRD 3 §11's *"recent adjustments are listed with `[Undo]`"*.
 *
 * **Capped at the most recent few, newest first.** The full audit is PRD 2 §13.3's, which is a REST
 * read over a finished game — an evening's worth of adjustments is unbounded and has no business on
 * every push (§1.1). Revoked ones stay in the list, greyed, because a master who undid the wrong one
 * needs to see that they did.
 */
export interface MasterAdjustment {
  id: string
  teamId: string
  delta: number
  reason: string | null
  announced: boolean
  revoked: boolean
  createdAt: number
}

/** How many of §11's adjustments ride along on every push. */
const RECENT_ADJUSTMENTS = 8

/**
 * What the master's primary button should do next. `LOCK` is `[Close answers]` — the only thing
 * that ends a question, since the timer is advisory and never does (D8).
 */
export type AdvanceSuggestion =
  | 'LOCK'
  | 'REVEAL'
  | 'NEXT_QUESTION'
  | 'NEXT_ROUND'
  | 'FINISH'

export type Attention =
  | { kind: 'NONE' }
  | {
      kind: 'ADJUDICATE_BUZZ'
      buzz: {
        buzzId: string
        teamId: string
        teamName: string
        teamColour: string
        offsetMs: number
        otherBuzzes: {
          buzzId: string
          teamId: string
          offsetMs: number
          outcome: BuzzOutcome
        }[]
        lockedOutTeamIds: string[]
        timerPaused: boolean
      }
      referenceAnswer: string
    }
  | {
      kind: 'FINALE_TURN'
      gameQuestionId: string
      prompt: string
      masterNotes: string | null
      /**
       * PRD 1 §8.5 — attachments work on **every** question type, and §8.8 says so explicitly for a
       * finale: *"attachments work as on any question, though a keyword question rarely needs one."*
       * The authoring surface agrees and lets a master attach one, so the desk has to be able to
       * play it — rare is not never, and the alternative is media that can be attached and never
       * triggered.
       */
      media: MediaRef[]
      questionNumber: number
      questionTotal: number
      /**
       * **Null between turns** — a finale question that has just opened, and the gap after a pass
       * before the next team is started. §10.5 says clocks stop while nobody is on turn, so this is
       * the same desk with the clock not yet running rather than a screen of its own; `nextTeamId`
       * is then who `[Start <team>]` would start, by the fewest-seconds rule (PRD 1 §8.8).
       */
      currentTeamId: string | null
      nextTeamId: string | null
      turnStartedAt: number | null
      penaltySeconds: number
      /** The master always sees the text; no other audience does before marking (D53). */
      keywords: {
        id: string
        position: number
        text: string
        markedByTeamId: string | null
        revealed: boolean
      }[]
      clocks: {
        teamId: string
        name: string
        colour: string
        secondsAtTurnStart: number
        onTurn: boolean
        eliminated: boolean
        /** §10.2's *"out 21:03"* — a wall-clock instant, so the master can say when (§8.2). */
        eliminatedAt: number | null
        passedThisQuestion: boolean
      }[]
      /** Nobody left to pass to → offer `[Reveal remaining]`. */
      allRemainingPassed: boolean
    }
  | {
      kind: 'SCORE_DO'
      gameQuestionId: string
      prompt: string
      /** Also the per-team maximum for `PER_TEAM_SCORE` (D24). */
      points: number
      scoringMode: DoScoringMode
      /** `WINNER_TAKES_ALL` only (D23) — irrelevant, but always present, for `PER_TEAM_SCORE`. */
      tiePayout: TiePayout
      masterNotes: string | null
      /**
       * `score: null` is **not yet scored**, distinct from a saved `0` (D24's "empty and zero look
       * different") — `SET_DO_SCORES` may be called with fewer than every team (§8.2's "1 of 4
       * scored"), so this must read what has actually been saved per team, not assume completeness.
       */
      teams: { teamId: string; name: string; colour: string; score: number | null }[]
    }
  | { kind: 'BREAK_TIE_FOR_PICK'; tiedTeamIds: string[] }
  | {
      kind: 'PICK_FINALISTS'
      candidates: {
        teamId: string
        name: string
        colour: string
        score: number
        seconds: number
      }[]
      /**
       * The two settings behind `seconds`. PRD 3 §10.1 restates the penalty arithmetic live against
       * the finalist count — *"20s → up to 320s off a 490s pool"* — and that is the one number
       * deciding whether the round lasts five questions or one, so the desk must not have to
       * reverse-engineer it from a candidate's score-to-seconds ratio.
       */
      penaltySeconds: number
      secondsPerPoint: number
    }
  | {
      kind: 'VALIDATE_QUESTION'
      gameQuestionId: string
      /**
       * protocol §5.4 declares a `QuestionRef` here and the first implementation flattened it to the
       * id alone — which left §6.1's screen **asking for a verdict with the evidence on another
       * page**. The sweep can be about a question from an earlier round, so nothing else on the view
       * can supply these: `question` is the current one, and the timeline is the current round.
       */
      prompt: string
      acceptedAnswers: string[]
      masterNotes: string | null
      items: ValidationItem[]
      remainingQuestions: number
    }
  | { kind: 'ADVANCE'; suggestion: AdvanceSuggestion }

export interface MasterControlView {
  code: string
  joinUrl: string
  /** PRD 3 §4 is a whole screen that exists only in `SETUP`, and §10.6 only in `FINISHED`. */
  status: GameStatus
  teams: (TeamPublic & { deviceCount: number })[]
  round: {
    id: string
    title: string
    /** The desk is a different desk per round type; the client must not infer it from `board`. */
    type: RoundType
    number: number
    total: number
  } | null
  /**
   * What `ADVANCE / NEXT_ROUND` opens: the round after the current one, or the **first** round when
   * none is open yet.
   *
   * Top-level rather than inside `round`, because the case that needs it most is the one where
   * `round` is `null` — a game that has just started and has no round open. Without it the desk
   * knows a round exists and cannot name it, and a client that fetched the quiz tree to press one
   * button would be holding a second copy of the running order.
   */
  nextRoundId: string | null
  /**
   * What advancing would do **regardless of what currently has the master's attention.**
   *
   * `attention: ADVANCE` carries the same value, and both are assigned from one expression below so
   * they cannot disagree — but only one `attention` state is ever active, and a desk that can only
   * see the suggestion when nothing else needs it has no way forward from the states that outrank
   * it. That is not hypothetical: it dead-ended the round-end sweep. `VALIDATE_QUESTION` outranks
   * `ADVANCE` unconditionally and correctly sweeps the **whole quiz** (§6.2), while `timeline` is
   * the current round — so a validation deferred in round 1, revisited once round 1 had no unplayed
   * questions left, left the master on a screen with no primary action at all. §6.2 promises the
   * exact opposite: *"blocking the master from moving on would be the one thing worse than
   * provisional scores."*
   */
  advance: AdvanceSuggestion | null
  attention: Attention
  question: MasterQuestionDetail | null
  board?: {
    categories: { id: string; name: string }[]
    tiles: {
      id: string
      categoryId: string
      points: number
      used: boolean
      prompt: string
    }[]
    currentPickerTeamId: string | null
    tiedForPickTeamIds: string[]
  }
  /** PRD 3 §2.1 — the current round's questions, with state markers. */
  timeline: TimelineEntry[]
  /** PRD 3 §11 — the most recent few, newest first. */
  adjustments: MasterAdjustment[]
  /**
   * PRD 3 §11.2 — `attention` is `NONE` during a break, so without this the master would have no
   * way to see they are on one, extend it, or resume.
   */
  break: { startedAt: number; resumesAt: number | null } | null
  /** PRD 3 §11.1's `[Show scores on screen]`, which is a toggle and has to render its state (O4). */
  scoreboardShown: boolean
  /**
   * PRD 3 §12 — *"2 control screens connected"*. A **transport** fact, not a game fact: it is not in
   * the log, cannot be replayed, and is therefore passed in rather than derived. Zero means nobody
   * told this filter, which is why the indicator only ever appears above one.
   */
  controlScreens: number
  /** PRD 3 §10.6's survival ranking, rank groups best first (D51). Null until the finale ends. */
  finaleRanking: string[][] | null
  /**
   * What a team joining now would have missed (PRD 2 §11.2, O5).
   *
   * `[+ Add team]` is required at **every** status from master control as well as the config
   * surface, and the dialog's whole justification is that these numbers are computed rather than
   * worked out in a noisy room. Five numbers, so it costs nothing to carry. `null` in `SETUP`,
   * where nothing has been missed yet and the dialog drops the section entirely.
   */
  missed: MissedSoFar | null
  /** **Counts only** — never the list, so the bounded-view rule holds (§1.1). */
  pendingValidationCount: number
}

export function toMasterControlView(
  state: GameState,
  now: number,
  joinUrl = '',
  /** Live `MASTER_CONTROL` subscribers, counted by the transport (§12). */
  controlScreens = 0,
): MasterControlView {
  const roundIndex = state.content.rounds.findIndex((r) => r.id === state.currentRoundId)
  const round = state.content.rounds[roundIndex]
  const question = findQuestion(state.content, state.currentQuestionId ?? '')
  const play = question ? state.questions.get(question.id) : undefined

  const view: MasterControlView = {
    code: state.code,
    joinUrl,
    status: state.status,
    teams: [...state.teams.values()]
      .sort((a, b) => a.position - b.position)
      .map((team) => ({ ...teamPublic(team), deviceCount: team.deviceCount })),
    round: round
      ? {
          id: round.id,
          title: round.title,
          type: round.type,
          number: roundIndex + 1,
          total: state.content.rounds.length,
        }
      : null,
    // `roundIndex` is -1 with nothing open, so this is the first round — which is exactly the case
    // a freshly started game is in.
    nextRoundId: state.content.rounds[roundIndex + 1]?.id ?? null,
    /*
     * The same suggestion `attention: ADVANCE` carries, from the same function — so the two can
     * never disagree — but available whatever has the master's attention. See the field's own note.
     */
    advance: advanceSuggestion(state, play),
    attention: attention(state, now),
    question: question && play ? masterQuestionDetail(state, question, play, now) : null,
    timeline: timeline(state, round),
    // Newest first, so `[Undo]` is next to the thing most likely to be wrong.
    adjustments: state.adjustments
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, RECENT_ADJUSTMENTS)
      .map((adjustment) => ({
        id: adjustment.id,
        teamId: adjustment.teamId,
        delta: adjustment.delta,
        reason: adjustment.reason,
        announced: adjustment.announced,
        revoked: adjustment.revokedAt !== null,
        createdAt: adjustment.createdAt,
      })),
    break: state.break
      ? { startedAt: state.break.startedAt, resumesAt: state.break.resumesAt }
      : null,
    scoreboardShown: state.scoreboardShown,
    controlScreens,
    finaleRanking: state.finale.ranking,
    missed: state.status === 'SETUP' ? null : missedSoFar(state),
    pendingValidationCount: pendingValidationCount(state),
  }

  if (round?.type === 'JEOPARDY') {
    const picker = suggestedPicker(state, round.id)
    view.board = {
      // Sorted explicitly, matching `boardView()` above — `packages/domain` is documented not to
      // depend on the caller having already ordered rows, and `round.categories`' order is an
      // incidental property of `packages/db`'s queries, not a guarantee this package can rely on.
      categories: round.categories
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((c) => ({ id: c.id, name: c.name })),
      // `prompt` IS sent here — master-only, and the reason `BoardView` is a separate type.
      tiles: round.questions.map((q) => ({
        id: q.id,
        categoryId: q.categoryId ?? '',
        points: q.points,
        used: (state.questions.get(q.id)?.state ?? 'PENDING') !== 'PENDING',
        prompt: q.prompt,
      })),
      currentPickerTeamId: state.picker?.teamId ?? picker.teamId,
      tiedForPickTeamIds: picker.tiedTeamIds,
    }
  }

  return view
}

/**
 * PRD 2 §10's `⚠`, re-derived from the game copy rather than remembered.
 *
 * A game copy is write-once (I16), so this cannot change mid-game — but nothing records the verdict
 * `[Play anyway]` was pressed against, and re-deriving is the only way the marker survives into the
 * desk. It calls `questionFindings`, the same function the authoring row's `✓`/`⚠` uses, so the two
 * can never disagree.
 *
 * **The one check it does not repeat is `ATTACHMENT_MISSING`**: re-hashing a file is filesystem work
 * and this package cannot reach a filesystem. That check belongs to pre-flight at `[Play]` time, and
 * PRD 3 §12 has the live fallback for a song that will not play — the master hears it first.
 */
function failsPreflight(
  round: RoundContent,
  question: QuestionContent,
): PreflightCode | undefined {
  return questionFindings(question, round).find((finding) => finding.severity === 'ERROR')
    ?.code
}

/** PRD 3 §2.1 — the current round's questions in play order, with their state markers. */
function timeline(state: GameState, round: RoundContent | undefined): TimelineEntry[] {
  if (!round) return []

  return (
    round.questions
      .slice()
      // Sorted here for the same reason `boardView` sorts categories: `packages/domain` does not
      // depend on the caller having already ordered rows.
      .sort((a, b) => a.position - b.position)
      .map((question) => {
        const entry: TimelineEntry = {
          gameQuestionId: question.id,
          position: question.position,
          prompt: question.prompt,
          state: state.questions.get(question.id)?.state ?? 'PENDING',
        }
        const code = failsPreflight(round, question)
        // Built up, never stripped: a healthy question's entry simply has no `failsPreflight` key.
        return code ? { ...entry, failsPreflight: code } : entry
      })
  )
}

function validationItems(state: GameState, play: QuestionPlayState): ValidationItem[] {
  const answers = [...play.answers.values()]
  const counts = new Map<string, number>()
  for (const answer of answers) {
    if (answer.text === null) continue
    const key = normaliseAnswer(answer.text)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return answers.map((answer) => {
    const team = state.teams.get(answer.teamId)
    return {
      teamId: answer.teamId,
      teamName: team?.name ?? '',
      teamColour: team?.colour ?? '',
      answerText: answer.text,
      // Decided rows are included as context, not hidden — judging "Radio Head" in isolation, the
      // master cannot see they just accepted "radiohead".
      verdict: answer.verdict,
      isDraft: answer.isDraft,
      enteredByMaster: answer.enteredByMaster,
      hasIdenticalSibling:
        answer.text !== null && (counts.get(normaliseAnswer(answer.text)) ?? 0) > 1,
      spotlit: answer.spotlit,
    }
  })
}

function masterQuestionDetail(
  state: GameState,
  question: QuestionContent,
  play: QuestionPlayState,
  now: number,
): MasterQuestionDetail {
  const detail: MasterQuestionDetail = {
    gameQuestionId: question.id,
    prompt: question.prompt,
    answerMethod: question.answerMethod === 'KEYWORDS' ? 'DO' : question.answerMethod,
    points: question.points,
    state: play.state,
    timer: timerFor(play, now),
    // MASTER_CONTROL and CONFIG only, in every state (invariant 7).
    masterNotes: question.masterNotes,
    acceptedAnswers: question.acceptedAnswers,
    media: question.media.map(mediaRef),
    teamAnswers: validationItems(state, play),
  }

  if (question.answerMethod === 'MULTIPLE_CHOICE') {
    // `isCorrect` IS sent here, and only here.
    detail.options = question.options.map((option) => ({
      id: option.id,
      text: option.text,
      isCorrect: option.isCorrect,
    }))
  }

  if (question.answerMethod === 'BUZZER') {
    detail.buzzes = play.buzzes.map((buzz) => ({
      buzzId: buzz.buzzId,
      teamId: buzz.teamId,
      offsetMs: buzz.offsetMs,
      outcome: buzz.outcome,
    }))
    detail.lockedOutTeamIds = lockedOutTeamIds(play)
  }

  const round = roundOf(state.content, question.id)
  const broken = round && failsPreflight(round, question)
  if (broken) detail.failsPreflight = broken

  return detail
}

function pendingValidationCount(state: GameState): number {
  let count = 0
  for (const play of state.questions.values()) {
    if (play.state === 'SKIPPED') continue
    for (const answer of play.answers.values()) {
      if (answer.verdict === 'PENDING') count += 1
    }
  }
  return count
}

/**
 * What needs the master's attention **right now** — the whole point of the surface (G4).
 *
 * Exactly one is active, chosen by PRD 3 §3.1's priority. Computed here rather than by the client
 * inspecting state and guessing, because the rule is game logic and belongs next to everything
 * else — and it keeps PRD 3 from re-implementing it. Anything lower-priority appears only as a
 * count, never as a second call to action.
 */
export function attention(state: GameState, now: number): Attention {
  const question = findQuestion(state.content, state.currentQuestionId ?? '')
  const play = question ? state.questions.get(question.id) : undefined
  const round = state.content.rounds.find((r) => r.id === state.currentRoundId)

  // 1. ADJUDICATE_BUZZ — the room is silent, waiting. Nothing is more urgent.
  if (play) {
    const buzz = awaitingBuzz(play)
    if (buzz) {
      const team = state.teams.get(buzz.teamId)
      return {
        kind: 'ADJUDICATE_BUZZ',
        buzz: {
          buzzId: buzz.buzzId,
          teamId: buzz.teamId,
          teamName: team?.name ?? '',
          teamColour: team?.colour ?? '',
          offsetMs: buzz.offsetMs,
          otherBuzzes: play.buzzes
            .filter((other) => other.buzzId !== buzz.buzzId)
            .map((other) => ({
              buzzId: other.buzzId,
              teamId: other.teamId,
              offsetMs: other.offsetMs,
              outcome: other.outcome,
            })),
          lockedOutTeamIds: lockedOutTeamIds(play),
          // Stated explicitly to the master rather than left to be inferred (D35).
          timerPaused: true,
        },
        referenceAnswer: question?.acceptedAnswers[0] ?? '',
      }
    }
  }

  /*
   * 2. FINALE_TURN — clocks are running and every second costs a team.
   *
   * Also the state **between** turns: a finale question that has just opened has no turn yet, and
   * nothing else on the desk could start one. §10.5 says clocks stop while nobody is on turn, so
   * this is the same screen with the clock not yet running rather than a state of its own — and
   * `nextTeamId` is then who `[Start <team>]` starts, by the fewest-seconds rule (PRD 1 §8.8).
   */
  // …but never once the round is over: the ranking is what needs the master then (§10.6), and a
  // turn desk with nobody left on it shows an empty team name where a name should be.
  if (
    round?.type === 'DSMTW_FINALE' &&
    question &&
    play &&
    state.finale.ranking === null
  ) {
    const turn = currentFinaleTurn(state)
    if (turn || (play.state === 'OPEN' && state.finale.finalistIds.length > 0)) {
      const passed = new Set(passedThisQuestion(state, question.id))
      const order = finaleTurnOrder(state, question.id, now)
      // Every clock is read at the same instant, so the strip is internally consistent (D52).
      const at = turn?.startedAt ?? now
      // Same computation as `finaleView`'s (§5.5's `FinaleTurnDetail` — "Q3 of 6" — P2 #13).
      const finaleQuestions = round.questions
      return {
        kind: 'FINALE_TURN',
        gameQuestionId: question.id,
        prompt: question.prompt,
        masterNotes: question.masterNotes,
        // Rare on a keyword question, and explicitly permitted (PRD 1 §8.8).
        media: question.media.map(mediaRef),
        questionNumber: finaleQuestions.findIndex((q) => q.id === question.id) + 1,
        questionTotal: finaleQuestions.length,
        currentTeamId: turn?.teamId ?? null,
        // With no turn running this is `order[0]` — the team the rule says goes first.
        nextTeamId: order.find((teamId) => teamId !== turn?.teamId) ?? null,
        turnStartedAt: turn?.startedAt ?? null,
        penaltySeconds: state.finale.penaltySeconds ?? 0,
        keywords: question.keywords.map((keyword) => {
          const mark = state.keywordMarks.get(keyword.id)
          const live = mark && mark.revokedAt === null
          return {
            id: keyword.id,
            position: keyword.position,
            text: keyword.text,
            markedByTeamId: live ? mark.teamId : null,
            revealed: Boolean(live && mark.teamId === null),
          }
        }),
        clocks: state.finale.finalistIds.map((teamId) => {
          const team = state.teams.get(teamId)
          return {
            teamId,
            name: team?.name ?? '',
            colour: team?.colour ?? '',
            // At turn start, not now: the client counts down from `turnStartedAt` (D52).
            secondsAtTurnStart: finaleRemainingSeconds(state, teamId, at),
            onTurn: turn?.teamId === teamId,
            eliminated: (team?.eliminatedAt ?? null) !== null,
            eliminatedAt: team?.eliminatedAt ?? null,
            passedThisQuestion: passed.has(teamId),
          }
        }),
        // Every finalist still in has already passed → offer `[Reveal remaining]`.
        allRemainingPassed: activeFinalists(state).every((teamId) => passed.has(teamId)),
      }
    }
  }

  // 3. SCORE_DO — a challenge just finished; teams are watching for a verdict.
  if (question?.answerMethod === 'DO' && play?.state === 'LOCKED') {
    const config = doConfigOf(question)
    return {
      kind: 'SCORE_DO',
      gameQuestionId: question.id,
      prompt: question.prompt,
      points: question.points,
      scoringMode: config.scoringMode,
      tiePayout: config.tiePayout,
      masterNotes: question.masterNotes,
      teams: [...state.teams.values()]
        .sort((a, b) => a.position - b.position)
        .map((team) => ({
          teamId: team.id,
          name: team.name,
          colour: team.colour,
          // `null` while unsaved, distinct from a saved `0` (D24) — read from the answer row
          // `SET_DO_SCORES`/`SET_DO_WINNERS` writes, never assumed complete.
          score: play.answers.get(team.id)?.pointsAwarded ?? null,
        })),
    }
  }

  // 4. BREAK_TIE_FOR_PICK — the Jeopardy board is stalled until this resolves.
  if (round?.type === 'JEOPARDY' && !state.currentQuestionId) {
    const picker = suggestedPicker(state, round.id)
    if (picker.tiedTeamIds.length > 1) {
      return { kind: 'BREAK_TIE_FOR_PICK', tiedTeamIds: picker.tiedTeamIds }
    }
  }

  // 5. PICK_FINALISTS — the finale cannot start, but no clock is running yet.
  if (round?.type === 'DSMTW_FINALE' && state.finale.finalistIds.length === 0) {
    const rate = state.finale.secondsPerPoint ?? 0
    return {
      kind: 'PICK_FINALISTS',
      penaltySeconds: state.finale.penaltySeconds ?? 0,
      secondsPerPoint: rate,
      // Descending score order, so deselecting the bottom few is a two-second job (D55).
      candidates: [...state.teams.values()]
        .sort((a, b) => b.score - a.score || a.position - b.position)
        .map((team) => ({
          teamId: team.id,
          name: team.name,
          colour: team.colour,
          score: team.score,
          // Makes a 0s row visible while choosing (D56).
          seconds: Math.max(0, Math.floor(team.score * rate)),
        })),
    }
  }

  /*
   * A break outranks the two states where the room is **not** blocked (PRD 3 §11.2: *"while on
   * break, `attention` stays `NONE`, so control shows the leaderboard"*). The five above it stay
   * where they are: those are the states where a room is actually waiting, and hiding a buzz or a
   * running finale clock behind an interval would be worse than the interruption.
   *
   * In practice only `SCORE_DO` can co-occur at all — a break is refused while a question is `OPEN`
   * (§11.2), which rules the other four out by construction.
   */
  if (state.break) return { kind: 'NONE' }

  // 6. VALIDATE_QUESTION — needed before scores are honest, but the room is not blocked.
  const validating = questionNeedingValidation(state, question?.id ?? null, play)
  if (validating) {
    return {
      kind: 'VALIDATE_QUESTION',
      gameQuestionId: validating.question.id,
      prompt: validating.question.prompt,
      acceptedAnswers: validating.question.acceptedAnswers,
      masterNotes: validating.question.masterNotes,
      // Grouped by question, all teams together: judging one answer in isolation is what makes
      // an inconsistent pair invisible (PRD 3 §6.1).
      items: validationItems(state, validating.play),
      remainingQuestions: remainingUnvalidatedQuestions(state, validating.question.id),
    }
  }

  // 7. ADVANCE — nothing is wrong; the master decides the pace.
  const suggestion = advanceSuggestion(state, play)
  if (suggestion) return { kind: 'ADVANCE', suggestion }

  // 8. NONE — show the leaderboard big.
  return { kind: 'NONE' }
}

const hasPendingAnswer = (play: QuestionPlayState): boolean =>
  [...play.answers.values()].some((answer) => answer.verdict === 'PENDING')

/**
 * Which question `VALIDATE_QUESTION` should be about — and the whole of PRD 3 §6.2's **round-end
 * sweep**, which until slice 5 did not exist: `attention` only ever looked at the current question,
 * so once a round closed, every answer deferred during it became unreachable from the desk while
 * `pendingValidationCount` went on counting them. D6 promises that screen explicitly.
 *
 * Two rules, in this order:
 *
 * 1. **The current question wins**, which is D42's inline path (§5.1) — the master judges in the
 *    dead time while one slow team is still typing.
 * 2. **Otherwise sweep the earliest question still owed a verdict**, but only once the master is no
 *    longer mid-question. An `OPEN` or `LOCKED` question means they are working; pulling them back
 *    to round 1 in the middle of it is the one thing worse than deferring.
 */
function questionNeedingValidation(
  state: GameState,
  currentId: string | null,
  current: QuestionPlayState | undefined,
): { question: QuestionContent; play: QuestionPlayState } | undefined {
  if (
    currentId &&
    current &&
    current.state !== 'PENDING' &&
    current.state !== 'SKIPPED' &&
    hasPendingAnswer(current)
  ) {
    const question = findQuestion(state.content, currentId)
    if (question) return { question, play: current }
  }

  if (current && (current.state === 'OPEN' || current.state === 'LOCKED'))
    return undefined

  // Play order, not `Map` insertion order: the sweep walks the quiz the way it was played.
  for (const question of allQuestions(state.content)) {
    const play = state.questions.get(question.id)
    if (!play || play.state === 'PENDING' || play.state === 'SKIPPED') continue
    if (hasPendingAnswer(play)) return { question, play }
  }
  return undefined
}

function remainingUnvalidatedQuestions(state: GameState, exceptId: string): number {
  let count = 0
  for (const [id, play] of state.questions) {
    if (id === exceptId || play.state === 'SKIPPED') continue
    if ([...play.answers.values()].some((answer) => answer.verdict === 'PENDING'))
      count += 1
  }
  return count
}

function advanceSuggestion(
  state: GameState,
  play: QuestionPlayState | undefined,
): AdvanceSuggestion | null {
  if (state.status !== 'LIVE') return null

  /*
   * A finished finale outranks the open question it left behind (§10.6). The round ends on one
   * survivor, on all of them out, or on the questions running out — and at that point the desk
   * shows the ranking and the only thing left to do is end the game, since a finale is always the
   * last round (I20). Suggesting `[Close answers]` over the ranking would be both wrong copy and
   * the wrong step.
   */
  if (state.finale.ranking !== null) return 'FINISH'

  /*
   * `LOCK` was missing from this union until slice 5, and it is the single most common primary
   * action in a game: while a question is `OPEN` the desk suggested `NEXT_QUESTION`, because the
   * fall-through below found unplayed questions in the round. PRD 3 §1.1 says the master must never
   * have to work out what needs them — a suggestion that points past the live question is worse
   * than none.
   */
  if (play?.state === 'OPEN') return 'LOCK'
  if (play?.state === 'LOCKED') return 'REVEAL'
  /*
   * `REVEALED` is the one state whose next act is on *this* question — awarding the points. `SCORED`
   * deliberately falls **through** to the round logic below rather than answering `NEXT_QUESTION`:
   * there may not be a next question, and claiming there is was the second half of the round-boundary
   * dead end. A scored last question of a round means `NEXT_ROUND`, and of the last round `FINISH`.
   */
  if (play?.state === 'REVEALED') return 'NEXT_QUESTION'

  const round = state.content.rounds.find((r) => r.id === state.currentRoundId)
  /*
   * A live game with no round open — which every game is for the first few seconds after
   * `[Start the quiz]`. This returned `null` before slice 5's browser pass, so `attention` was
   * `NONE`, the desk showed a leaderboard, and **there was no way to open the first round at all**.
   */
  if (!round) return state.content.rounds.length > 0 ? 'NEXT_ROUND' : null

  const unplayed = round.questions.filter(
    (question) => (state.questions.get(question.id)?.state ?? 'PENDING') === 'PENDING',
  )
  if (unplayed.length > 0) return 'NEXT_QUESTION'

  const isLastRound = state.content.rounds.at(-1)?.id === round.id
  return isLastRound ? 'FINISH' : 'NEXT_ROUND'
}

/**
 * The `DO` settings a question was authored with (D24), with the schema's own defaults filling
 * in for a config that fails to parse — a `DO` question's `config` is written once at authoring
 * time and validated there, so a parse failure here means the row predates a stricter schema,
 * not a live input to react to. `decide.ts` has an equivalent `tiePayoutOf` for the one field it
 * needs; this reads the whole shape because `SCORE_DO`'s payload needs `scoringMode` too.
 */
function doConfigOf(question: QuestionContent): {
  scoringMode: DoScoringMode
  tiePayout: TiePayout
} {
  const parsed = doConfigSchema.safeParse(question.config)
  return parsed.success
    ? parsed.data
    : { scoringMode: 'WINNER_TAKES_ALL', tiePayout: 'FULL' }
}
