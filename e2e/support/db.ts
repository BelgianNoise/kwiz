import { randomBytes } from 'node:crypto'

import { generateUnusedCode, openDatabase, type KwizDatabase } from '@kwiz/db'
import { TEAM_PALETTE } from '@kwiz/domain'

import { DB_FILE } from './paths'

/**
 * The **third determinism rule** (build-order slice 9): fixtures build quizzes directly
 * through `@kwiz/db`, never through the authoring UI, so 20 scenarios' setup does not depend
 * on the one surface that is itself under test in scenarios 1–4.
 *
 * `openDatabase` opens a **second connection** to the file the shared server already has open
 * — safe because of the same pragmas the server itself runs on boot (WAL, `busy_timeout`;
 * data model §2.1). This is not a special case for tests: it is the identical situation an
 * admin tab and a player tab are already in, both talking to one file through two connections.
 *
 * **One connection per Playwright worker, never per test.** Playwright runs each worker as its
 * own Node process, so this module-level `let` is naturally worker-scoped — reused by every
 * test file that process runs, and never shared with another worker's process.
 */
let db: KwizDatabase | undefined

export function testDb(): KwizDatabase {
  db ??= openDatabase(DB_FILE)
  return db
}

/**
 * Runs one fixture write, retrying while SQLite reports the file busy.
 *
 * **Why this is needed even though `busy_timeout` is already 5 s** (data model §2.1): in WAL
 * mode a *deferred* transaction that reads first and then upgrades to a write cannot wait — if
 * another connection holds the write lock, SQLite returns `SQLITE_BUSY` **immediately**,
 * without consulting the busy handler, because waiting there could deadlock. Every
 * `@kwiz/db` mutation is a drizzle transaction, which is deferred, so the timeout that covers
 * the app's single-connection writes does not cover a second connection racing it.
 *
 * That race is exactly what Playwright's workers produce: several processes, each with its own
 * connection, each building a fixture at the same moment. It surfaced as `database is locked`
 * from `createRound` — in a spec about reloading a phone.
 *
 * Retrying is safe because a transaction that reported busy never committed: there is no
 * half-built quiz to reconcile, only a call to make again. Bounded rather than open-ended, so
 * a genuine deadlock fails the spec instead of hanging it out to the test timeout — 160
 * attempts at a 25 ms spin is roughly four seconds of contention headroom, which several
 * parallel workers building fixtures at once has been measured to need.
 */
export function retryOnBusy<T>(operation: () => T, attempts = 160): T {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return operation()
    } catch (error) {
      if (!isBusy(error)) throw error
      last = error
      // Synchronous: these helpers are called from synchronous fixture code, and a blocking
      // spin of a few milliseconds is cheaper than making every builder async for this.
      spinFor(25)
    }
  }
  throw new Error(`fixture setup gave up waiting for the database: ${String(last)}`)
}

function isBusy(error: unknown): boolean {
  // `better-sqlite3` puts the SQLite result code on `error.code`. Read structurally rather than
  // by asserting a shape onto `unknown` — a thrown non-object must answer "not busy", not crash.
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = error.code
  return code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT'
}

function spinFor(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    // Intentionally empty: yielding would need async, and see `retryOnBusy`'s note.
  }
}

/** A join code guaranteed free among joinable games, the same way the app itself mints one. */
export function freshCode(): string {
  return retryOnBusy(() =>
    generateUnusedCode(testDb(), (size) => new Uint8Array(randomBytes(size))),
  )
}

/** PRD 1 §9.3's resolved palette, so fixtures never invent a colour outside it. */
export const PALETTE: readonly string[] = TEAM_PALETTE.map((entry) => entry.hex)
