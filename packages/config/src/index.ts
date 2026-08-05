import { configSchema, type KwizConfig } from './schema'

export { configSchema } from './schema'
export type { KwizConfig } from './schema'

/**
 * The shape of `process.env`, named so callers other than {@link loadConfig} can pass a
 * literal. That is what keeps {@link parseConfig} testable with no mock of the
 * environment (CLAUDE.md §6).
 */
export type EnvSource = Record<string, string | undefined>

/**
 * Thrown when the environment is invalid. A distinct class so the server entry point can
 * print the message and exit cleanly, rather than dumping a zod stack trace at someone
 * whose actual problem is a typo in a shell variable.
 */
export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

function describe(env: EnvSource, key: string): string {
  const raw = env[key]
  if (raw === undefined) return 'not set'
  return `"${raw}"`
}

/**
 * Pure. Validates an environment and returns the typed config, or throws
 * {@link ConfigError} naming every variable that failed and what it was given.
 *
 * PRD 1 §6.8 is explicit that `KWIZ_MAX_DEVICES_PER_TEAM=abc` must stop the server rather
 * than become `NaN` and silently admit unlimited devices, so every failure is fatal and
 * all of them are reported at once — fixing one variable per restart is miserable.
 */
export function parseConfig(env: EnvSource): KwizConfig {
  const result = configSchema.safeParse(env)
  if (result.success) return Object.freeze(result.data)

  const lines = result.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? '(unknown)')
    return `  ${key} — ${issue.message} (received ${describe(env, key)})`
  })

  throw new ConfigError(
    `Invalid environment configuration (PRD 1 §6.8):\n${lines.join('\n')}\n`,
  )
}

let cached: KwizConfig | undefined

/**
 * The single reader of `process.env` in the codebase (conventions §1.4, enforced by
 * `scripts/check-no-process-env.mjs`). Memoised, so the environment is validated exactly
 * once however many times this is called.
 */
export function loadConfig(): KwizConfig {
  cached ??= parseConfig(process.env)
  return cached
}
