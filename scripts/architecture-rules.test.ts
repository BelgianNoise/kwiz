import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * conventions §1.4 says the architectural rules are enforced mechanically rather than
 * trusted. This asserts they actually are.
 *
 * It exists because of something discovered while scaffolding: **oxlint silently ignores a
 * rule name it does not recognise.** No warning, no error, exit code 0. So a typo in
 * `.oxlintrc.json`, or a rule renamed in a future oxlint, turns an architectural guarantee
 * into a decorative line of JSON with nothing to reveal it. That is precisely
 * agent-workflow §8's "a lint rule that does not fire is a comment".
 *
 * Reading the config back would not catch that — only running the linter does. Hence a
 * subprocess: oxlint's `overrides` key on real paths (`packages/domain/**`), so a fixture
 * anywhere else would not match them.
 */

const ROOT = join(import.meta.dirname, '..')

/**
 * These are **not** gitignored, and that is not an oversight: oxlint always honours
 * `.gitignore`, and its `--no-ignore` flag only disables `.eslintignore`. A gitignored
 * fixture is never linted, so the test would pass while proving nothing at all. They are
 * excluded from tsconfig instead, and deleted before and after the run.
 */
const fixtures = {
  purity: 'packages/domain/src/purity.arch-fixture.ts',
  explicitAny: 'packages/db/src/any.arch-fixture.ts',
  floating: 'packages/domain/src/floating.arch-fixture.ts',
  misused: 'packages/domain/src/misused.arch-fixture.ts',
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
 * Reads `stdout`/`stderr` off a rejected child process without asserting a shape onto
 * `unknown` — `in` narrowing is enough, and keeps `no-unsafe-type-assertion` quiet honestly
 * rather than by suppression.
 */
function outputOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  let combined = ''
  if ('stdout' in error && typeof error.stdout === 'string') combined += error.stdout
  if ('stderr' in error && typeof error.stderr === 'string') combined += error.stderr
  return combined
}

function exitCodeOf(error: unknown): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status
  }
  return 1
}

/**
 * Runs oxlint over one file and returns its combined output, whatever the exit code.
 *
 * `--no-ignore` is required because the fixtures are gitignored and oxlint honours
 * `.gitignore`. One command string rather than an argv array: `pnpm` is a shim on Windows and
 * needs a shell, and passing args alongside `shell: true` is deprecated (DEP0190). The paths
 * are the constants above, not input.
 */
function lint(relativePath: string, { typeAware = false } = {}): string {
  const flags = typeAware ? '--type-aware --no-ignore' : '--no-ignore'
  try {
    execSync(`pnpm exec oxlint ${flags} ${relativePath}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return ''
  } catch (error) {
    return outputOf(error)
  }
}

afterAll(removeFixtures)

describe('packages/domain is pure (CLAUDE.md §2.1)', () => {
  write(
    fixtures.purity,
    [
      "import { drizzle } from 'drizzle-orm/better-sqlite3'",
      "import { NextResponse } from 'next/server'",
      "import { readFileSync } from 'node:fs'",
      'export const wrong: any = { drizzle, NextResponse, readFileSync }',
      '',
    ].join('\n'),
  )

  const output = lint(fixtures.purity)

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
  write(fixtures.explicitAny, 'export const wrong: any = 1\n')

  it('reports it as an error, not a warning', () => {
    expect(lint(fixtures.explicitAny)).toMatch(/error.*no-explicit-any/)
  })
})

/**
 * Type-aware, so it needs `--type-aware` and the `oxlint-tsgolint` backend. Without them
 * oxlint reports nothing here and says nothing about why — the failure mode that made this
 * whole file necessary.
 *
 * An unawaited promise is silent by construction: a dropped `appendAndProject()` loses an
 * event, and a dropped SSE write stalls one client. Neither throws.
 */
describe('unhandled promises are rejected (conventions §1.3)', () => {
  write(
    fixtures.floating,
    [
      'async function work(): Promise<void> {}',
      'export function wrong(): void {',
      '  work()',
      '}',
      '',
    ].join('\n'),
  )

  // The same defect wearing a different hat: the callback's promise is dropped by `forEach`,
  // so a rejection inside it is unobservable and the loop does not wait.
  write(
    fixtures.misused,
    [
      'async function work(): Promise<void> {}',
      'const xs = [1, 2]',
      'export function wrong(): void {',
      '  xs.forEach(async (n) => {',
      '    await work()',
      '    void n',
      '  })',
      '}',
      '',
    ].join('\n'),
  )

  const floatingOutput = lint(fixtures.floating, { typeAware: true })

  it('reports an unawaited promise as an error', () => {
    expect(floatingOutput).toMatch(/error.*no-floating-promises/)
  })

  it('reports a promise passed where a void return is expected', () => {
    expect(lint(fixtures.misused, { typeAware: true })).toMatch(
      /error.*no-misused-promises/,
    )
  })

  it('is silent without --type-aware, which is why the flag is in the lint script', () => {
    expect(lint(fixtures.floating)).not.toContain('no-floating-promises')
  })
})

describe('process.env is confined to @kwiz/config (PRD 1 §6.8)', () => {
  /**
   * The third rule in conventions §1.4's table, which oxlint cannot express at all —
   * hence `scripts/check-no-process-env.mjs`.
   */
  it('fails, naming the file, when another package reads the environment', () => {
    write(fixtures.purity, 'export const leak = process.env.KWIZ_DATA_DIR\n')

    let output = ''
    let exitCode = 0
    try {
      execFileSync('node', ['scripts/check-no-process-env.mjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      })
    } catch (error) {
      output = outputOf(error)
      exitCode = exitCodeOf(error)
    }

    expect(exitCode).not.toBe(0)
    expect(output).toContain('purity.arch-fixture.ts')
    expect(output).toContain('@kwiz/config')
  })

  it('passes on the repository as committed', () => {
    removeFixtures()
    expect(() =>
      execFileSync('node', ['scripts/check-no-process-env.mjs'], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })
})
