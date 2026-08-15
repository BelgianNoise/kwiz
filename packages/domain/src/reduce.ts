import { gradeFreeText, gradeMultipleChoice, verdictAwardsPoints } from './answers'
import { rankSnapshot } from './derive'
import type { GameEvent } from './events/payload'
import { nextQuestionState } from './question-state'
import {
  allQuestions,
  findQuestion,
  type AnswerState,
  type GameContent,
  type GameState,
  type QuestionPlayState,
} from './state'

/**
 * `reduce(content, events) → GameState` — the whole game as a fold over its log (D4).
 *
 * Pure: no clock, no database, no I/O. Every timestamp comes from the event that carried it, which
 * is what makes a replay produce byte-identical state and lets every test here be a literal array.
 *
 * **Derived facts are not stored.** The buzzer lockout set, the timer pause, the Jeopardy turn
 * order and every finale clock are computed from this state on demand (see `derive.ts`), because
 * storing a derivable fact creates a second source of truth for it (§1.1).
 */

export interface LoggedEvent {
  seq: number
  event: GameEvent
  /** `game_event.createdAt`, epoch ms. The only clock the reducer ever sees. */
  createdAt: number
}

const emptyQuestion = (): QuestionPlayState => ({
  state: 'PENDING',
  openedAt: null,
  deadlineAt: null,
  answers: new Map(),
  buzzes: [],
  forceReopenedAt: null,
})

export function initialGameState(content: GameContent): GameState {
  return {
    content,
    status: 'SETUP',
    startedAt: null,
    finishedAt: null,
    code: content.code,
    quizRevision: 0,
    teams: new Map(),
    devices: new Map(),
    currentRoundId: null,
    currentQuestionId: null,
    closedRoundIds: new Set(),
    questions: new Map(allQuestions(content).map((q) => [q.id, emptyQuestion()])),
    adjustments: [],
    keywordMarks: new Map(),
    finale: {
      secondsPerPoint: null,
      penaltySeconds: null,
      finalistIds: [],
      startingSeconds: new Map(),
      turns: [],
      ranking: null,
      endedAt: null,
    },
    break: null,
    scoreboardShown: false,
    leaderboardRanks: null,
    previousLeaderboardRanks: null,
    finishedTab: 'RESULT',
    picker: null,
    seq: 0,
  }
}

/**
 * The room is being shown a leaderboard, so the ranks it displays become the baseline the *next*
 * one's `▲`/`▼` arrows are measured against (PRD 4 §10).
 *
 * Called from the three events that put one in front of the room: closing a round, the master
 * pushing it mid-round, and the game ending. Capturing on display rather than on every score change
 * is what makes the arrows say "since you last looked" instead of "since the last point was scored".
 */
function captureLeaderboard(state: GameState): void {
  state.previousLeaderboardRanks = state.leaderboardRanks
  state.leaderboardRanks = rankSnapshot(state)
}

export function reduce(content: GameContent, log: readonly LoggedEvent[]): GameState {
  const state = initialGameState(content)
  for (const entry of log) applyEvent(state, entry)
  return state
}

/**
 * Folds one event in. **Mutates** — `state` is always a value this module created, never one a
 * caller shares, so `reduce` as a whole stays pure. Exported so a server holding a live projection
 * can apply an appended event without replaying the log.
 */
export function applyEvent(
  state: GameState,
  { event, createdAt, seq }: LoggedEvent,
): void {
  state.seq = seq

  switch (event.type) {
    // ─── lifecycle ───
    case 'GAME_CREATED':
      state.code = event.payload.code
      state.quizRevision = event.payload.quizRevision
      return
    case 'GAME_RESYNCED':
      state.quizRevision = event.payload.quizRevision
      return
    case 'CODE_REGENERATED':
      state.code = event.payload.code
      return
    case 'GAME_STARTED':
      state.status = 'LIVE'
      state.startedAt = createdAt
      return
    case 'GAME_FINISHED':
      state.status = 'FINISHED'
      state.finishedAt = createdAt
      // §10.2's final standings are a leaderboard too, and the one people photograph.
      captureLeaderboard(state)
      return
    case 'GAME_ABANDONED':
      state.status = 'ABANDONED'
      state.finishedAt = createdAt
      return

    // ─── teams & devices ───
    case 'TEAM_ADDED':
      state.teams.set(event.payload.teamId, {
        id: event.payload.teamId,
        name: event.payload.name,
        colour: event.payload.colour,
        position: event.payload.position,
        score: 0,
        deviceCount: 0,
        eliminatedAt: null,
      })
      return
    case 'TEAM_UPDATED': {
      const team = state.teams.get(event.payload.teamId)
      if (!team) return
      if (event.payload.name !== undefined) team.name = event.payload.name
      if (event.payload.colour !== undefined) team.colour = event.payload.colour
      return
    }
    case 'DEVICE_JOINED':
      state.devices.set(event.payload.deviceId, event.payload.teamId)
      recountDevices(state)
      return
    case 'DEVICE_SWITCHED_TEAM':
      state.devices.set(event.payload.deviceId, event.payload.toTeamId)
      recountDevices(state)
      return

    // ─── round & question flow ───
    case 'ROUND_OPENED':
      state.currentRoundId = event.payload.gameRoundId
      state.currentQuestionId = null
      state.scoreboardShown = false
      // Reopening a closed round is legal, and it is no longer closed.
      state.closedRoundIds.delete(event.payload.gameRoundId)
      return
    case 'ROUND_CLOSED':
      state.closedRoundIds.add(event.payload.gameRoundId)
      if (state.currentRoundId === event.payload.gameRoundId)
        state.currentQuestionId = null
      // A closed round puts the room on `AFTER ROUND n` (PRD 4 §10), which is a leaderboard.
      captureLeaderboard(state)
      return

    case 'QUESTION_OPENED': {
      const play = state.questions.get(event.payload.gameQuestionId)
      if (!play) return
      const to = nextQuestionState(play.state, event.type)
      if (!to) return
      play.state = to
      play.openedAt = createdAt
      play.deadlineAt = event.payload.deadlineAt ?? null
      state.currentQuestionId = event.payload.gameQuestionId
      // O4: the leaderboard is dismissed by the next question, not by a second master action.
      state.scoreboardShown = false
      return
    }

    case 'QUESTION_LOCKED':
    case 'QUESTION_REVEALED':
    case 'QUESTION_SCORED': {
      const play = state.questions.get(event.payload.gameQuestionId)
      const to = play && nextQuestionState(play.state, event.type)
      if (play && to) play.state = to
      return
    }

    case 'QUESTION_SKIPPED': {
      const play = state.questions.get(event.payload.gameQuestionId)
      const to = play && nextQuestionState(play.state, event.type)
      if (!play || !to) return
      play.state = to
      // I8 / D46: "awards nothing to anyone" is enforced, not assumed — a question skipped from
      // OPEN may already hold auto-graded answers carrying points. Verdicts are kept for the
      // record, because the team did answer and the record should say so.
      for (const answer of play.answers.values()) answer.pointsAwarded = 0
      recomputeScores(state)
      return
    }

    // ─── answers ───
    case 'ANSWER_SUBMITTED': {
      const play = state.questions.get(event.payload.gameQuestionId)
      const question = findQuestion(state.content, event.payload.gameQuestionId)
      if (!play || !question) return

      const answer: AnswerState = {
        teamId: event.payload.teamId,
        text: event.payload.text ?? null,
        selectedOptionId: event.payload.selectedOptionId ?? null,
        isDraft: event.payload.fromDraft,
        submittedAt: createdAt,
        enteredByMaster: event.payload.enteredByMaster,
        verdict: autoVerdict(
          question,
          event.payload.text,
          event.payload.selectedOptionId,
        ),
        pointsAwarded: 0,
        validatedAt: null,
        spotlit: false,
      }
      // Auto-grading may only ever be *right* (D22): a FREE_TEXT non-match lands on PENDING.
      if (verdictAwardsPoints(answer.verdict)) answer.pointsAwarded = question.points

      play.answers.set(answer.teamId, answer)
      recomputeScores(state)
      return
    }

    case 'ANSWER_VALIDATED': {
      const play = state.questions.get(event.payload.gameQuestionId)
      const question = findQuestion(state.content, event.payload.gameQuestionId)
      const answer = play?.answers.get(event.payload.teamId)
      if (!play || !question || !answer) return

      // A repeated ANSWER_VALIDATED supersedes the earlier one — there is deliberately no
      // ANSWER_REVALIDATED, and the log still shows both decisions in order.
      answer.verdict = event.payload.accepted ? 'ACCEPTED' : 'DENIED'
      answer.pointsAwarded = event.payload.accepted ? question.points : 0
      answer.validatedAt = createdAt
      // A skipped question awards nothing however it is judged afterwards (I8).
      if (play.state === 'SKIPPED') answer.pointsAwarded = 0
      recomputeScores(state)
      return
    }

    case 'ANSWER_SPOTLIT': {
      const answer = state.questions
        .get(event.payload.gameQuestionId)
        ?.answers.get(event.payload.teamId)
      if (answer) answer.spotlit = event.payload.spotlit
      return
    }

    // ─── buzzer (D35) ───
    case 'BUZZ_RECEIVED': {
      const play = state.questions.get(event.payload.gameQuestionId)
      if (!play) return
      // A buzz arriving while one is already being adjudicated is recorded but never judged.
      const adjudicating = play.buzzes.some((b) => b.outcome === 'AWAITING')
      play.buzzes.push({
        buzzId: event.payload.buzzId,
        teamId: event.payload.teamId,
        receivedAt: event.payload.receivedAt,
        offsetMs: event.payload.offsetMs,
        outcome: adjudicating ? 'NOT_FIRST' : 'AWAITING',
        adjudicatedAt: null,
      })
      return
    }

    case 'BUZZ_ADJUDICATED': {
      for (const [questionId, play] of state.questions) {
        const buzz = play.buzzes.find((b) => b.buzzId === event.payload.buzzId)
        if (!buzz) continue
        buzz.outcome = event.payload.accepted ? 'ACCEPTED' : 'DENIED'
        buzz.adjudicatedAt = createdAt

        /*
         * **The adjudication is also the scoring.** PRD 1 §8.4: for a buzzer question the master
         * "accepts or denies the spoken answer", and D35 says an accepted team is *credited* — so
         * a buzzer question and every Jeopardy tile (D34) is scored by this event and no other.
         * There is no `ANSWER_SUBMITTED` to validate: nothing was typed.
         *
         * The denied team gets a `DENIED` outcome rather than no row, because they did answer and
         * the review grid should say so.
         */
        const question = findQuestion(state.content, questionId)
        const points =
          event.payload.accepted && question && play.state !== 'SKIPPED'
            ? question.points
            : 0
        setOutcome(
          play,
          buzz.teamId,
          event.payload.accepted ? 'ACCEPTED' : 'DENIED',
          points,
          createdAt,
        )
        // A denial also locks the team out and reopens the buzzers to everyone else — both derived,
        // so there is nothing further to record for that half of it.
        recomputeScores(state)
        return
      }
      return
    }

    case 'BUZZERS_FORCE_REOPENED': {
      const play = state.questions.get(event.payload.gameQuestionId)
      if (play) play.forceReopenedAt = createdAt
      return
    }

    // ─── DO scoring ───
    case 'DO_WINNERS_SET': {
      const play = state.questions.get(event.payload.gameQuestionId)
      const question = findQuestion(state.content, event.payload.gameQuestionId)
      if (!play || !question) return

      // `teamIds: []` is the explicit "nobody got it" (D23) and still resolves every team.
      const winners = new Set(event.payload.teamIds)
      const share =
        winners.size > 1 && event.payload.tiePayout === 'SPLIT'
          ? Math.floor(question.points / winners.size) // integers only (D24)
          : question.points

      for (const teamId of state.teams.keys()) {
        const won = winners.has(teamId)
        setOutcome(play, teamId, won ? 'ACCEPTED' : 'DENIED', won ? share : 0, createdAt)
      }
      recomputeScores(state)
      return
    }

    /*
     * P2 #14 — **left as-is, deliberately, after checking against `attention.test.ts`'s
     * "reflects a partial `PER_TEAM_SCORE` save" test.** `DO_WINNERS_SET`'s unconditional
     * every-team resolve (above) does not generalise here: PRD 3 §8.2's desk saves
     * progressively, one or a few teams at a time ("1 of 4 scored" is real, server-tracked
     * state), and a team not yet in `event.payload.scores` is genuinely *not yet judged* —
     * zero-filling it here would collapse that into "scored 0," which is a different fact.
     *
     * D24's "blank scores 0" is real, but it applies once the master is *done*, not to every
     * incremental save — and nothing today marks a `PER_TEAM_SCORE` question "done" the way
     * `DO_WINNERS_SET` resolves everyone in one commit. The review's "depends on the UI always
     * sending every team" is accurate; the fix belongs wherever "done" is decided (`SCORE_QUESTION`
     * or `REVEAL_QUESTION` against a still-incomplete `PER_TEAM_SCORE` question is the candidate
     * moment), which is a design decision for whoever builds that desk, not a change to make here
     * without knowing what that moment is.
     */
    case 'DO_SCORES_SET': {
      const play = state.questions.get(event.payload.gameQuestionId)
      const question = findQuestion(state.content, event.payload.gameQuestionId)
      if (!play || !question) return

      for (const { teamId, score } of event.payload.scores) {
        // Clamped to 0…points (D24) here as well as at the boundary, so a payload written by an
        // older build cannot inflate a score on replay.
        const clamped = Math.min(Math.max(score, 0), question.points)
        setOutcome(play, teamId, 'ACCEPTED', clamped, createdAt)
      }
      recomputeScores(state)
      return
    }

    // ─── scores ───
    case 'SCORE_ADJUSTED':
      state.adjustments.push({
        id: event.payload.adjustmentId,
        teamId: event.payload.teamId,
        delta: event.payload.delta,
        reason: event.payload.reason ?? null,
        announced: event.payload.announced,
        revokedAt: null,
        createdAt,
      })
      recomputeScores(state)
      return

    case 'SCORE_ADJUSTMENT_REVOKED': {
      const adjustment = state.adjustments.find(
        (a) => a.id === event.payload.adjustmentId,
      )
      // Revoking an already-revoked adjustment is a no-op, and the row is never deleted (D41).
      if (adjustment && adjustment.revokedAt === null) adjustment.revokedAt = createdAt
      recomputeScores(state)
      return
    }

    // ─── break, scoreboard, picker ───
    case 'BREAK_STARTED':
      // Re-sending during a break is how a break is extended: it supersedes `resumesAt`.
      state.break = {
        startedAt: createdAt,
        resumesAt:
          event.payload.durationMs === undefined
            ? null
            : createdAt + event.payload.durationMs,
      }
      return
    case 'BREAK_ENDED':
      // Never automatic: the countdown reaching zero changes nothing server-side (D8).
      state.break = null
      return
    case 'SCOREBOARD_TOGGLED':
      state.scoreboardShown = event.payload.shown
      // Only on the way *up*: hiding it again is not a new showing to measure the next one against.
      if (event.payload.shown) captureLeaderboard(state)
      return
    case 'FINISHED_TAB_SET':
      state.finishedTab = event.payload.tab
      return
    case 'PICKER_ASSIGNED':
      state.picker = { teamId: event.payload.teamId, reason: event.payload.reason }
      return

    // ─── DSMTW_FINALE (D50) ───
    case 'FINALE_CONFIGURED':
      state.finale.secondsPerPoint = event.payload.secondsPerPoint
      state.finale.penaltySeconds = event.payload.penaltySeconds
      return

    case 'FINALISTS_SET': {
      state.finale.finalistIds = [...event.payload.teamIds]
      // Each finalist's bank is fixed **now**, from their score at this instant (D55) — which is
      // why it is not carried in the payload: it is derivable from the log up to this point.
      const rate = state.finale.secondsPerPoint ?? 0
      state.finale.startingSeconds = new Map(
        event.payload.teamIds.map((teamId) => [
          teamId,
          Math.max(0, Math.floor((state.teams.get(teamId)?.score ?? 0) * rate)),
        ]),
      )
      return
    }

    case 'TURN_STARTED':
      state.finale.turns.push({
        teamId: event.payload.teamId,
        startedAt: createdAt,
        endedAt: null,
        reason: null,
      })
      return

    case 'TURN_ENDED': {
      const turn = [...state.finale.turns].reverse().find((t) => t.endedAt === null)
      if (turn) {
        turn.endedAt = createdAt
        turn.reason = event.payload.reason
      }
      return
    }

    case 'KEYWORD_MARKED': {
      const question = questionOfKeyword(state, event.payload.gameKeywordId)
      if (!question) return
      state.keywordMarks.set(event.payload.gameKeywordId, {
        gameKeywordId: event.payload.gameKeywordId,
        gameQuestionId: question,
        teamId: event.payload.teamId,
        markedAt: createdAt,
        revokedAt: null,
      })
      return
    }

    case 'KEYWORD_UNMARKED': {
      const mark = state.keywordMarks.get(event.payload.gameKeywordId)
      // Revoked, never deleted (D41) — and here the revocation must also reverse the penalty it
      // charged every other team, which the derived clocks do by ignoring revoked marks.
      if (mark && mark.revokedAt === null) mark.revokedAt = createdAt
      return
    }

    case 'KEYWORDS_REVEALED': {
      const question = findQuestion(state.content, event.payload.gameQuestionId)
      if (!question) return
      for (const keyword of question.keywords) {
        const existing = state.keywordMarks.get(keyword.id)
        if (existing && existing.revokedAt === null) continue
        // `teamId: null` distinguishes "nobody got it" from "we never reached it" (I21).
        state.keywordMarks.set(keyword.id, {
          gameKeywordId: keyword.id,
          gameQuestionId: question.id,
          teamId: null,
          markedAt: createdAt,
          revokedAt: null,
        })
      }
      return
    }

    case 'TEAM_ELIMINATED': {
      const team = state.teams.get(event.payload.teamId)
      // `at` is the *computed* instant the clock hit zero, which can be while the team was not on
      // turn — a penalty from someone else's correct guess does it (protocol §4.6).
      if (team && team.eliminatedAt === null) team.eliminatedAt = event.payload.at
      return
    }

    case 'FINALE_ENDED':
      state.finale.ranking = event.payload.ranking.map((group) => [...group])
      state.finale.endedAt = createdAt
      return
  }
}

// ─── helpers ───

function autoVerdict(
  question: {
    answerMethod: string
    acceptedAnswers: string[]
    options: { id: string; isCorrect: boolean }[]
  },
  text: string | undefined,
  selectedOptionId: string | undefined,
): AnswerState['verdict'] {
  if (question.answerMethod === 'FREE_TEXT') {
    return gradeFreeText(text, question.acceptedAnswers)
  }
  if (question.answerMethod === 'MULTIPLE_CHOICE') {
    const correct = question.options.find((o) => o.isCorrect)
    // A question with no correct option is a pre-flight failure (I4), not something to guess at.
    return correct ? gradeMultipleChoice(selectedOptionId, correct.id) : 'PENDING'
  }
  // BUZZER and DO are never auto-graded: nothing was typed.
  return 'PENDING'
}

/** `DO` questions reuse the answer map: a team's *outcome* is still per-question-per-team (§6.5). */
function setOutcome(
  play: QuestionPlayState,
  teamId: string,
  verdict: AnswerState['verdict'],
  pointsAwarded: number,
  at: number,
): void {
  const existing = play.answers.get(teamId)
  if (existing) {
    existing.verdict = verdict
    existing.pointsAwarded = pointsAwarded
    existing.validatedAt = at
    return
  }
  play.answers.set(teamId, {
    teamId,
    text: null,
    selectedOptionId: null,
    isDraft: false,
    submittedAt: at,
    enteredByMaster: false,
    verdict,
    pointsAwarded,
    validatedAt: at,
    spotlit: false,
  })
}

function questionOfKeyword(state: GameState, gameKeywordId: string): string | undefined {
  for (const question of allQuestions(state.content)) {
    if (question.keywords.some((k) => k.id === gameKeywordId)) return question.id
  }
  return undefined
}

function recountDevices(state: GameState): void {
  for (const team of state.teams.values()) team.deviceCount = 0
  for (const teamId of state.devices.values()) {
    const team = state.teams.get(teamId)
    if (team) team.deviceCount += 1
  }
}

/**
 * I9: `score = sum(pointsAwarded) + sum(non-revoked adjustments)`, **always**.
 *
 * Recomputed rather than incremented, so the invariant cannot drift by a missed delta. A game is
 * ~100–200 rows at the documented scale (PRD 1 §2.1), so the cost is irrelevant and the
 * correctness is free.
 */
export function recomputeScores(state: GameState): void {
  const totals = new Map<string, number>()

  for (const play of state.questions.values()) {
    for (const answer of play.answers.values()) {
      totals.set(answer.teamId, (totals.get(answer.teamId) ?? 0) + answer.pointsAwarded)
    }
  }
  for (const adjustment of state.adjustments) {
    if (adjustment.revokedAt !== null) continue
    totals.set(adjustment.teamId, (totals.get(adjustment.teamId) ?? 0) + adjustment.delta)
  }

  for (const team of state.teams.values()) {
    // May be negative (D15).
    team.score = totals.get(team.id) ?? 0
  }
}
