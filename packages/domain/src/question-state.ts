import type { GameEventType } from './events/payload'

/**
 * PRD 1 §7.1 — the question lifecycle that confidentiality invariants 1–6 are written against.
 * Every transition is an event; there is no other way to move.
 *
 * ```
 *   PENDING ──open──▶ OPEN ──lock──▶ LOCKED ──reveal──▶ REVEALED ──score──▶ SCORED
 *      │               │               │
 *      └────skip───────┘               └──────────score─────────────────────▶ SCORED
 *              ▼
 *           SKIPPED  (terminal, awards nothing)
 * ```
 *
 * **A buzz is not a state.** PRD 1 §7.1's diagram draws `BUZZED` as a box, but the canonical type
 * (protocol §5.5) has six states and no such member — a buzz *pauses* an `OPEN` question for
 * adjudication and the question stays `OPEN` throughout. Modelling it as a state would make the
 * deny → reopen loop (D35) a cycle in the state machine rather than what it is: repeated buzzes
 * against one unchanged question.
 */
export const QUESTION_STATES = [
  'PENDING',
  'OPEN',
  'LOCKED',
  'REVEALED',
  'SCORED',
  'SKIPPED',
] as const
export type QuestionState = (typeof QUESTION_STATES)[number]

/** Nothing follows these. `SCORED` stays editable from PRD 2, but by new events, not transitions. */
export const TERMINAL_QUESTION_STATES = ['SCORED', 'SKIPPED'] as const

export function isTerminalQuestionState(state: QuestionState): boolean {
  return state === 'SCORED' || state === 'SKIPPED'
}

/**
 * The transition table. Absent pair ⇒ illegal.
 *
 * `LOCKED → SCORED` exists for **`DO` questions, which skip `REVEALED` entirely** — there is
 * nothing hidden to reveal, so the master scores straight from `LOCKED` (PRD 1 §7.1). It is not
 * restricted to `DO` here because no spec forbids scoring another type without revealing, and
 * inventing a prohibition the documents do not state would be the wrong way to resolve silence.
 *
 * `SKIPPED` is reachable only from `PENDING` (a broken question the master went around) and
 * `OPEN` (opened, then abandoned because the audio would not play) — D46.
 */
const TRANSITIONS: Partial<
  Record<QuestionState, Partial<Record<GameEventType, QuestionState>>>
> = {
  PENDING: {
    QUESTION_OPENED: 'OPEN',
    QUESTION_SKIPPED: 'SKIPPED',
  },
  OPEN: {
    QUESTION_LOCKED: 'LOCKED',
    QUESTION_SKIPPED: 'SKIPPED',
  },
  LOCKED: {
    QUESTION_REVEALED: 'REVEALED',
    QUESTION_SCORED: 'SCORED',
  },
  REVEALED: {
    QUESTION_SCORED: 'SCORED',
  },
}

/**
 * The state a question is in after an event, or `undefined` if the event does not apply.
 *
 * `undefined` covers two different things on purpose — an event irrelevant to this question's
 * lifecycle, and one that is relevant but illegal from here. Callers that need to *reject* an
 * illegal transition use {@link canTransition}; a reducer folding the whole log just ignores
 * anything that yields nothing.
 */
export function nextQuestionState(
  from: QuestionState,
  event: GameEventType,
): QuestionState | undefined {
  return TRANSITIONS[from]?.[event]
}

export function canTransition(from: QuestionState, event: GameEventType): boolean {
  return nextQuestionState(from, event) !== undefined
}

/** Whether submissions are accepted. Only the master locking a question stops them (D8). */
export function acceptsSubmissions(state: QuestionState): boolean {
  return state === 'OPEN'
}

/**
 * Whether the correct answer may cross the wire to `MAIN_SCREEN` or `PLAYER`.
 *
 * Confidentiality invariant 1: never while `PENDING`, `OPEN` or `LOCKED`. `SKIPPED` is **excluded**
 * — a question the room never saw resolved should not have its answer pushed out by a state
 * change nobody asked for.
 */
export function revealsCorrectAnswer(state: QuestionState): boolean {
  return state === 'REVEALED' || state === 'SCORED'
}
