/**
 * conventions §1.4 — the third architectural rule, which oxlint cannot express:
 * `process.env` may appear only in `packages/config`.
 *
 * PRD 1 §6.8 requires every env var to be read and validated exactly once at boot
 * through one typed module. A second reader anywhere else is how an unvalidated
 * `undefined` reaches a code path three layers deep, so this is a hard failure and
 * not a warning.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** The one place allowed to read the environment. */
const ALLOWED = [join('packages', 'config', 'src')]

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'data',
  'scripts',
])

const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walk(join(dir, entry.name))
    } else if (EXTENSIONS.test(entry.name)) {
      yield join(dir, entry.name)
    }
  }
}

const violations = []

for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file)
  if (ALLOWED.some((prefix) => rel.startsWith(prefix + sep) || rel.startsWith(prefix)))
    continue

  const source = await readFile(file, 'utf8')
  source.split('\n').forEach((line, i) => {
    // Ignore the rule's own description in a comment.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    if (line.includes('process.env')) {
      violations.push(`${rel}:${i + 1}  ${line.trim()}`)
    }
  })
}

if (violations.length > 0) {
  console.error(
    `\nprocess.env is only permitted in packages/config (PRD 1 §6.8, conventions §1.4).\n` +
      `Read config through @kwiz/config instead.\n`,
  )
  for (const v of violations) console.error(`  ${v}`)
  console.error('')
  process.exit(1)
}

console.log('process.env confined to @kwiz/config ✓')
