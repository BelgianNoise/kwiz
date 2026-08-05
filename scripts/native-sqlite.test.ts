import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * conventions §1.1 requires that a clean install on Node 24 needs **no C++ toolchain**,
 * because a quiz master's laptop will not have one. Slice 0 verified that by hand; this
 * keeps it verified.
 *
 * Without a test, the guarantee decays silently in two ways: a future `better-sqlite3` could
 * stop shipping prebuilds for a platform, or someone could flip `allowBuilds.better-sqlite3`
 * to `true` in `pnpm-workspace.yaml` and "fix" an install by compiling it. Both look fine on
 * the machine where they happen and break on someone else's.
 *
 * If this fails, the response is §1.1's documented fallback — pin to the newest Node major
 * with a prebuild, or swap the driver to `node:sqlite` — **not** enabling the compile.
 */

const ROOT = join(import.meta.dirname, '..')

// `better-sqlite3` belongs to @kwiz/db, and pnpm's strict node_modules means the workspace
// root cannot resolve it. Resolve from the package that owns it.
const requireFromDb = createRequire(join(ROOT, 'packages', 'db', 'package.json'))
const packageDir = dirname(requireFromDb.resolve('better-sqlite3/package.json'))

/** The prebuild filenames that would satisfy the current platform. */
const acceptablePrebuilds =
  process.platform === 'linux'
    ? [`linux-${process.arch}.node`, `linuxmusl-${process.arch}.node`]
    : [`${process.platform}-${process.arch}.node`]

describe('better-sqlite3 installs without compiling (conventions §1.1)', () => {
  it('ships a prebuild for this platform', () => {
    const available = readdirSync(join(packageDir, 'prebuilds'))
    expect(available.some((name) => acceptablePrebuilds.includes(name))).toBe(true)
  })

  it('has no compiled output, meaning node-gyp never ran', () => {
    expect(existsSync(join(packageDir, 'build'))).toBe(false)
  })
})

/**
 * The prebuild existing is not the same as it working. This is the smallest end-to-end proof
 * that the binary on *this* platform loads and behaves.
 *
 * It is not a duplicate of slice 1's connection tests: those cover our own pragma setup on
 * the real connection module, whereas this covers the driver binary itself, and is the reason
 * a CI matrix runs on more than one OS.
 */
describe('the prebuilt binary works', () => {
  type Statement = { run: (...args: unknown[]) => unknown; get: () => unknown }
  type Connection = {
    pragma: (source: string, options?: { simple?: boolean }) => unknown
    exec: (sql: string) => void
    prepare: (sql: string) => Statement
    close: () => void
  }

  // Annotated rather than asserted. `require` of an untyped CJS module yields `any`, and
  // assigning it to a typed binding avoids the `as` that `no-unsafe-type-assertion` flags.
  // better-sqlite3 ships no types of its own, and `@types/better-sqlite3` still targets v9
  // against our v13 — whether to add it is slice 1's call, when Drizzle needs the real ones.
  const Database: new (path: string) => Connection = requireFromDb('better-sqlite3')

  const open = (): Connection => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    return db
  }

  it('loads and answers a query', () => {
    const db = open()
    try {
      expect(db.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 })
    } finally {
      db.close()
    }
  })

  /**
   * CLAUDE.md §4: SQLite does not enforce foreign keys without this pragma, and every FK in
   * the data-model schema is inert if it is missing. Asserting the pragma is *set* would
   * prove nothing about whether it bites, so this provokes an actual violation.
   */
  it('enforces foreign keys once the pragma is on', () => {
    const db = open()
    try {
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1)

      db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY)')
      db.exec(
        'CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id))',
      )

      expect(() =>
        db.prepare('INSERT INTO child VALUES (?, ?)').run('c1', 'does-not-exist'),
      ).toThrow(/FOREIGN KEY/i)
    } finally {
      db.close()
    }
  })
})
