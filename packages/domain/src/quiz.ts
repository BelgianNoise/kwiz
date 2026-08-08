import type { RoundContent } from './state'

/**
 * The **template** tree, as PRD 2's authoring surface reads it.
 *
 * Structurally the game copy minus its game (data model §3 gives both halves the same columns), so
 * it reuses `RoundContent` and `QuestionContent` rather than declaring a parallel set that would
 * drift. What it does not carry is the four things that only exist once a game does — `gameId`, the
 * denormalised quiz name, the join code and the default player locale.
 */
export interface QuizContent {
  id: string
  name: string
  description: string | null
  /** Machinery for import ordering (D9), never shown to a master (PRD 2 §15.1). */
  revision: number
  /** What the import collision dialog actually compares (PRD 2 §14.2). Epoch ms. */
  updatedAt: number
  rounds: RoundContent[]
}

/**
 * A round's total points — the number PRD 2 §6 puts on every row, because **balance between rounds
 * is what a master worries about while authoring** and it is invisible unless computed.
 *
 * A finale scores in seconds rather than points (D51), so it has no total: showing `0 pts` there
 * would read as an authoring mistake rather than as a different kind of round.
 */
export function roundPoints(round: RoundContent): number | null {
  if (round.type === 'DSMTW_FINALE') return null
  return round.questions.reduce((total, question) => total + question.points, 0)
}

export function quizPoints(quiz: QuizContent): number {
  return quiz.rounds.reduce((total, round) => total + (roundPoints(round) ?? 0), 0)
}

export function questionCount(quiz: QuizContent): number {
  return quiz.rounds.reduce((total, round) => total + round.questions.length, 0)
}

/**
 * PRD 2 §6's `est. 105 min`.
 *
 * **Rough by nature, and labelled as such** — but a master planning an evening needs to know whether
 * they have written 45 minutes or three hours, and only the app can add it up.
 *
 * Per question: its timer, plus a fixed overhead for reading it out, hearing answers and revealing.
 * A finale is charged by its time banks instead, since its questions have no timers at all.
 */
const SECONDS_PER_QUESTION_OVERHEAD = 45
const SECONDS_PER_ROUND_OVERHEAD = 60
/** A finale question runs until the keywords are found or every finalist has passed. */
const SECONDS_PER_FINALE_QUESTION = 150

export function estimatedMinutes(quiz: QuizContent): number {
  let seconds = 0

  for (const round of quiz.rounds) {
    seconds += SECONDS_PER_ROUND_OVERHEAD
    if (round.type === 'DSMTW_FINALE') {
      seconds += round.questions.length * SECONDS_PER_FINALE_QUESTION
      continue
    }
    for (const question of round.questions) {
      const timerMs = question.timerMs ?? round.defaultTimerMs ?? 0
      seconds += Math.round(timerMs / 1000) + SECONDS_PER_QUESTION_OVERHEAD
    }
  }

  return Math.round(seconds / 60)
}

/** The finale round, if this quiz has one. At most one exists (I20), which pre-flight enforces. */
export function finaleRound(quiz: QuizContent): RoundContent | undefined {
  return quiz.rounds.find((round) => round.type === 'DSMTW_FINALE')
}

/**
 * PRD 2 §9's *"A team on 340 pts starts with 170s"* — the conversion shown **working**.
 *
 * A rate entered blind is the easiest way to produce a finale that ends in one question or drags for
 * twenty minutes, so the editor shows what a concrete score becomes rather than only taking a number.
 */
export function secondsForScore(score: number, secondsPerPoint: number): number {
  return Math.max(0, Math.floor(score * secondsPerPoint))
}

/**
 * **The editor asks for the rate upside down, and that is on purpose.**
 *
 * `FINALE_CONFIGURED.secondsPerPoint` is seconds *per point* — `0.5` turns 340 points into 170
 * seconds. PRD 2 §9's field asks *"[2] points = 1 second"*, because that is how a master thinks
 * about it. Two names and two conversions, so the inversion happens in one place instead of at every
 * form that touches it — an inverted rate is a real failure mode, and pre-flight has a warning for it
 * precisely because it is so easy to enter.
 */
export function pointsPerSecond(secondsPerPoint: number): number {
  return secondsPerPoint > 0 ? 1 / secondsPerPoint : 0
}

export function secondsPerPointFromRate(pointsPerOneSecond: number): number {
  return pointsPerOneSecond > 0 ? 1 / pointsPerOneSecond : 0
}
