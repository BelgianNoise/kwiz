import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { askTerminal } from './boot'
import { dataPaths, openDatabase, type KwizDatabase } from './client'
import { backupDatabase, migrateAtBoot, pendingMigrations } from './migrate'
import { MIGRATIONS_FOLDER } from './test-support'

/**
 * D14 against a **real directory and a real backup file**, not injected fakes.
 *
 * `migrate.test.ts` covers the decision branches from literals; this covers the half that only a
 * filesystem can answer — does a backup actually appear before the prompt, is it a usable
 * database, and does declining really leave the original alone.
 *
 * `bootDatabase()` itself is not called here: it reads `KWIZ_DATA_DIR` via `@kwiz/config`, and
 * `process.env` is confined to that package (conventions §1.4) — a test setting it would be the
 * one violation the guard exists to catch. Its prompt *is* covered, at the bottom of this file.
 */

let dir: string
let paths: ReturnType<typeof dataPaths>
let database: KwizDatabase

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kwiz-boot-'))
  paths = dataPaths(dir)
  database = openDatabase(paths.dbFile)
})

afterEach(() => {
  database.raw.close()
  rmSync(dir, { recursive: true, force: true })
})

/** An existing database with data but no migration history — the case that must be asked about. */
function makeExisting(): void {
  database.raw.exec('CREATE TABLE legacy (id TEXT PRIMARY KEY, note TEXT)')
  database.raw.prepare('INSERT INTO legacy VALUES (?, ?)').run('1', 'precious')
}

const backupFiles = (): string[] =>
  existsSync(paths.backups) ? readdirSync(paths.backups) : []

describe('the database file itself', () => {
  it('is created on disk at the configured path', () => {
    expect(existsSync(paths.dbFile)).toBe(true)
  })

  it('puts tmp inside the data dir, so the attachment rename stays on one volume (§8)', () => {
    expect(paths.tmp.startsWith(paths.dir)).toBe(true)
    expect(paths.backups.startsWith(paths.dir)).toBe(true)
  })
})

describe('backupDatabase', () => {
  it('writes a timestamped file under backups/', async () => {
    makeExisting()
    const target = await backupDatabase(
      database,
      paths.backups,
      new Date('2026-08-06T21:15:00Z'),
    )

    expect(existsSync(target)).toBe(true)
    expect(target).toContain('kwiz-2026-08-06T21-15-00-000Z.db')
  })

  /** A backup that cannot be opened is not a backup. */
  it('produces a readable database containing the original rows', async () => {
    makeExisting()
    const target = await backupDatabase(database, paths.backups, new Date())

    const restored = openDatabase(target)
    try {
      expect(
        restored.raw.prepare('SELECT note FROM legacy WHERE id = ?').get('1'),
      ).toEqual({
        note: 'precious',
      })
    } finally {
      restored.raw.close()
    }
  })

  it('never collides, because the name carries the instant', async () => {
    makeExisting()
    await backupDatabase(database, paths.backups, new Date('2026-08-06T21:15:00Z'))
    await backupDatabase(database, paths.backups, new Date('2026-08-06T21:16:00Z'))

    expect(backupFiles()).toHaveLength(2)
  })
})

describe('boot against a real data directory', () => {
  const boot = (over: Partial<Parameters<typeof migrateAtBoot>[0]> = {}) =>
    migrateAtBoot({
      database,
      migrationsFolder: MIGRATIONS_FOLDER,
      autoMigrate: false,
      interactive: true,
      confirm: () => Promise.resolve(true),
      backup: () => backupDatabase(database, paths.backups, new Date()),
      ...over,
    })

  it('migrates a fresh database and writes no backup — nothing was at risk', async () => {
    const outcome = await boot()

    expect(outcome.kind).toBe('CREATED')
    expect(backupFiles()).toEqual([])
    expect(pendingMigrations(database, MIGRATIONS_FOLDER)).toEqual([])
  })

  it('backs up to disk before applying, on an existing database', async () => {
    makeExisting()

    let filesWhenAsked: string[] = []
    const outcome = await boot({
      confirm: () => {
        // The file must already exist at the moment the question is put, or a mistaken yes is
        // irreversible.
        filesWhenAsked = backupFiles()
        return Promise.resolve(true)
      },
    })

    expect(outcome.kind).toBe('APPLIED')
    expect(filesWhenAsked).toHaveLength(1)
  })

  it('leaves the original database intact when declined', async () => {
    makeExisting()

    const outcome = await boot({ confirm: () => Promise.resolve(false) })

    expect(outcome.kind).toBe('DECLINED')
    // The schema was not applied…
    expect(pendingMigrations(database, MIGRATIONS_FOLDER).length).toBeGreaterThan(0)
    // …and the data is untouched.
    expect(database.raw.prepare('SELECT note FROM legacy WHERE id = ?').get('1')).toEqual(
      {
        note: 'precious',
      },
    )
    // The backup still exists, which is the right side to err on.
    expect(backupFiles()).toHaveLength(1)
  })

  it('applies without asking under KWIZ_AUTO_MIGRATE, backup and all', async () => {
    makeExisting()

    const outcome = await boot({ autoMigrate: true, interactive: false })

    expect(outcome.kind).toBe('APPLIED')
    expect(backupFiles()).toHaveLength(1)
    expect(pendingMigrations(database, MIGRATIONS_FOLDER)).toEqual([])
  })

  it('leaves a declined database migratable on the next boot', async () => {
    makeExisting()
    await boot({ confirm: () => Promise.resolve(false) })

    expect((await boot({ confirm: () => Promise.resolve(true) })).kind).toBe('APPLIED')
    expect(pendingMigrations(database, MIGRATIONS_FOLDER)).toEqual([])
  })
})

/**
 * **The prompt itself** (PRD 1 §6.7) — the last part of D14 that nothing exercised.
 *
 * A real `readline` over injected streams rather than the process's own: `createInterface` does not
 * care whether its input is a TTY, so the question, the listing and the answer parsing are all
 * genuinely run here. What remains for a human is only whether it *looks* right in a terminal.
 */
describe('the migration prompt', () => {
  const pending = [
    { tag: '0001_initial', statements: 42, folderMillis: 1 },
    { tag: '0002_add_master_notes', statements: 3, folderMillis: 2 },
  ]

  /** Feeds one line of input and collects everything written. */
  async function ask(answer: string): Promise<{ applied: boolean; shown: string }> {
    let shown = ''
    const output = new Writable({
      write(chunk: Buffer, _encoding, done) {
        shown += chunk.toString()
        done()
      },
    })

    const applied = await askTerminal(pending, '/data/backups/kwiz-2026.db', {
      input: Readable.from([`${answer}\n`]),
      output,
    })
    return { applied, shown }
  }

  it('lists every pending migration by name, and says where the backup went', async () => {
    const { shown } = await ask('y')

    expect(shown).toContain('2 pending migration(s)')
    // By name, because "3 migrations will run" tells a master nothing about what they are agreeing
    // to — and this is the one prompt in the product with irreversible consequences.
    expect(shown).toContain('0001_initial')
    expect(shown).toContain('0002_add_master_notes')
    expect(shown).toContain('/data/backups/kwiz-2026.db')
    expect(shown).toContain('Apply now? [Y/n]')
  })

  it('honours n, and treats a bare Enter as yes', async () => {
    expect((await ask('n')).applied).toBe(false)
    expect((await ask('N')).applied).toBe(false)
    expect((await ask('no')).applied).toBe(false)

    // Defaulting to yes is safe **because the backup already exists** — the master has been shown
    // the escape route before being asked.
    expect((await ask('')).applied).toBe(true)
    expect((await ask('y')).applied).toBe(true)
    expect((await ask('  ')).applied).toBe(true)
  })
})
