import { z } from 'zod'

/**
 * The operational knobs from PRD 1 §6.8, and nothing else. Product behaviour a quiz
 * master should decide belongs in the UI, so resist adding to this list.
 *
 * The schema is the source of truth and the type is inferred from it (conventions §10) —
 * a hand-written interface beside a schema is two sources of truth that drift silently.
 */

/**
 * An optional whole number with a default, kept as a string until the last moment so a
 * rejection message can quote what was actually supplied.
 */
const wholeNumber = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? String(fallback) : v.trim()))
    // Matched as a string rather than coerced, so `3000.5` and `abc` are both rejected.
    // `Number()` would turn the first into a plausible-looking float and the second into
    // the `NaN` PRD 1 §6.8 names as the failure mode to avoid.
    .refine((v) => /^\d+$/.test(v), { error: 'expected a whole number' })
    .transform(Number)
    .refine((n) => n >= min && n <= max, {
      error: `expected a value between ${min} and ${max}`,
    })

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['', '0', 'false', 'no', 'off'])

/**
 * Unset means false, but a value that is neither truthy nor falsy is an error rather than
 * a silent false. `KWIZ_AUTO_MIGRATE=ture` must not quietly re-enable the migration prompt
 * on a headless run, where PRD 1 §6.7 then refuses to start for a reason nobody can see.
 */
const booleanFlag = z
  .string()
  .optional()
  .transform((v) => (v ?? '').trim().toLowerCase())
  .refine((v) => TRUTHY.has(v) || FALSY.has(v), {
    error: 'expected one of 1/true/yes/on or 0/false/no/off',
  })
  .transform((v) => TRUTHY.has(v))

export const configSchema = z.object({
  /** HTTP port. */
  PORT: wholeNumber(3000, 1, 65_535),

  /** Database, attachments and backups (PRD 1 §6.6). Relative paths resolve against cwd. */
  KWIZ_DATA_DIR: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? './data' : v.trim())),

  /** Device cap per team (D20). `1` reproduces strict one-phone-per-team. */
  KWIZ_MAX_DEVICES_PER_TEAM: wholeNumber(3, 1, 100),

  /** Apply pending migrations without prompting (PRD 1 §6.7). */
  KWIZ_AUTO_MIGRATE: booleanFlag,

  /** Per-attachment upload limit (PRD 1 §2.1). */
  KWIZ_MAX_UPLOAD_MB: wholeNumber(50, 1, 2_048),
})

export type KwizConfig = z.infer<typeof configSchema>
