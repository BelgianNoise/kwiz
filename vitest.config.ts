import { defineConfig } from 'vitest/config'

/**
 * One workspace config with a project per package (conventions §1.2).
 *
 * **No jsdom by default.** Almost every required test is a pure-function domain test
 * (CLAUDE.md §6), and a global DOM environment would slow all of them to serve a handful.
 * A component test opts in per file with `// @vitest-environment jsdom`.
 *
 * **No coverage threshold**, deliberately: D18 says coverage is explicitly not a target,
 * and configuring a threshold turns that statement into a lie.
 *
 * `packages/domain`, `packages/db` and `packages/export` are empty until build-order
 * slices 1, 2 and 4, hence `passWithNoTests` — the alternative is a red suite that means
 * nothing, which trains everyone to ignore it.
 */
const project = (name: string, root: string) => ({
  test: {
    name,
    root,
    environment: 'node' as const,
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})

export default defineConfig({
  test: {
    projects: [
      project('config', './packages/config'),
      project('domain', './packages/domain'),
      project('db', './packages/db'),
      project('export', './packages/export'),
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'node',
          include: ['{app,components,lib,i18n}/**/*.test.{ts,tsx}'],
          passWithNoTests: true,
        },
      },
      {
        // Asserts the conventions §1.4 architectural rules actually fire. Spawns oxlint,
        // so it is slower than everything else here and deliberately separate.
        test: {
          name: 'tooling',
          root: '.',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
    ],
  },
})
