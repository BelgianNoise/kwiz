/**
 * conventions §5 — every timing constant, in one place.
 *
 * These were scattered across four PRDs before being collected. **Import them; never re-type a
 * number.** A duplicated `1500` in a component is how the multiple-choice reveal beat drifts out
 * of step with the value the spec pins.
 */

/** Player draft push (D8, D45). */
export const DRAFT_DEBOUNCE_MS = 500

/** Backoff start; caps at 5 s and retries while the question is open (PRD 5 §5.4). */
export const SUBMIT_RETRY_BASE_MS = 500

/** Keepalive comment frame (protocol §2.2). */
export const SSE_PING_MS = 15_000

/** `retry:` hint sent on connect. */
export const SSE_RETRY_HINT_MS = 3_000

/** The main screen shows nothing about a dropped device before this (PRD 4 §13). */
export const DISCONNECT_GRACE_MS = 3_000

/** Main-screen cursor hide (PRD 4 §2.3). */
export const CURSOR_HIDE_MS = 2_000

/** Reveal beat 2 for multiple choice (D40). */
export const MC_DISTRIBUTION_DELAY_MS = 1_500

/** Adjustment announcement (D25). */
export const SCORE_BANNER_MS = 6_000

/** Main-screen stage changes (PRD 4 §14) — a range, not a single value. */
export const STAGE_TRANSITION_MS_MIN = 250
export const STAGE_TRANSITION_MS_MAX = 400

/**
 * The two timer thresholds differ **deliberately**, and it is not an oversight: the player device
 * is where someone is still typing and needs a chance to finish, so it warns earlier. The main
 * screen warning any sooner would just be a longer stretch of flashing at an audience.
 */
export const TIMER_WARN_SCREEN_S = 5
export const TIMER_WARN_PLAYER_S = 10

/** Authored default, overridable at `SETUP` (D54). */
export const FINALE_PENALTY_S_DEFAULT = 20

/** A finale clock pulses below this (PRD 4 §12.2). */
export const FINALE_CLOCK_WARN_S = 15

/** How long `−20s` shows beside a clock (PRD 4 §12.3). */
export const FINALE_PENALTY_FLASH_MS = 1_200

/** The `OUT` moment on the main screen (PRD 4 §12.4). */
export const FINALE_ELIMINATION_HOLD_MS = 2_500
