import { defineConfig } from '@playwright/test'

import { BASE_URL, DATA_DIR, PORT } from './e2e/support/paths'

/**
 * Build-order slice 9 (D49) — the journey-based E2E suite, on top of every surface slices
 * 0–8 built. `pnpm e2e` / `pnpm e2e:ui` (conventions §1.5); its own CI job (§1.6), never
 * folded into `pnpm check`, because it needs a running server and is far slower.
 *
 * **The four determinism rules** (build-order slice 9) drive everything below:
 *
 * 1. **Fresh data dir per run**, by making it unique rather than by deleting anything —
 *    `e2e/support/paths.ts` records the two wrong turns that led there, both of which look
 *    correct until they fail. Within a run every spec shares one database, and that is
 *    deliberate: cross-game isolation (D21) is a property the suite should exercise by existing
 *    rather than by isolating around.
 * 2. **Never sleep.** Enforced by convention in the specs, not by anything here — but the
 *    generous `webServer.timeout` below exists for the same reason: a cold production build on a
 *    CI runner is not the kind of wait this rule is about.
 * 3. **Fixtures build quizzes directly through `@kwiz/db`.** `e2e/support/db.ts` opens the
 *    *same* SQLite file this config points the server at — WAL mode plus `busy_timeout`
 *    (data model §2.1) is what makes a second connection into one running server's database
 *    safe, which is the same guarantee that lets an admin tab and a player tab coexist.
 * 4. **Traces on failure.** `trace: 'retain-on-failure'` — a failing browser test with no trace
 *    costs more to diagnose than it saved.
 *
 * **Two scenarios do not use this server at all**: build-order's #3 (wipe the data dir mid-test)
 * and #22 (kill and restart the server). Wiping or killing *this* server would take every other
 * worker's test down with it, so those two spawn and own an entirely separate instance —
 * `e2e/support/spawn.ts` — on its own port and its own temp directory.
 */

export default defineConfig({
  testDir: './e2e/specs',
  // Deliberately generous: two-device and three-device scenarios (D43, D45, D35) run
  // concurrently against the same server, and a slow CI runner still must not flake.
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The player surface's own scale (CLAUDE.md §7) is set per test via `browser.newContext`,
    // since most specs mix player, control and screen contexts in one run. This default is the
    // admin/control desk's — 0.5 m, standard density.
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  webServer: {
    /*
     * **Production mode — `build` then `start`, not `dev`.** Three reasons, in order of how
     * much they matter:
     *
     * 1. `next dev` is a **singleton per directory** in Next 16: a developer with `pnpm dev`
     *    already running would find `pnpm e2e` refusing to start at all. A suite that only runs
     *    when nothing else is open is a suite people stop running.
     * 2. It is the artifact a quiz master actually runs (`pnpm build && pnpm start`, PRD 1 §6.7),
     *    so the suite exercises the thing that ships rather than a compiler mode of it.
     * 3. No on-demand compilation, so a first page visit is a page load rather than a build —
     *    which removes the single largest source of timing variance the determinism rules exist
     *    to keep out.
     *
     * Invoked through the CLI's own entry file rather than `pnpm` or Windows' `.CMD`/`.ps1`
     * wrapper: one plain node process, which is what lets `e2e/support/spawn.ts`'s
     * kill-the-server scenario end a whole tree from one PID instead of guessing which nested
     * shell holds the port.
     */
    command: `node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start -p ${PORT}`,
    cwd: 'apps/web',
    /*
     * **`/api/games`, not `/en`** — and the difference is the whole readiness contract.
     *
     * `/en` is prerendered static (slice 0 made it so deliberately), so it answers 200 without
     * ever touching the runtime: the database is not opened, migrations do not run, and a fixture
     * writing through `@kwiz/db` a millisecond later hits `no such table: quiz`. This route is
     * `force-dynamic` and calls `getRuntime()`, so a 200 here means *boot finished and the schema
     * is settled* (D14) — which is what "ready" has to mean for a suite whose fixtures write to
     * the same database.
     */
    url: `${BASE_URL}/api/games`,
    // A full production build on a cold CI runner, not a page load — see determinism rule 2.
    timeout: 240_000,
    // Never true: rule 1 is a *fresh* data dir every run, and reusing a server bound to a
    // previous run's directory would silently break that.
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      KWIZ_DATA_DIR: DATA_DIR,
      // A fresh directory needs no prompt either way (D14), but every scenario here assumes a
      // non-interactive boot, and a future change to that default must not turn this suite red
      // for a reason unrelated to the code under test.
      KWIZ_AUTO_MIGRATE: '1',
      // D20's cap, spelled out rather than left to the schema default (currently the same
      // number) so scenario 6 reads as testing a stated rule, not an accident of the default.
      KWIZ_MAX_DEVICES_PER_TEAM: '3',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
