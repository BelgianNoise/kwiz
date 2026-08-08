import type { GameState } from './state'

/**
 * PRD 2 §11.2 / O5 — **what a team arriving mid-game has already missed.**
 *
 * A table turning up during round 1 is normal in a pub, and PRD 1 does not block late joins. What
 * makes it a decision rather than a warning is this arithmetic: *"they have missed 12 questions
 * worth 140 points; their maximum possible score is now 1780, the others' is 1920."*
 *
 * **Computed, not left to the master.** Working that out mid-round in a noisy room is exactly the
 * sort of task that gets skipped, or got wrong, and the consequence is a team that cannot win and
 * nobody noticing until the end.
 *
 * Pure and over the state, so it costs nothing to show and can be tested from a literal event list.
 */
export interface MissedSoFar {
  /** Questions already closed to answers — `LOCKED`, `REVEALED`, `SCORED` or `SKIPPED`. */
  questions: number
  /** Their combined points. A finale question contributes nothing: it awards seconds (D51). */
  points: number
  /** The most this team could still reach: everything not yet missed. */
  maximumPossible: number
  /** The most an existing team could reach, for comparison — the whole quiz. */
  maximumPossibleForOthers: number
  /**
   * §11.2's suggested generosity: **half of what they missed**, rounded down.
   *
   * Suggested, never imposed. It is a defensible number the master can override or zero out, and
   * offering it inline is what stops "add the team now, fix the score later" from being forgotten.
   */
  suggestedStartingScore: number
}

/**
 * A question is "missed" once it can no longer be answered. `SKIPPED` counts too: nobody scored it,
 * so it is not reachable for the newcomer either — but it is equally unreachable for everyone else,
 * which is why it is subtracted from *both* maximums below.
 */
const CLOSED = new Set(['LOCKED', 'REVEALED', 'SCORED', 'SKIPPED'])

export function missedSoFar(state: GameState): MissedSoFar {
  let questions = 0
  let missedPoints = 0
  let totalPoints = 0
  let skippedPoints = 0

  for (const round of state.content.rounds) {
    // A finale keyword question awards seconds, not points (D51), so it cannot be "worth" anything
    // here. Counting it would overstate the gap and suggest a starting score out of thin air.
    const scoring = round.type !== 'DSMTW_FINALE'

    for (const question of round.questions) {
      const points = scoring ? question.points : 0
      totalPoints += points

      const play = state.questions.get(question.id)
      if (!play || !CLOSED.has(play.state)) continue

      questions += 1
      missedPoints += points
      if (play.state === 'SKIPPED') skippedPoints += points
    }
  }

  /*
   * A skipped question is unreachable for everyone, so it comes off both ceilings. Without that, the
   * comparison would tell a master the newcomer is further behind than they are.
   */
  const reachableForOthers = totalPoints - skippedPoints

  return {
    questions,
    points: missedPoints,
    maximumPossible: totalPoints - missedPoints,
    maximumPossibleForOthers: reachableForOthers,
    suggestedStartingScore: Math.floor(missedPoints / 2),
  }
}
