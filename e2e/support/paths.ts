import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Where the suite's server and its fixtures agree to meet.
 *
 * Build-order slice 9's first determinism rule is a **fresh data directory per run**, and getting
 * that right took two wrong turns worth recording, because both look correct:
 *
 * 1. **`mkdtempSync` at config top level.** Playwright runs each worker as its own Node process
 *    and each one loads the config, so this generated a *different* directory per worker: the
 *    server served one database while every fixture wrote to another. It surfaced as
 *    `no such table: quiz` from inside `createQuiz`, which points nowhere near the cause.
 * 2. **A constant path, wiped in `globalSetup`.** Playwright starts `webServer` *before*
 *    `globalSetup` runs, so the wipe was racing a server that had already opened — and on
 *    Windows kept — the file. `EPERM`, unwinnably: no retry can outlast a handle held for the
 *    whole run.
 *
 * So the directory is **unique per run and never wiped**. The run id is minted once, by whichever
 * process loads this module first — the runner, always, since it loads the config before spawning
 * anything — and published through the environment so every worker and the server itself derive
 * the identical path rather than inventing one. Uniqueness is what makes it fresh; nothing has to
 * delete anything, so nothing can race a lock.
 *
 * Old run directories are left where they fall, under `.playwright/` (already gitignored), beside
 * the traces and screenshots of the run that produced them. That is deliberate: a failed run's
 * database is the best evidence there is, and it is sitting exactly where someone diagnosing the
 * failure is already looking.
 */
const RUN_ID_VAR = 'KWIZ_E2E_RUN_ID'

function runId(): string {
  // `??=` rather than a plain assignment: in the runner this mints the id, and in every worker
  // — spawned afterwards, inheriting this environment — it finds the one already minted.
  process.env[RUN_ID_VAR] ??= `${Date.now().toString(36)}-${process.pid.toString(36)}`
  return process.env[RUN_ID_VAR]
}

export const DATA_DIR = resolve('.playwright/data', runId())

export const PORT = 3901
export const BASE_URL = `http://localhost:${PORT}`

/** Mirrors `dataPaths(dir).dbFile` — the layout `@kwiz/db`'s `client.ts` owns. */
export const DB_FILE = resolve(DATA_DIR, 'kwiz.db')

/**
 * Created here rather than in a setup hook, for the same ordering reason as above: the server
 * starts before any hook runs, and `getDatabase` would otherwise be the first thing to create it.
 * Idempotent, so every worker calling it is harmless.
 */
mkdirSync(DATA_DIR, { recursive: true })
