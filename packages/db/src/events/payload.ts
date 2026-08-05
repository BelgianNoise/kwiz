import { z } from 'zod'

import { TIE_PAYOUTS } from '../schema/enums'

/**
 * protocol §4 — every `game_event.type` and its payload schema.
 *
 * **Validated on append *and* on replay** (conventions §10.1). Replay is the one that is easy
 * to skip and the one that matters: the log outlives every deployment, so a payload written by
 * an older build must fail loudly rather than quietly corrupt a projection.
 *
 * Design rule inherited from §4: **if a fact is derivable, it is not an event.** There is no
 * `ANSWER_GRADED` (verdicts are computed from the submission plus accepted answers), no
 * lockout event (derived from denied buzzes), no timer-pause event (derived from buzz and
 * adjudication timestamps), and no clock or turn-order event in the finale (D52).
 */

/**
 * An instant inside a payload is **epoch milliseconds**, not a `Date` or an ISO string.
 *
 * The column is JSON, and JSON has no date type: a `Date` would serialise to a string and come
 * back as one, so the value's type would silently differ between append and replay — exactly
 * what validating on replay exists to catch. Integer ms round-trips identically and matches
 * the `timestamp_ms` columns everywhere else.
 */
const instant = z.number().int().nonnegative()

const id = z.string().min(1)
const teamId = id
/** Resolved hex, never a palette index (data model §6.2, conventions §3). */
const colour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'expected a #RRGGBB hex colour')

const empty = z.strictObject({})

/**
 * Keyed by `type` rather than expressed as one `z.discriminatedUnion`, because the
 * discriminator is a **sibling column** and not a field inside the payload. The
 * `GameEvent` union below is derived from this map, so the two can never drift.
 */
export const gameEventPayloadSchemas = {
  // ─── §4.1 setup & lifecycle ───
  GAME_CREATED: z.strictObject({
    quizName: z.string().min(1),
    quizRevision: z.number().int().positive(),
    code: z.string().min(1),
  }),
  GAME_RESYNCED: z.strictObject({ quizRevision: z.number().int().positive() }),
  CODE_REGENERATED: z.strictObject({ code: z.string().min(1) }),
  TEAM_ADDED: z.strictObject({
    teamId,
    name: z.string().min(1),
    colour,
    position: z.number().int().nonnegative(),
  }),
  TEAM_UPDATED: z.strictObject({
    teamId,
    name: z.string().min(1).optional(),
    colour: colour.optional(),
  }),
  DEVICE_JOINED: z.strictObject({ deviceId: id, teamId }),
  DEVICE_SWITCHED_TEAM: z.strictObject({
    deviceId: id,
    fromTeamId: teamId,
    toTeamId: teamId,
  }),
  /** `SETUP → LIVE`. Does **not** stop further joins (PRD 1 flow step 10). */
  GAME_STARTED: empty,
  GAME_FINISHED: empty,
  GAME_ABANDONED: empty,

  // ─── §4.2 round & question flow ───
  ROUND_OPENED: z.strictObject({ gameRoundId: id }),
  ROUND_CLOSED: z.strictObject({ gameRoundId: id }),
  /** For Jeopardy this **is** tile selection. `deadlineAt` is absolute and advisory (D7, D8). */
  QUESTION_OPENED: z.strictObject({ gameQuestionId: id, deadlineAt: instant.optional() }),
  /** Master action only — never the timer (D8). Commits outstanding drafts. */
  QUESTION_LOCKED: z.strictObject({ gameQuestionId: id }),
  /** The **only** point at which correct answers enter `MAIN_SCREEN` / `PLAYER` views. */
  QUESTION_REVEALED: z.strictObject({ gameQuestionId: id }),
  QUESTION_SCORED: z.strictObject({ gameQuestionId: id }),
  /** Terminal (D46). The reducer forces `pointsAwarded = 0` on every answer to it (I8). */
  QUESTION_SKIPPED: z.strictObject({ gameQuestionId: id }),

  // ─── §4.3 answers ───
  ANSWER_SUBMITTED: z.strictObject({
    gameQuestionId: id,
    teamId,
    text: z.string().optional(),
    selectedOptionId: id.optional(),
    /** True when the server committed a stored draft at lock (D26). */
    fromDraft: z.boolean(),
    /** The one legitimate overwrite: the master answering for a team (D47). */
    enteredByMaster: z.boolean(),
  }),
  /**
   * The master's accept/deny, legal from the moment the answer is submitted (D42). There is
   * deliberately no `ANSWER_REVALIDATED`: a repeat of this event supersedes the earlier one,
   * and the log still shows both decisions in order.
   */
  ANSWER_VALIDATED: z.strictObject({ gameQuestionId: id, teamId, accepted: z.boolean() }),
  /** An event, not ephemeral state, because it changes the pushed view (D40). */
  ANSWER_SPOTLIT: z.strictObject({ gameQuestionId: id, teamId, spotlit: z.boolean() }),

  // ─── §4.4 buzzer (D35) ───
  BUZZ_RECEIVED: z.strictObject({
    buzzId: id,
    gameQuestionId: id,
    teamId,
    /** Server arrival time — the ordering authority. */
    receivedAt: instant,
    offsetMs: z.number().int().nonnegative(),
  }),
  BUZZ_ADJUDICATED: z.strictObject({ buzzId: id, accepted: z.boolean() }),
  /** Master clears **all** lockouts because they misheard (D35 rule 5). */
  BUZZERS_FORCE_REOPENED: z.strictObject({ gameQuestionId: id }),

  // ─── §4.5 `DO` scoring ───
  /** `teamIds: []` is the explicit "no winner" (D23). */
  DO_WINNERS_SET: z.strictObject({
    gameQuestionId: id,
    teamIds: z.array(teamId),
    tiePayout: z.enum(TIE_PAYOUTS),
  }),
  /** Clamped to `0…points` by the domain layer (D24). */
  DO_SCORES_SET: z.strictObject({
    gameQuestionId: id,
    scores: z.array(z.strictObject({ teamId, score: z.number().int() })),
  }),

  // ─── §4.6 `DSMTW_FINALE` (D50) ───
  /** Overrides the authored defaults; legal only while `SETUP` (D54), since I16 forbids
   * editing `game_round.config`. */
  FINALE_CONFIGURED: z.strictObject({
    secondsPerPoint: z.number().positive(),
    penaltySeconds: z.number().int().nonnegative(),
  }),
  /**
   * The master's selection at round open (D55), minimum 2. Each finalist's `startingSeconds`
   * is *not* carried: it is derivable from their score at this `seq` and `secondsPerPoint`, and
   * a derivable fact is not an event.
   */
  FINALISTS_SET: z.strictObject({ teamIds: z.array(teamId).min(2) }),
  /** This timestamp starts the team's clock. */
  TURN_STARTED: z.strictObject({ teamId }),
  /** The interval between start and end is the only thing that charges a team for time. */
  TURN_ENDED: z.strictObject({
    teamId,
    reason: z.enum(['PASSED', 'ELIMINATED', 'QUESTION_CLOSED']),
  }),
  /** A correct guess. Charges every *other* remaining finalist `penaltySeconds`. */
  KEYWORD_MARKED: z.strictObject({ gameKeywordId: id, teamId }),
  /** Revokes the mark **and the penalties it charged** — here D41 must reverse time. */
  KEYWORD_UNMARKED: z.strictObject({ gameKeywordId: id }),
  /** Creates marks with `teamId: null` for the unguessed ones (I21). */
  KEYWORDS_REVEALED: z.strictObject({ gameQuestionId: id }),
  /**
   * `at` is the **computed** instant, not when the request arrived: a team can cross zero while
   * not on turn, taken there by someone else's correct guess. The server recomputes it from the
   * log and ignores any client-supplied value, so a slow browser cannot alter a team's fate.
   */
  TEAM_ELIMINATED: z.strictObject({ teamId, at: instant }),
  /**
   * `ranking` is an array of **rank groups**, outermost first, because simultaneous elimination
   * shares a rank (PRD 1 §8.8, D51). A flat list cannot express that, nor the degenerate case
   * where every finalist goes out at once and first place is shared.
   */
  FINALE_ENDED: z.strictObject({ ranking: z.array(z.array(teamId).min(1)) }),

  // ─── §4.7 jeopardy & scores ───
  /** `durationMs` omitted means an open-ended break: `resumesAt` is null and no clock shows. */
  BREAK_STARTED: z.strictObject({ durationMs: z.number().int().positive().optional() }),
  /** Never automatic — the countdown reaching zero changes nothing server-side (D8). */
  BREAK_ENDED: empty,
  SCOREBOARD_TOGGLED: z.strictObject({ shown: z.boolean() }),
  /** Appended even when it merely confirms the rule, so the log always answers whose pick it
   * was without the reader re-deriving it (D30). */
  PICKER_ASSIGNED: z.strictObject({
    teamId,
    reason: z.enum(['RULE', 'TIE_BREAK', 'MASTER_OVERRIDE']),
  }),
  /** Any time, any amount, may be negative (D15). `announced: false` hides the banner (D25). */
  SCORE_ADJUSTED: z.strictObject({
    teamId,
    delta: z.number().int(),
    reason: z.string().optional(),
    announced: z.boolean(),
  }),
  /** Sets `revokedAt`; the row stays and the total excludes it (D41). Re-revoking is a no-op. */
  SCORE_ADJUSTMENT_REVOKED: z.strictObject({ adjustmentId: id }),
} as const satisfies Record<string, z.ZodType>

export type GameEventType = keyof typeof gameEventPayloadSchemas

export const GAME_EVENT_TYPES = Object.keys(gameEventPayloadSchemas) as GameEventType[]

/**
 * The discriminated union the domain reducer switches on. Derived from the schema map, so a new
 * event type cannot be added to one and forgotten in the other.
 */
export type GameEvent = {
  [K in GameEventType]: {
    type: K
    payload: z.infer<(typeof gameEventPayloadSchemas)[K]>
  }
}[GameEventType]

export type GameEventPayload = GameEvent['payload']

export function isGameEventType(value: string): value is GameEventType {
  return Object.hasOwn(gameEventPayloadSchemas, value)
}
