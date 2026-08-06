import type { AnswerVerdict } from './vocabulary'

/**
 * D22 — answer matching, and the deliberate narrowness of it.
 *
 * **Lowercase and trim. Nothing else.** No fuzzy matching, no Levenshtein, no stripping of
 * punctuation or accents. The rule is not that those are hard; it is that a machine guessing at
 * near-misses produces confident wrong verdicts, and a pub quiz has a human right there whose job
 * is exactly that judgement.
 */
export function normaliseAnswer(text: string): string {
  return text.trim().toLowerCase()
}

/**
 * Whether a typed answer exactly matches any accepted answer, after normalisation.
 *
 * `accepted` is a list from day one (D33): a question may legitimately accept "JFK", "John F.
 * Kennedy" and "Kennedy".
 */
export function matchesAcceptedAnswer(
  text: string,
  accepted: readonly string[],
): boolean {
  const normalised = normaliseAnswer(text)
  return accepted.some((candidate) => normaliseAnswer(candidate) === normalised)
}

/**
 * The verdict a `FREE_TEXT` submission auto-resolves to.
 *
 * **A non-match is `PENDING`, never `AUTO_WRONG`.** The machine is only ever allowed to be
 * *right*: "Kennedy" against an accepted "John F. Kennedy" is a human's call, and auto-rejecting
 * it would produce a stream of wrong verdicts with no visible cause. `AUTO_WRONG` exists solely
 * for multiple choice, where correctness is unambiguous.
 */
export function gradeFreeText(
  text: string | undefined,
  accepted: readonly string[],
): AnswerVerdict {
  if (text === undefined || normaliseAnswer(text) === '') return 'NO_ANSWER'
  return matchesAcceptedAnswer(text, accepted) ? 'AUTO_CORRECT' : 'PENDING'
}

/**
 * The verdict a `MULTIPLE_CHOICE` submission auto-resolves to. Unambiguous in both directions,
 * which is why this one may reject.
 */
export function gradeMultipleChoice(
  selectedOptionId: string | undefined,
  correctOptionId: string,
): AnswerVerdict {
  if (selectedOptionId === undefined) return 'NO_ANSWER'
  return selectedOptionId === correctOptionId ? 'AUTO_CORRECT' : 'AUTO_WRONG'
}

/** Verdicts that carry points (I8). `DO` questions are scored separately and bypass this. */
export function verdictAwardsPoints(verdict: AnswerVerdict): boolean {
  return verdict === 'AUTO_CORRECT' || verdict === 'ACCEPTED'
}
