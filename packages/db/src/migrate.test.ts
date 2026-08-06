import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it, vi } from 'vitest'

import { openDatabase, type KwizDatabase } from './client'
import {
  isFreshDatabase,
  migrateAtBoot,
  MigrationConsentUnavailableError,
  pendingMigrations,
  type PendingMigration,
} from './migrate'
import { MIGRATIONS_FOLDER } from './test-support'

/**
 * D14 / PRD 1 §6.7 — **an existing database is never migrated silently.**
 *
 * The terminal and the filesystem are injected (`confirm`, `backup`), so every branch is
 * exercised from literals rather than by mocking a TTY (CLAUDE.md §6).
 */

const empty = (): KwizDatabase => openDatabase(':memory:')

const migrated = (): KwizDatabase => {
  const database = empty()
  migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER })
  return database
}

const boot = (
  database: KwizDatabase,
  over: Partial<Parameters<typeof migrateAtBoot>[0]> = {},
) =>
  migrateAtBoot({
    database,
    migrationsFolder: MIGRATIONS_FOLDER,
    autoMigrate: false,
    interactive: true,
    confirm: () => Promise.resolve(true),
    backup: () => Promise.resolve('/backups/kwiz-test.db'),
    ...over,
  })

describe('detecting state', () => {
  it('calls an untouched database fresh', () => {
    expect(isFreshDatabase(empty())).toBe(true)
  })

  it('does not call a migrated database fresh', () => {
    expect(isFreshDatabase(migrated())).toBe(false)
  })

  it('lists every migration as pending on a fresh database', () => {
    expect(pendingMigrations(empty(), MIGRATIONS_FOLDER).length).toBeGreaterThan(0)
  })

  it('lists none once they are applied', () => {
    expect(pendingMigrations(migrated(), MIGRATIONS_FOLDER)).toEqual([])
  })
})

describe('migrateAtBoot', () => {
  it('creates and migrates a fresh database with no prompt — nothing can be lost', async () => {
    const confirm = vi.fn(() => Promise.resolve(true))
    const backup = vi.fn(() => Promise.resolve('unused'))

    const outcome = await boot(empty(), { confirm, backup })

    expect(outcome.kind).toBe('CREATED')
    expect(confirm).not.toHaveBeenCalled()
    // Nothing exists yet, so there is nothing to back up either.
    expect(backup).not.toHaveBeenCalled()
  })

  it('reports up to date without prompting or backing up', async () => {
    const confirm = vi.fn(() => Promise.resolve(true))
    const backup = vi.fn(() => Promise.resolve('unused'))

    expect((await boot(migrated(), { confirm, backup })).kind).toBe('UP_TO_DATE')
    expect(confirm).not.toHaveBeenCalled()
    expect(backup).not.toHaveBeenCalled()
  })

  /**
   * The case D14 exists for. A database holding data but no migration history is *existing*, so
   * it must be asked about — silently migrating someone's played games is the failure mode.
   */
  it('prompts, and backs up first, on an existing database with pending work', async () => {
    const database = empty()
    database.raw.exec('CREATE TABLE legacy (id TEXT PRIMARY KEY)')

    const order: string[] = []
    const outcome = await boot(database, {
      backup: () => {
        order.push('backup')
        return Promise.resolve('/backups/kwiz-x.db')
      },
      confirm: () => {
        order.push('confirm')
        return Promise.resolve(true)
      },
    })

    expect(outcome.kind).toBe('APPLIED')
    // The backup must exist *before* anyone can say yes, or a mistaken yes is irreversible.
    expect(order).toEqual(['backup', 'confirm'])
  })

  it('leaves the database untouched when the master declines', async () => {
    const database = empty()
    database.raw.exec('CREATE TABLE legacy (id TEXT PRIMARY KEY)')

    const outcome = await boot(database, { confirm: () => Promise.resolve(false) })

    expect(outcome.kind).toBe('DECLINED')
    // Still pending: declining blocks the server, it does not half-migrate.
    expect(pendingMigrations(database, MIGRATIONS_FOLDER).length).toBeGreaterThan(0)
  })

  it('skips the prompt under KWIZ_AUTO_MIGRATE but still backs up', async () => {
    const database = empty()
    database.raw.exec('CREATE TABLE legacy (id TEXT PRIMARY KEY)')

    const confirm = vi.fn(() => Promise.resolve(true))
    const backup = vi.fn(() => Promise.resolve('/backups/kwiz-auto.db'))

    const outcome = await boot(database, {
      autoMigrate: true,
      interactive: false,
      confirm,
      backup,
    })

    expect(outcome.kind).toBe('APPLIED')
    expect(confirm).not.toHaveBeenCalled()
    expect(backup).toHaveBeenCalledOnce()
  })

  /** No flag and nobody to ask: refuse to start rather than guess in either direction. */
  it('refuses to start with pending work, no TTY and no flag', async () => {
    const database = empty()
    database.raw.exec('CREATE TABLE legacy (id TEXT PRIMARY KEY)')

    await expect(boot(database, { interactive: false })).rejects.toThrow(
      MigrationConsentUnavailableError,
    )
  })

  it('names the escape hatch in that error, since it appears with no terminal to read it', async () => {
    const database = empty()
    database.raw.exec('CREATE TABLE legacy (id TEXT PRIMARY KEY)')

    await expect(boot(database, { interactive: false })).rejects.toThrow(
      /KWIZ_AUTO_MIGRATE=1/,
    )
  })

  it('tells the prompt exactly what it is agreeing to', async () => {
    const database = empty()
    database.raw.exec('CREATE TABLE legacy (id TEXT PRIMARY KEY)')

    let shown: PendingMigration[] = []
    await boot(database, {
      confirm: (pending) => {
        shown = pending
        return Promise.resolve(true)
      },
    })

    expect(shown.length).toBeGreaterThan(0)
    expect(shown[0]?.statements).toBeGreaterThan(0)
  })
})
