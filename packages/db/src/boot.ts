import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'

import { loadConfig } from '@kwiz/config'

import { dataPaths, openDatabase, type KwizDatabase } from './client'
import {
  backupDatabase,
  migrateAtBoot,
  type MigrationOutcome,
  type PendingMigration,
} from './migrate'

/**
 * The real wiring for D14 / PRD 1 §6.7 — a terminal and a filesystem behind the injected seams
 * `migrate.ts` exposes. Everything decision-shaped lives there and is tested from literals;
 * this module is only the plumbing, which is why it is thin.
 */

/**
 * Where the committed migrations live — **searched, not assumed, and never at module load.**
 *
 * `import.meta.dirname` is the obvious answer and it is only *sometimes* right: under vitest and
 * plain Node this file knows where it is, but Next bundles `@kwiz/db` into the server (it is a
 * `transpilePackages` entry, since the workspace ships TypeScript source), and in that bundle
 * `import.meta.dirname` is **`undefined`**. As a module-level `const` that threw
 * `ERR_INVALID_ARG_TYPE` while Next was collecting page data — a build failure whose message named
 * `join`, not the reason.
 *
 * So: a lazy function over candidates, each verified by the presence of drizzle-kit's journal. The
 * cwd-relative ones cover the bundled server, which runs from `apps/web` (`pnpm start`) or the
 * repo root.
 */
export function migrationsFolder(): string {
  const candidates = [
    // Undefined inside the Next bundle; correct everywhere else.
    import.meta.dirname === undefined
      ? undefined
      : join(import.meta.dirname, '..', 'migrations'),
    join(process.cwd(), '..', '..', 'packages', 'db', 'migrations'),
    join(process.cwd(), 'packages', 'db', 'migrations'),
  ].filter((candidate) => candidate !== undefined)

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate
  }

  throw new Error(
    `could not find the migrations folder; looked in ${candidates.join(', ')}`,
  )
}

/**
 * PRD 1 §6.7's prompt. Lists what will run and where the backup went, then asks — defaulting to
 * yes on a bare Enter, since the master has already been shown the escape route.
 */
async function askTerminal(
  pending: PendingMigration[],
  backupPath: string,
): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    process.stdout.write(`\n${pending.length} pending migration(s):\n`)
    for (const m of pending) {
      process.stdout.write(`  ${m.tag}  (${m.statements} statement(s))\n`)
    }
    process.stdout.write(`\nA backup has been written to ${backupPath}\n`)

    const answer = await rl.question('Apply now? [Y/n] ')
    return !/^n/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

export interface BootResult {
  database: KwizDatabase
  outcome: MigrationOutcome
}

/**
 * Opens the configured database and settles its migrations before anything serves a request.
 *
 * **Never applies migrations as a side effect of connecting** (D14) — the outcome is returned so
 * the caller can decide what to do, which matters for `DECLINED`: the server still boots, but
 * every surface must render "database needs migrating" rather than half-working against a schema
 * the code does not match.
 */
export async function bootDatabase(): Promise<BootResult> {
  const config = loadConfig()
  const paths = dataPaths(config.KWIZ_DATA_DIR)
  mkdirSync(paths.dir, { recursive: true })

  const database = openDatabase(paths.dbFile)

  // The backup runs before the question, not after: a mistaken "yes" must not be irreversible.
  // It is only ever called for an existing database — `migrateAtBoot` skips it on a fresh one,
  // where there is nothing to lose and nothing to consent to.
  let backupPath = ''

  const outcome = await migrateAtBoot({
    database,
    migrationsFolder: migrationsFolder(),
    autoMigrate: config.KWIZ_AUTO_MIGRATE,
    interactive: process.stdin.isTTY ?? false,
    backup: async () => {
      backupPath = await backupDatabase(database, paths.backups, new Date())
      return backupPath
    },
    confirm: (pending) => askTerminal(pending, backupPath),
  })

  return { database, outcome }
}

/** One line describing what happened, for the boot log. */
export function describeOutcome(outcome: MigrationOutcome): string {
  switch (outcome.kind) {
    case 'UP_TO_DATE':
      return 'database up to date'
    case 'CREATED':
      return `database created — ${outcome.applied.length} migration(s) applied`
    case 'APPLIED':
      return `${outcome.applied.length} migration(s) applied (backup: ${outcome.backupPath})`
    default:
      return `migrations declined — ${outcome.pending.length} still pending; every surface must show the "database needs migrating" screen`
  }
}
