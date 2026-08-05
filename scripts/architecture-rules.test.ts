import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * conventions §1.4 says two of CLAUDE.md §2's rules are enforced mechanically rather than
 * trusted. This asserts they actually are.
 *
 * It exists because of something discovered while scaffolding: **oxlint silently ignores a
 * rule name it does not recognise.** No warning, no error, exit code 0. So a typo in
 * `.oxlintrc.json`, or a rule being renamed in a future oxlint, turns an architectural
 * guarantee into a decorative line of JSON with nothing to reveal it. That is precisely
 * agent-workflow §8's "a lint rule that does not fire is a comment".
 *
 * Reading the config back would not catch that — only running the linter does. Hence a
 * subprocess: the fixtures are written, linted and deleted, because oxlint's `overrides`
 * key on real paths (`packages/domain/**`) and a fixture elsewhere would not match them.
 * `--no-ignore` does not override config `ignorePatterns`, so the files cannot simply live
 * in an ignored directory.
 */

const ROOT = join(import.meta.dirname, '..')

/**
 * These are **not** gitignored, and that is not an oversight: oxlint always honours
 * `.gitignore`, and its `--no-ignore` flag only disables `.eslintignore`. A gitignored
 * fixture is never linted, so the test would pass while proving nothing at all. They are
 * excluded from tsconfig instead, and deleted before and after the run.
 */
const fixtures = {
  domain: 'packages/domain/src/purity.arch-fixture.ts',
  db: 'packages/db/src/any.arch-fixture.ts',
} as const

function removeFixtures(): void {
  for (const path of Object.values(fixtures)) {
    rmSync(join(ROOT, path), { force: true })
  }
}

// A crashed earlier run must not leave a fixture that makes this one lint the wrong source.
removeFixtures()

function write(relativePath: string, source: string): void {
  const absolute = join(ROOT, relativePath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, source, 'utf8')
}

/**
 * Runs oxlint over one file and returns its combined output, whatever the exit code.
 *
 * `--no-ignore` is required because the fixtures are gitignored and oxlint honours
 * `.gitignore`. It does *not* bypass the config's own `ignorePatterns`, which is why the
 * fixtures live at real package paths rather than in an ignored directory.
 */
function lint(relativePath: string): string {
  // One command string rather than an argv array: `pnpm` is a shim on Windows and needs a
  // shell, and passing args alongside `shell: true` is deprecated (DEP0190). The paths are
  // the constants above, not input.
  try {
    execSync(`pnpm exec oxlint --no-ignore ${relativePath}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return ''
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string }
    return stdout + stderr
  }
}

afterAll(removeFixtures)

describe('packages/domain is pure (CLAUDE.md §2.1)', () => {
  write(
    fixtures.domain,
    [
      "import { drizzle } from 'drizzle-orm/better-sqlite3'",
      "import { NextResponse } from 'next/server'",
      "import { readFileSync } from 'node:fs'",
      'export const wrong: any = { drizzle, NextResponse, readFileSync }',
      '',
    ].join('\n'),
  )

  const output = lint(fixtures.domain)

  it.each([
    ['a database driver', 'drizzle-orm/better-sqlite3'],
    ['Next.js', 'next/server'],
    ['the filesystem', 'node:fs'],
  ])('rejects importing %s', (_label, specifier) => {
    expect(output).toContain('no-restricted-imports')
    expect(output).toContain(specifier)
  })

  it('rejects `any`, which is a warning elsewhere but an error here', () => {
    expect(output).toMatch(/error.*no-explicit-any/)
  })
})

describe('packages/db forbids `any` (conventions §1.4)', () => {
  write(fixtures.db, 'export const wrong: any = 1\n')

  it('reports it as an error, not a warning', () => {
    expect(lint(fixtures.db)).toMatch(/error.*no-explicit-any/)
  })
})

describe('process.env is confined to @kwiz/config (PRD 1 §6.8)', () => {
  /**
   * The third rule in conventions §1.4's table, which oxlint cannot express at all —
   * hence `scripts/check-no-process-env.mjs`.
   */
  it('fails, naming the file, when another package reads the environment', () => {
    write(fixtures.domain, 'export const leak = process.env.KWIZ_DATA_DIR\n')

    let output = ''
    let exitCode = 0
    try {
      execFileSync('node', ['scripts/check-no-process-env.mjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      })
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; status?: number }
      output = (e.stdout ?? '') + (e.stderr ?? '')
      exitCode = e.status ?? 1
    }

    expect(exitCode).not.toBe(0)
    expect(output).toContain('purity.arch-fixture.ts')
    expect(output).toContain('@kwiz/config')
  })

  it('passes on the repository as committed', () => {
    rmSync(join(ROOT, fixtures.domain), { force: true })
    expect(() =>
      execFileSync('node', ['scripts/check-no-process-env.mjs'], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })
})
