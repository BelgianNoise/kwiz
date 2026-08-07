import { codeFromBytes, normaliseCode, type GameStatus } from '@kwiz/domain'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import type { KwizDatabase } from './client'
import { game, gameDevice, gameTeam, quiz } from './schema'

/**
 * Resolution: turning a code or a device token into a game, and minting a code that is free.
 *
 * **Nothing here resolves "the current game"** (CLAUDE.md §2.4). Multiple games can be live (D21),
 * so every lookup takes the identifier it was given — never "the most recent" or "the only active
 * one".
 */

/** Joinable means `SETUP` or `LIVE`: codes are unique only among these (data model §6.1). */
export const JOINABLE_STATUSES: GameStatus[] = ['SETUP', 'LIVE']

export interface GameRow {
  id: string
  status: GameStatus
  code: string
  quizName: string
  sourceQuizId: string | null
  quizRevision: number
}

export function findGame(database: KwizDatabase, gameId: string): GameRow | undefined {
  return database.db
    .select({
      id: game.id,
      status: game.status,
      code: game.code,
      quizName: game.quizName,
      sourceQuizId: game.sourceQuizId,
      quizRevision: game.quizRevision,
    })
    .from(game)
    .where(eq(game.id, gameId))
    .get()
}

/**
 * A game by its join code, **normalised first** (conventions §2): a player typing `l` for `1` or
 * `O` for `0` off a projector lands in the right game.
 *
 * Restricted to joinable games, so a code recycled from a finished game resolves to the live one.
 */
export function findJoinableGameByCode(
  database: KwizDatabase,
  code: string,
): GameRow | undefined {
  return database.db
    .select({
      id: game.id,
      status: game.status,
      code: game.code,
      quizName: game.quizName,
      sourceQuizId: game.sourceQuizId,
      quizRevision: game.quizRevision,
    })
    .from(game)
    .where(
      and(eq(game.code, normaliseCode(code)), inArray(game.status, JOINABLE_STATUSES)),
    )
    .get()
}

/**
 * A device by the token it presents. **Identity, not authorisation** (PRD 1 §4): the token says
 * which team's view to build, and there is nothing it grants that being on the network does not.
 *
 * Scoped to a game, so a token from another game reads as unknown rather than resolving to a team
 * in the wrong one.
 */
export function findDeviceByToken(
  database: KwizDatabase,
  gameId: string,
  deviceToken: string,
): { id: string; teamId: string } | undefined {
  return database.db
    .select({ id: gameDevice.id, teamId: gameDevice.teamId })
    .from(gameDevice)
    .where(and(eq(gameDevice.gameId, gameId), eq(gameDevice.deviceToken, deviceToken)))
    .get()
}

/**
 * `game_device.lastSeenAt` — **the other event-sourcing exemption** (protocol §4.8).
 *
 * A heartbeat is not a game fact, and one event per device every few seconds would bloat the log
 * for no replay value. Nothing in `packages/domain` may read it, which is why it is not in
 * `GameState`.
 */
export function touchDevice(database: KwizDatabase, deviceId: string, at: Date): void {
  database.db
    .update(gameDevice)
    .set({ lastSeenAt: at })
    .where(eq(gameDevice.id, deviceId))
    .run()
}

/**
 * A code no joinable game is using.
 *
 * Uniqueness is ultimately the partial unique index's job (data model §6.1); this is what keeps the
 * insert from having to retry. `randomBytes` is injected because a CSPRNG is not something
 * `@kwiz/domain` may reach for and not something this module should assume — the caller passes
 * `node:crypto`'s.
 */
export function generateUnusedCode(
  database: KwizDatabase,
  randomBytes: (size: number) => Uint8Array,
  attempts = 20,
): string {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = codeFromBytes(randomBytes(6))
    const taken = database.db
      .select({ id: game.id })
      .from(game)
      .where(and(eq(game.code, code), inArray(game.status, JOINABLE_STATUSES)))
      .get()
    if (!taken) return code
  }
  // 32^6 codes against at most five live games (PRD 1 §2.1) — reaching here means the generator is
  // not random, which is worth failing loudly over rather than looping for ever.
  throw new Error(`could not find an unused game code in ${attempts} attempts`)
}

/**
 * The dashboard's game list (PRD 2 §5).
 *
 * Carries `templateRevision` beside the game's own `quizRevision` so the **`⚠ template updated`**
 * badge can exist: without it a master edits the template, wonders why the game still shows the
 * typo, and never learns that a re-sync is a thing (data model §7.1).
 */
export interface GameSummary extends GameRow {
  createdAt: Date
  finishedAt: Date | null
  teams: number
  /** `null` once the template has been deleted — the game is self-contained and stays playable. */
  templateRevision: number | null
}

export function listGames(database: KwizDatabase): GameSummary[] {
  const { db } = database

  const rows = db
    .select({
      id: game.id,
      status: game.status,
      code: game.code,
      quizName: game.quizName,
      sourceQuizId: game.sourceQuizId,
      quizRevision: game.quizRevision,
      createdAt: game.createdAt,
      finishedAt: game.finishedAt,
      templateRevision: quiz.revision,
    })
    .from(game)
    .leftJoin(quiz, eq(quiz.id, game.sourceQuizId))
    .orderBy(desc(game.createdAt))
    .all()

  const teamCounts = new Map(
    db
      .select({ gameId: gameTeam.gameId, count: sql<number>`count(*)` })
      .from(gameTeam)
      .groupBy(gameTeam.gameId)
      .all()
      .map((row) => [row.gameId, row.count]),
  )

  return rows.map((row) => ({ ...row, teams: teamCounts.get(row.id) ?? 0 }))
}

/** True when a `SETUP` game is behind its template and a re-sync would bring something new. */
export function isStale(summary: GameSummary): boolean {
  return (
    summary.status === 'SETUP' &&
    summary.templateRevision !== null &&
    summary.templateRevision > summary.quizRevision
  )
}
