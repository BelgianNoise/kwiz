import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { KwizDatabase } from './client'

/**
 * D14 / PRD 1 §6.7 — migrations are **never applied silently to an existing database.**
 *
 * Drizzle gives no list-pending API (`migrate()` applies everything and returns void), so the
 * three pieces are assembled here per data model §11.1.
 */

export interface PendingMigration {
  tag: string
  /** The migration's timestamp, and also what `__drizzle_migrations.created_at` holds. */
  folderMillis: number
  statements: number
}

/** Thrown when there is pending work and no way to ask. Boot must stop, not guess. */
export class MigrationConsentUnavailableError extends Error {
  override readonly name = 'MigrationConsentUnavailableError'
}

export type MigrationOutcome =
  | { kind: 'UP_TO_DATE' }
  /** A new database: created and migrated with no prompt, because nothing can be lost. */
  | { kind: 'CREATED'; applied: PendingMigration[] }
  | { kind: 'APPLIED'; applied: PendingMigration[]; backupPath: string | undefined }
  /** The master said no. Every surface must render "database needs migrating" (§6.7). */
  | { kind: 'DECLINED'; pending: PendingMigration[] }

const MIGRATIONS_TABLE = '__drizzle_migrations'

/**
 * A database nobody has migrated yet has **no tables at all** — the tracking table is created
 * by the first `migrate()`. Checking for user tables too means a database that somehow holds
 * data without a tracking table is treated as existing, and therefore prompted about, rather
 * than silently migrated.
 */
export function isFreshDatabase({ raw }: KwizDatabase): boolean {
  const tables = raw
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all()
  return tables.length === 0
}

function appliedThrough({ raw }: KwizDatabase): number {
  const exists = raw
    .prepare<[string], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(MIGRATIONS_TABLE)
  if (!exists) return 0

  const latest = raw
    .prepare<[], { created_at: number | null }>(
      `SELECT max(created_at) AS created_at FROM ${MIGRATIONS_TABLE}`,
    )
    .get()
  return latest?.created_at ?? 0
}

/**
 * What `migrate()` would apply, computed **the same way the migrator computes it** — by
 * `folderMillis > max(created_at)`, not by hash difference.
 *
 * Those two disagree for a migration committed with an out-of-order timestamp, and a prompt
 * that lists different work than the migrator then performs is worse than no prompt.
 */
export function pendingMigrations(
  database: KwizDatabase,
  migrationsFolder: string,
): PendingMigration[] {
  const through = appliedThrough(database)
  return readMigrationFiles({ migrationsFolder })
    .filter((m) => m.folderMillis > through)
    .map((m) => ({
      tag: `${m.folderMillis}`,
      folderMillis: m.folderMillis,
      statements: m.sql.length,
    }))
}

export interface BootMigrationOptions {
  database: KwizDatabase
  migrationsFolder: string
  /** `KWIZ_AUTO_MIGRATE` — for Docker and scripted runs with no terminal attached. */
  autoMigrate: boolean
  /** Whether anyone can answer. `process.stdin.isTTY` in production. */
  interactive: boolean
  /** Asked only when there is pending work on an existing database. */
  confirm: (pending: PendingMigration[]) => Promise<boolean>
  /**
   * Writes a copy **before** the first migration runs and returns its path. Cheap on SQLite,
   * and it turns an irreversible mistake into an annoyance.
   */
  backup: () => Promise<string>
}

/**
 * The boot decision, with the terminal and the filesystem injected so the branching is
 * testable from literals rather than by mocking a TTY (CLAUDE.md §6).
 */
export async function migrateAtBoot(
  options: BootMigrationOptions,
): Promise<MigrationOutcome> {
  const { database, migrationsFolder, autoMigrate, interactive, confirm, backup } =
    options

  const fresh = isFreshDatabase(database)
  const pending = pendingMigrations(database, migrationsFolder)

  if (pending.length === 0) return { kind: 'UP_TO_DATE' }

  // Nothing exists to lose, so there is nothing to consent to.
  if (fresh) {
    migrate(database.db, { migrationsFolder })
    return { kind: 'CREATED', applied: pending }
  }

  if (autoMigrate) {
    const backupPath = await backup()
    migrate(database.db, { migrationsFolder })
    return { kind: 'APPLIED', applied: pending, backupPath }
  }

  // No flag and nobody to ask: refuse to start rather than guess in either direction.
  if (!interactive) {
    throw new MigrationConsentUnavailableError(
      `${pending.length} pending migration(s) and no TTY to confirm them.\n` +
        `Set KWIZ_AUTO_MIGRATE=1 to apply them without prompting (PRD 1 §6.7).`,
    )
  }

  const backupPath = await backup()
  if (!(await confirm(pending))) {
    return { kind: 'DECLINED', pending }
  }

  migrate(database.db, { migrationsFolder })
  return { kind: 'APPLIED', applied: pending, backupPath }
}

/**
 * A timestamped copy in `backups/`, via the driver's own backup rather than a file copy:
 * under WAL, copying `kwiz.db` alone can miss committed pages still in the write-ahead log.
 */
export async function backupDatabase(
  database: KwizDatabase,
  backupsDir: string,
  at: Date,
): Promise<string> {
  mkdirSync(backupsDir, { recursive: true })
  const stamp = at.toISOString().replace(/[:.]/g, '-')
  const target = join(backupsDir, `kwiz-${stamp}.db`)
  await database.raw.backup(target)
  return target
}
