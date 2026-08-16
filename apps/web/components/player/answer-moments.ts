/**
 * PRD 5 §5.4 — **the one decision the auto-submit makes**, as a pure function.
 *
 * The wiring around it is a `useEffect` that re-runs on every keystroke and every pushed view; the
 * decision itself is four booleans, and both bugs this slice found lived in it rather than in the
 * wiring. Pulling it out is CLAUDE.md §6's rule about mocks: a component test for this would need a
 * fake timer, a fake stream and a fake POST to assert something a literal argument list can.
 */

export type AutoSubmit =
  /** The timer has not run out yet, or the team has already answered. */
  | 'WAIT'
  /**
   * Zero has passed with nothing entered. **Nothing is sent, and the shot is spent.**
   *
   * D43 makes the first submission final, so submitting an empty answer would burn the team's only
   * answer on nothing — and re-arming would submit the first character they type afterwards, which
   * is the precise opposite of D8's *"a phone asleep at zero submits when it wakes"*.
   */
  | 'DISARM'
  /** O6's rescue: something was entered and never sent. Flush the draft debounce, then submit. */
  | 'SUBMIT'

export function autoSubmitAt(input: {
  expired: boolean
  submitted: boolean
  /** Whether this question's one shot has already been taken. */
  fired: boolean
  /** What the team currently has entered — trimmed text, or a selected option id. */
  entered: string | null
}): AutoSubmit {
  if (!input.expired || input.submitted || input.fired) return 'WAIT'
  return input.entered ? 'SUBMIT' : 'DISARM'
}
