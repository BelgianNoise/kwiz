/**
 * PRD 5 §8 — **what the buzzer shows**, as a pure function.
 *
 * Extracted for the same reason `answer-moments.ts` was, and with more cause: this is the surface of
 * D35's deny→lockout→reopen loop, one of the two mechanics CLAUDE.md §6 names by number as a
 * must-test path — and it was the one decision on this surface that never got the treatment. It went
 * wrong in exactly the way a component can and a literal argument list cannot: silently, for the two
 * audiences that are not the single device that happened to win.
 *
 * The rule §8 states, and the one the old code broke: *"local feedback says **buzzed**, never **you
 * were first**. First is a server fact (D35) and arrives a moment later."* So `tapped` may only ever
 * produce `BUZZED`; every claim about who won is read from `holderTeamId`.
 */

export type BuzzerFace =
  /** Denied on this question, so out of the buzzing for it (D35). Shown **with the reason**. */
  | 'LOCKED_OUT'
  /** Our team has the buzz. Answer out loud — true for **every** device on the team, tapped or not. */
  | 'WE_HAVE_IT'
  /** Another team has it. Named, because "who beat us" is the thing the table wants to know. */
  | 'BEATEN'
  /** We tapped and the server has not answered yet. Never a claim about winning. */
  | 'BUZZED'
  /** Live and tappable. */
  | 'ARMED'
  /** Not live and nobody holds it — the master has not opened the buzzers, or has locked them. */
  | 'IDLE'

export function buzzerFace(input: {
  /** `iAmLockedOut` from the view (D35). */
  lockedOut: boolean
  /** `buzzersLive` from the view. */
  live: boolean
  /** `buzzHolderTeamId` — who has the buzz right now, `null` while the buzzers are live. */
  holderTeamId: string | null | undefined
  /** This device's own team. */
  myTeamId: string
  /** Whether this device has tapped since the buzzers were last armed. */
  tapped: boolean
}): BuzzerFace {
  if (input.lockedOut) return 'LOCKED_OUT'

  /*
   * The server's answer beats the local one, always — and it is read against **our team**, not
   * against whether this device was the one that tapped.
   *
   * That distinction is the bug this function exists to make impossible. Deciding from local tap
   * state told a device that tapped and *lost* it was in, and told the second phone on the team that
   * *won* that someone else had got there first — the exact opposite of the truth, on the surface
   * whose one rule is that it never lies.
   */
  if (input.holderTeamId !== null && input.holderTeamId !== undefined) {
    return input.holderTeamId === input.myTeamId ? 'WE_HAVE_IT' : 'BEATEN'
  }

  // Nobody holds it. Our own tap is all we know, and it is worth showing instantly: §8 says waiting
  // for a round trip to acknowledge a buzz feels broken even at 3 ms.
  if (input.tapped) return 'BUZZED'

  return input.live ? 'ARMED' : 'IDLE'
}
