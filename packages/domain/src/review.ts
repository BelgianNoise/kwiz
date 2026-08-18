import { finaleRemainingSeconds, standings, type Standing } from './derive'
import type { QuestionState } from './question-state'
import type { AnswerState, GameState, QuestionContent, RoundContent } from './state'
import type { AnswerMethod, AnswerVerdict, GameStatus, RoundType } from './vocabulary'

/**
 * PRD 2 §13 — **the post-game review**, the reason PRD 1 promises a master can fix a validation
 * mistake.
 *
 * A pure function over `GameState`, like every other view, and for the same reason: the registry
 * loads any game by replaying its log (PRD 1 §6.4), finished ones included, so a review needs no
 * projection query and no mock to test — a literal event list produces the whole grid.
 *
 * **It is a REST read, not a pushed view** (D39, protocol §7.4): it is O(questions × teams), which is
 * precisely what §1.1 says must be fetched. The shape lives here anyway, because *what a correction
 * is* is a domain rule, not a rendering choice.
 *
 * **Audience `CONFIG`, and nothing else may call it.** Unlike the three pushed views, nothing is
 * filtered out: correct answers, every team's answer, master notes. PRD 1 §7's invariants protect the
 * room and the players from each other — the master authored all of this and is looking at their own
 * machine. That is why this shape is deliberately *not* in `views.ts` beside the three that are
 * leak-checked, and why the sentinel test does not enumerate it.
 *
 * **The single caller is `GET /api/games/:id/review`.** A second one briefly existed — the public
 * finished-game standings page (PRD 5 §15 O3) built this whole object and then read four fields off
 * it. Nothing leaked, because the destructuring was narrow; that is exactly the problem. A shape
 * this permissive must not be handed to an unauthenticated route on the understanding that the route
 * will be careful, which is filtering-by-omission and what CLAUDE.md §2.3 rules out. That page calls
 * `standings()` now. **If you need a subset of this somewhere public, build the subset.**
 */

export interface ReviewTeam {
  id: string
  name: string
  colour: string
  position: number
  score: number
  /** Live rank, ties shared (D32) — so the review agrees with the leaderboard the room saw. */
  rank: number
}

export interface ReviewCell {
  teamId: string
  /** What they actually said: typed text, or the chosen option's text. `null` = no answer at all. */
  answer: string | null
  verdict: AnswerVerdict
  points: number
  /** §13.1 — how many times a settled verdict was flipped. `> 0` marks the cell. */
  corrections: number
  /** D26 — committed from a stored draft at lock, never confirmed by the team. */
  fromDraft: boolean
  /** D47 — the master submitted on the team's behalf. */
  byMaster: boolean
}

export interface ReviewQuestion {
  id: string
  position: number
  prompt: string
  answerMethod: AnswerMethod
  points: number
  state: QuestionState
  /** `acceptedAnswers[0]`, the canonical one shown at reveal. `null` for `DO` and the finale. */
  correctAnswer: string | null
  /** §13.1's *"also accepted"* line — the rest of the list, in authored order. */
  alsoAccepted: string[]
  /** One per team, in team order, so every row of the grid lines up without the client sorting. */
  cells: ReviewCell[]
}

export interface ReviewRound {
  id: string
  position: number
  title: string
  type: RoundType
  questions: ReviewQuestion[]
  /** §13.1's per-round count, shown rather than hidden. */
  corrections: number
}

/** §13.2 — one keyword, and the three states it can be in. */
export interface ReviewKeyword {
  id: string
  position: number
  /**
   * **Always present here**, unlike every other surface.
   *
   * D53 keeps an unmarked keyword's text off the wire because the room and the players must not read
   * it early — but this is `CONFIG`, after the fact, and the master wrote the keyword. §13.2's own
   * mockup lists all five with their text. Withholding it would make the record of the round
   * unreadable to the one person entitled to read it.
   */
  text: string
  /** The team that got it. `null` with `reached` means *nobody* found it. */
  teamId: string | null
  /**
   * Whether the round ever got to this keyword. **`— nobody` and "never reached" are different
   * facts** (§13.2) and a review that conflated them would misreport how far the round actually got.
   */
  reached: boolean
}

export interface ReviewFinaleQuestion {
  id: string
  position: number
  prompt: string
  keywords: ReviewKeyword[]
}

export interface ReviewFinalist {
  teamId: string
  /** Fixed at `FINALISTS_SET` from the team's score at that instant. */
  startedSeconds: number
  /** What was left when the round ended — `145 → 41` is how *"how close was it?"* gets answered. */
  endedSeconds: number
  /** Absolute instant, rendered `HH:mm` (conventions §8.2). `null` for a survivor. */
  eliminatedAt: number | null
  survived: boolean
}

export interface ReviewFinale {
  questions: ReviewFinaleQuestion[]
  finalists: ReviewFinalist[]
  /** Teams that did not play it at all — listed, because their placing is still part of the record. */
  nonFinalistIds: string[]
  /** The single survivor, when there is one. `null` while the round is unfinished or all-out. */
  wonByTeamId: string | null
}

export interface ReviewAdjustment {
  id: string
  teamId: string
  delta: number
  reason: string | null
  /** D25 — `false` suppressed the main-screen banner; the row exists either way. */
  announced: boolean
  createdAt: number
  /** D41 — revoked rows stay and are struck through; the total excludes them. */
  revokedAt: number | null
}

export interface GameReview {
  gameId: string
  quizName: string
  code: string
  status: GameStatus
  startedAt: number | null
  finishedAt: number | null
  teams: ReviewTeam[]
  rounds: ReviewRound[]
  /** `null` when the quiz has no finale round, which is the common case (PRD 2 §6.1). */
  finale: ReviewFinale | null
  adjustments: ReviewAdjustment[]
  /** Whole-game correction count — the number the master is really asking about. */
  corrections: number
}

export function toGameReview(state: GameState, now: number): GameReview {
  const ranks = new Map(standings(state).map((row: Standing) => [row.teamId, row.rank]))

  const teams: ReviewTeam[] = [...state.teams.values()]
    .sort((a, b) => a.position - b.position)
    .map((team) => ({
      id: team.id,
      name: team.name,
      colour: team.colour,
      position: team.position,
      score: team.score,
      rank: ranks.get(team.id) ?? 1,
    }))

  const rounds = state.content.rounds
    // A finale round has no answers, so §13.1's grid has nothing to show for it — it gets §13.2.
    .filter((round) => round.type !== 'DSMTW_FINALE')
    .map((round) => reviewRound(state, round, teams))

  return {
    gameId: state.content.gameId,
    quizName: state.content.quizName,
    code: state.code,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    teams,
    rounds,
    finale: reviewFinale(state, now),
    adjustments: state.adjustments.map((adjustment) => ({
      id: adjustment.id,
      teamId: adjustment.teamId,
      delta: adjustment.delta,
      reason: adjustment.reason,
      announced: adjustment.announced,
      createdAt: adjustment.createdAt,
      revokedAt: adjustment.revokedAt,
    })),
    corrections: rounds.reduce((total, round) => total + round.corrections, 0),
  }
}

function reviewRound(
  state: GameState,
  round: RoundContent,
  teams: ReviewTeam[],
): ReviewRound {
  const questions = round.questions
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((question) => reviewQuestion(state, question, teams))

  return {
    id: round.id,
    position: round.position,
    title: round.title,
    type: round.type,
    questions,
    corrections: questions.reduce(
      (total, question) =>
        total + question.cells.reduce((sum, cell) => sum + cell.corrections, 0),
      0,
    ),
  }
}

function reviewQuestion(
  state: GameState,
  question: QuestionContent,
  teams: ReviewTeam[],
): ReviewQuestion {
  const play = state.questions.get(question.id)

  return {
    id: question.id,
    position: question.position,
    prompt: question.prompt,
    answerMethod: question.answerMethod,
    points: question.points,
    state: play?.state ?? 'PENDING',
    /*
     * `DO` and the finale have no written answer, and an empty string in a *"correct answer"* line
     * reads as a missing one — the same distinction the player's reveal makes (PRD 5 §11).
     */
    correctAnswer: question.acceptedAnswers[0] ?? null,
    alsoAccepted: question.acceptedAnswers.slice(1),
    // Every team gets a cell, answered or not: the grid's whole value is that it lines up, and a
    // team that answered nothing is a fact worth seeing next to one that did.
    cells: teams.map((team) => reviewCell(question, play?.answers.get(team.id), team.id)),
  }
}

function reviewCell(
  question: QuestionContent,
  answer: AnswerState | undefined,
  teamId: string,
): ReviewCell {
  if (!answer) {
    return {
      teamId,
      answer: null,
      verdict: 'PENDING',
      points: 0,
      corrections: 0,
      fromDraft: false,
      byMaster: false,
    }
  }

  // The option's *text*, not its id: the master is reading the grid, and `019f…` answers nothing.
  const chosen = question.options.find((option) => option.id === answer.selectedOptionId)

  return {
    teamId,
    answer: chosen?.text ?? answer.text,
    verdict: answer.verdict,
    points: answer.pointsAwarded,
    corrections: answer.corrections,
    fromDraft: answer.isDraft,
    byMaster: answer.enteredByMaster,
  }
}

/**
 * §13.2 — the finale's record, and **read-only by design**. Nothing here is editable: a clock that
 * ran is a fact, and re-litigating an elimination afterwards would rewrite a result the room already
 * saw. A genuine mis-mark has to be fixed *during* the round (PRD 3 §10.4), because only then can
 * the seconds it charged be returned.
 */
function reviewFinale(state: GameState, now: number): ReviewFinale | null {
  const round = state.content.rounds.find(
    (candidate) => candidate.type === 'DSMTW_FINALE',
  )
  if (!round) return null

  const questions = round.questions
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((question) => ({
      id: question.id,
      position: question.position,
      prompt: question.prompt,
      keywords: question.keywords
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((keyword) =>
          reviewKeyword(state, keyword.id, keyword.text, keyword.position),
        ),
    }))

  /*
   * Clocks are read at the instant the round ended, not at `now` — otherwise a finished game's
   * review would tick a survivor's remaining seconds down every time the page was opened. Same
   * reasoning as PRD 4 §10.2's `FINISHED` rows.
   */
  const readAt = state.finale.endedAt ?? now

  const finalists: ReviewFinalist[] = state.finale.finalistIds.map((teamId) => {
    const eliminatedAt = state.teams.get(teamId)?.eliminatedAt ?? null
    return {
      teamId,
      startedSeconds: state.finale.startingSeconds.get(teamId) ?? 0,
      endedSeconds: finaleRemainingSeconds(state, teamId, eliminatedAt ?? readAt),
      eliminatedAt,
      survived: eliminatedAt === null,
    }
  })

  const survivors = finalists.filter((finalist) => finalist.survived)

  return {
    questions,
    finalists,
    nonFinalistIds: [...state.teams.values()]
      .sort((a, b) => a.position - b.position)
      .filter((team) => !state.finale.finalistIds.includes(team.id))
      .map((team) => team.id),
    // Only once the round is over, and only when exactly one is left: "won by" is a claim, and an
    // unfinished round or a mutual wipeout has nobody to make it about.
    wonByTeamId:
      state.finale.endedAt !== null && survivors.length === 1
        ? (survivors[0]?.teamId ?? null)
        : null,
  }
}

function reviewKeyword(
  state: GameState,
  gameKeywordId: string,
  text: string,
  position: number,
): ReviewKeyword {
  const mark = state.keywordMarks.get(gameKeywordId)
  const live = mark && mark.revokedAt === null ? mark : undefined

  /*
   * **Three states, and the difference between the last two is the point of the view.**
   *
   * A live mark with a team is that team's. A live mark with `teamId: null` is `KEYWORDS_REVEALED`
   * (I21), which covers the whole question at once: the round reached it and nobody found it —
   * `— nobody`. No mark at all means the round never got there, and reporting that as *nobody found
   * it* would overstate how far it ran.
   *
   * A **revoked** mark falls into the last case, which is right: `KEYWORD_UNMARKED` puts the keyword
   * back to unfound, and D41 means it has to reverse the record as completely as it reverses time.
   */
  return {
    id: gameKeywordId,
    position,
    text,
    teamId: live?.teamId ?? null,
    reached: live !== undefined,
  }
}
