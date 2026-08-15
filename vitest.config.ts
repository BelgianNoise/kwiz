import { resolve } from 'node:path'

import { defineConfig, defineProject } from 'vitest/config'

/**
 * One workspace config with a project per package (conventions §1.2).
 *
 * **No jsdom by default.** Almost every required test is a pure-function domain test
 * (CLAUDE.md §6), and a global DOM environment would slow all of them to serve a handful.
 * A component test opts in per file with `// @vitest-environment jsdom`.
 *
 * **No coverage threshold**, deliberately: D18 says coverage is explicitly not a target,
 * and configuring a threshold turns that statement into a lie.
 */
const project = (name: string, root: string) =>
  defineProject({
    test: {
      name,
      root,
      environment: 'node' as const,
      include: ['src/**/*.test.ts'],
    },
  })

export default defineConfig({
  test: {
    /**
     * A package with no tests yet is green, not red — the alternative is a failing suite that means
     * nothing, which trains everyone to ignore it. `packages/export` is still in that state.
     *
     * **At the root, because that is the only place it does anything.** It was on each project until
     * slice 6, where `defineProject` type-checked it properly and rejected it: it is a global option,
     * and the looser bare-object overload had been quietly accepting a setting vitest ignores.
     */
    passWithNoTests: true,
    projects: [
      project('config', './packages/config'),
      project('domain', './packages/domain'),
      project('db', './packages/db'),
      project('export', './packages/export'),
      /**
       * **`@/` resolves here, and it took until slice 6 to be worth it.**
       *
       * Without it a test in `apps/web` had to import relatively, which is why no route handler had
       * one and why two near-identical change-detection helpers shipped with only one of them
       * correct. Not a hygiene argument: `useEliminationMoment` swallowed every simultaneous
       * elimination but the first, and the test that would have caught it could not be written.
       *
       * Per-project, because projects do not inherit a root-level alias.
       *
       * `tsconfig` and Next already resolve this alias; this is the third place that has to agree.
       */
      defineProject({
        resolve: { alias: { '@': resolve(import.meta.dirname, 'apps/web') } },
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'node',
          include: ['{app,components,lib,i18n}/**/*.test.{ts,tsx}'],
        },
      }),
      defineProject({
        // Asserts the conventions §1.4 architectural rules actually fire. Spawns oxlint,
        // so it is slower than everything else here and deliberately separate.
        test: {
          name: 'tooling',
          root: '.',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      }),
    ],
  },
})
