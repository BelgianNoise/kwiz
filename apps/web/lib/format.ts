/**
 * conventions §8.2's duration formats, where **more than one surface needs the same one**.
 *
 * The four formats are not interchangeable and each exists for a stated reason: whole seconds for
 * question timers and finale clocks (D57 — the round is arithmetic, and base-60 conversion under
 * pressure is not), `m:ss` for breaks and media positions (minutes long, nobody subtracting), two
 * decimals for buzz timings (`4.21` vs `4.28` is the drama), and `HH:mm` for an elimination instant
 * (a time of night, not a duration).
 *
 * **Neutral on purpose.** Slice 6 duplicated `minuteSeconds` into `components/screen` rather than
 * import control's, on the argument that two surfaces whose type scales must stay independent should
 * not grow a dependency between them. That argument is right about *components* — they carry `cqh`
 * sizing and one surface's density — and wrong about this: four lines of `number → string` arithmetic
 * have no layout to leak. The review round was correct, and here it is, belonging to neither.
 */

/** `m:ss` — breaks (PRD 4 §11) and media positions (PRD 3 §5.1). */
export function minuteSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
