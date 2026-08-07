import { parseConfig } from '@kwiz/config'
import { dataPaths, loadGameContent, readLog, type KwizDatabase } from '@kwiz/db'
import { freshTestDatabase } from '@kwiz/db/test-support'

import { createGameRegistry } from './registry'
import type { Runtime } from './runtime'
import { createTransport, type Frame, type Subscriber } from './transport'

/**
 * A whole server, minus the HTTP: a real in-memory database with the real migrations, the real
 * registry and the real transport.
 *
 * **Not a mock** (CLAUDE.md §6). `better-sqlite3` is synchronous, so a database costs a function call
 * — there has never been a reason to fake one, and every constraint under test here is the one that
 * ships. What this replaces is only `bootDatabase`, whose job is a terminal prompt.
 */
export interface TestRuntime extends Runtime {
  database: KwizDatabase
}

export function createTestRuntime(
  overrides: Partial<Record<string, string>> = {},
): TestRuntime {
  const config = parseConfig({ ...overrides })
  const database = freshTestDatabase()

  return {
    config,
    paths: dataPaths(config.KWIZ_DATA_DIR),
    database,
    migration: { kind: 'UP_TO_DATE' },
    registry: createGameRegistry({
      loadContent: (gameId) => loadGameContent(database, gameId),
      readLog: (gameId, afterSeq) =>
        readLog(database, gameId, afterSeq).map((entry) => ({
          seq: entry.seq,
          event: entry.event,
          createdAt: entry.createdAt.getTime(),
        })),
    }),
    transport: createTransport(),
  }
}

/** A subscriber that records what it was sent, which is the only way to assert on a push. */
export function recordingSubscriber(
  gameId: string,
  audience: Subscriber['audience'],
  teamId?: string,
): Subscriber & { frames: Frame[]; closed: boolean } {
  const frames: Frame[] = []
  const subscriber = {
    gameId,
    audience,
    ...(teamId === undefined ? {} : { teamId }),
    frames,
    closed: false,
    send(frame: Frame) {
      frames.push(frame)
    },
    close() {
      subscriber.closed = true
    },
  }
  return subscriber
}
