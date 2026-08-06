import { normaliseAnswer } from './answers'
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
import { revealsCorrectAnswer } from './question-state'
import {
  findQuestion,
  roundOf,
  type GameState,
  type MediaContent,
  type QuestionContent,
  type QuestionPlayState,
} from './state'
import type { AnswerVerdict, BuzzOutcome, Locale } from './vocabulary'

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

  if (question) {
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
    // `{ id, text }` — no correctness marker before REVEALED (invariant 2). Ids are UUIDs so
    // nothing in the payload even ranks the options (protocol §6.3).
    view.options = question.options.map((option) => ({
      id: option.id,
      text: option.text,
    }))
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

export function toPlayerView(state: GameState, teamId: string, now: number): PlayerView {
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
    stage: playerStage(state, teamId, now),
  }
}

function playerStage(state: GameState, teamId: string, now: number): PlayerView['stage'] {
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
        myAnswer: myAnswer(play, teamId),
      }
    }
  }
  // Unreachable: `stageKind` is exhaustive.
  return { kind: 'BETWEEN_QUESTIONS' }
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
    view.options = question.options.map((option) => ({
      id: option.id,
      text: option.text,
    }))
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
function myAnswer(play: QuestionPlayState, teamId: string): MyAnswer | null {
  const mine = play.answers.get(teamId)
  if (!mine) return null
  return {
    text: mine.text,
    optionId: mine.selectedOptionId,
    submitted: !mine.isDraft,
    submittedAt: mine.submittedAt,
  }
}

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
}

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
      currentTeamId: string
      nextTeamId: string | null
      turnStartedAt: number
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
        passedThisQuestion: boolean
      }[]
      /** Nobody left to pass to → offer `[Reveal remaining]`. */
      allRemainingPassed: boolean
    }
  | { kind: 'SCORE_DO'; gameQuestionId: string }
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
    }
  | {
      kind: 'VALIDATE_QUESTION'
      gameQuestionId: string
      items: ValidationItem[]
      remainingQuestions: number
    }
  | { kind: 'ADVANCE'; suggestion: 'REVEAL' | 'NEXT_QUESTION' | 'NEXT_ROUND' | 'FINISH' }

export interface MasterControlView {
  code: string
  joinUrl: string
  teams: (TeamPublic & { deviceCount: number })[]
  round: { id: string; title: string; number: number; total: number } | null
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
  /** **Counts only** — never the list, so the bounded-view rule holds (§1.1). */
  pendingValidationCount: number
}

export function toMasterControlView(
  state: GameState,
  now: number,
  joinUrl = '',
): MasterControlView {
  const roundIndex = state.content.rounds.findIndex((r) => r.id === state.currentRoundId)
  const round = state.content.rounds[roundIndex]
  const question = findQuestion(state.content, state.currentQuestionId ?? '')
  const play = question ? state.questions.get(question.id) : undefined

  const view: MasterControlView = {
    code: state.code,
    joinUrl,
    teams: [...state.teams.values()]
      .sort((a, b) => a.position - b.position)
      .map((team) => ({ ...teamPublic(team), deviceCount: team.deviceCount })),
    round: round
      ? {
          id: round.id,
          title: round.title,
          number: roundIndex + 1,
          total: state.content.rounds.length,
        }
      : null,
    attention: attention(state, now),
    question: question && play ? masterQuestionDetail(state, question, play, now) : null,
    pendingValidationCount: pendingValidationCount(state),
  }

  if (round?.type === 'JEOPARDY') {
    const picker = suggestedPicker(state, round.id)
    view.board = {
      categories: round.categories.map((c) => ({ id: c.id, name: c.name })),
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

  // 2. FINALE_TURN — clocks are running and every second costs a team.
  if (round?.type === 'DSMTW_FINALE' && question) {
    const turn = currentFinaleTurn(state)
    if (turn) {
      const passed = new Set(passedThisQuestion(state, question.id))
      const order = finaleTurnOrder(state, question.id, now)
      return {
        kind: 'FINALE_TURN',
        gameQuestionId: question.id,
        currentTeamId: turn.teamId,
        nextTeamId: order.find((teamId) => teamId !== turn.teamId) ?? null,
        turnStartedAt: turn.startedAt,
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
            secondsAtTurnStart: finaleRemainingSeconds(state, teamId, turn.startedAt),
            onTurn: turn.teamId === teamId,
            eliminated: (team?.eliminatedAt ?? null) !== null,
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
    return { kind: 'SCORE_DO', gameQuestionId: question.id }
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

  // 6. VALIDATE_QUESTION — needed before scores are honest, but the room is not blocked.
  if (question && play && play.state !== 'PENDING' && play.state !== 'SKIPPED') {
    const items = validationItems(state, play)
    if (items.some((item) => item.verdict === 'PENDING')) {
      return {
        kind: 'VALIDATE_QUESTION',
        gameQuestionId: question.id,
        // Grouped by question, all teams together: judging one answer in isolation is what makes
        // an inconsistent pair invisible (PRD 3 §6.1).
        items,
        remainingQuestions: remainingUnvalidatedQuestions(state, question.id),
      }
    }
  }

  // 7. ADVANCE — nothing is wrong; the master decides the pace.
  const suggestion = advanceSuggestion(state, play)
  if (suggestion) return { kind: 'ADVANCE', suggestion }

  // 8. NONE — show the leaderboard big.
  return { kind: 'NONE' }
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
): 'REVEAL' | 'NEXT_QUESTION' | 'NEXT_ROUND' | 'FINISH' | null {
  if (state.status !== 'LIVE') return null
  if (play?.state === 'LOCKED') return 'REVEAL'
  if (play && (play.state === 'REVEALED' || play.state === 'SCORED'))
    return 'NEXT_QUESTION'

  const round = state.content.rounds.find((r) => r.id === state.currentRoundId)
  if (!round) return null

  const unplayed = round.questions.filter(
    (question) => (state.questions.get(question.id)?.state ?? 'PENDING') === 'PENDING',
  )
  if (unplayed.length > 0) return 'NEXT_QUESTION'

  const isLastRound = state.content.rounds.at(-1)?.id === round.id
  return isLastRound ? 'FINISH' : 'NEXT_ROUND'
}
