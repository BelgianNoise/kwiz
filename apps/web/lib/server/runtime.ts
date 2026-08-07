import { loadConfig, type KwizConfig } from '@kwiz/config'
import {
  bootDatabase,
  dataPaths,
  describeOutcome,
  loadGameContent,
  readLog,
  type DataPaths,
  type KwizDatabase,
  type MigrationOutcome,
} from '@kwiz/db'

import { createGameRegistry, type GameRegistry } from './registry'
import { createTransport, type RealtimeTransport } from './transport'

/**
 * The server's singletons, assembled once per process: the database, the live projection registry
 * (PRD 1 §6.4) and the transport (§6.9).
 *
 * **Boot settles migrations before anything serves a request** (D14). `bootDatabase` may *prompt* on
 * a terminal, so this is async and awaited by every route — a request that arrives while the master
 * is still answering the prompt waits for the same promise rather than opening a second connection.
 *
 * A `DECLINED` outcome is **not a crash**: the server boots and every surface must render the
 * "database needs migrating" screen, so the outcome is carried here for routes to check.
 */
export interface Runtime {
  config: KwizConfig
  paths: DataPaths
  database: KwizDatabase
  migration: MigrationOutcome
  registry: GameRegistry
  transport: RealtimeTransport
}

let pending: Promise<Runtime> | undefined

export function getRuntime(): Promise<Runtime> {
  // Memoised on the promise, not the value: two requests arriving together must not both boot.
  pending ??= build()
  return pending
}

async function build(): Promise<Runtime> {
  const config = loadConfig()
  const { database, outcome } = await bootDatabase()
  // A server telling its operator what it just did to their database is the one thing that belongs
  // on stdout (PRD 1 §6.7). The directive has to sit immediately above the statement.
  // oxlint-disable-next-line no-console
  console.info(`[kwiz] ${describeOutcome(outcome)}`)

  const registry = createGameRegistry({
    loadContent: (gameId) => loadGameContent(database, gameId),
    readLog: (gameId, afterSeq) =>
      readLog(database, gameId, afterSeq).map((entry) => ({
        seq: entry.seq,
        event: entry.event,
        // The reducer's only clock is the one the event carried (data model §6.4).
        createdAt: entry.createdAt.getTime(),
      })),
  })

  return {
    config,
    paths: dataPaths(config.KWIZ_DATA_DIR),
    database,
    migration: outcome,
    registry,
    transport: createTransport(),
  }
}

/** Whether the schema is settled. `DECLINED` means every action must refuse (D14). */
export function isDatabaseUsable(runtime: Runtime): boolean {
  return runtime.migration.kind !== 'DECLINED'
}
