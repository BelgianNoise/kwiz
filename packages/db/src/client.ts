import { mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { loadConfig } from '@kwiz/config'
import Database, { type Database as RawDatabase } from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import * as schema from './schema'

/** The `KWIZ_DATA_DIR` layout (PRD 1 §6.6). */
export interface DataPaths {
  dir: string
  dbFile: string
  attachments: string
  backups: string
  /**
   * Inside the data dir, not the OS temp directory, so the atomic rename that stores an
   * attachment stays on one volume — it is only atomic when source and destination do
   * (data model §8).
   */
  tmp: string
}

/** Pure given a cwd: resolves the configured directory and everything under it. */
export function dataPaths(dataDir: string): DataPaths {
  const dir = isAbsolute(dataDir) ? dataDir : resolve(process.cwd(), dataDir)
  return {
    dir,
    dbFile: join(dir, 'kwiz.db'),
    attachments: join(dir, 'attachments'),
    backups: join(dir, 'backups'),
    tmp: join(dir, 'tmp'),
  }
}

export type KwizSchema = typeof schema

export type KwizDb = BetterSQLite3Database<KwizSchema>

/**
 * The handle inside a `db.transaction(...)` callback. Derived rather than imported from
 * Drizzle's internals so it cannot drift from the driver we actually use.
 *
 * Every projection write takes this, never the outer `db` — that is what makes "the projection
 * write is inside the transaction" (data model §6.4.1) a type-level fact rather than a habit.
 */
export type KwizTx = Parameters<Parameters<KwizDb['transaction']>[0]>[0]

export interface KwizDatabase {
  /** The driver handle. Needed for pragmas, backups and raw transactions. */
  raw: RawDatabase
  db: BetterSQLite3Database<KwizSchema>
}

/**
 * data model §2.1 — **required, not tuning.**
 *
 * The second line is the footgun: SQLite does not enforce foreign keys unless you enable
 * them, **per connection**. Every FK in the schema is inert without it, so this runs on every
 * connection a test opens as well as the real one.
 */
export function applyPragmas(raw: RawDatabase): void {
  raw.pragma('journal_mode = WAL') // concurrent readers alongside a writer
  raw.pragma('foreign_keys = ON') // OFF by default in SQLite
  raw.pragma('busy_timeout = 5000') // wait rather than throw SQLITE_BUSY
  raw.pragma('synchronous = NORMAL') // safe under WAL
}

/**
 * Opens one connection with the pragmas applied. Takes a path so tests can pass `':memory:'`
 * and need no fixture directory — `better-sqlite3` being synchronous is what makes that a
 * plain function call rather than a lifecycle.
 */
export function openDatabase(file: string): KwizDatabase {
  const raw = new Database(file)
  applyPragmas(raw)
  return { raw, db: drizzle(raw, { schema }) }
}

let cached: KwizDatabase | undefined

/**
 * The application's connection, opened once. Reads `KWIZ_DATA_DIR` through `@kwiz/config`,
 * which is the only module permitted to touch `process.env` (PRD 1 §6.8).
 *
 * **Does not migrate.** D14 forbids applying migrations as a side effect of connecting; that
 * is `./migrate.ts`, called explicitly at boot.
 */
export function getDatabase(): KwizDatabase {
  if (cached) return cached

  const paths = dataPaths(loadConfig().KWIZ_DATA_DIR)
  mkdirSync(paths.dir, { recursive: true })
  cached = openDatabase(paths.dbFile)
  return cached
}

/** Test and shutdown hook. Closing a connection that was never opened is a no-op. */
export function closeDatabase(): void {
  cached?.raw.close()
  cached = undefined
}
