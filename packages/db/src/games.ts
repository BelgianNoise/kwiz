import {
  codeFromBytes,
  normaliseCode,
  type GameStatus,
  type MainScreenColourScheme,
  type MainScreenTypography,
} from '@kwiz/domain'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import type { KwizDatabase } from './client'
import { game, gameAnswer, gameDevice, gameTeam, quiz } from './schema'

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
  /** PRD 4 §5.1 / D60 — the quiz's default at creation; a `state.mainScreenThemeOverride` may win over it. */
  mainScreenColourScheme: MainScreenColourScheme
  mainScreenTypography: MainScreenTypography
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
      mainScreenColourScheme: game.mainScreenColourScheme,
      mainScreenTypography: game.mainScreenTypography,
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
      mainScreenColourScheme: game.mainScreenColourScheme,
      mainScreenTypography: game.mainScreenTypography,
    })
    .from(game)
    .where(
      and(eq(game.code, normaliseCode(code)), inArray(game.status, JOINABLE_STATUSES)),
    )
    .get()
}

/**
 * A **finished or abandoned** game by its join code — PRD 5 §15 O3's morning-after bookmark.
 *
 * The deliberate counterpart to `findJoinableGameByCode`, and it exists as a second function rather
 * than a flag on the first so the priority can never be got backwards: a caller resolves *joinable*
 * first and only falls back here. That ordering is what keeps a recycled code pointing at the live
 * game while it is live, which is the reason the restriction was there to begin with.
 *
 * Newest first, because a code reused across three nights should show last night's, not the first.
 */
export function findEndedGameByCode(
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
      mainScreenColourScheme: game.mainScreenColourScheme,
      mainScreenTypography: game.mainScreenTypography,
    })
    .from(game)
    .where(
      and(
        eq(game.code, normaliseCode(code)),
        inArray(game.status, ['FINISHED', 'ABANDONED'] satisfies GameStatus[]),
      ),
    )
    .orderBy(desc(game.createdAt))
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
      mainScreenColourScheme: game.mainScreenColourScheme,
      mainScreenTypography: game.mainScreenTypography,
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

/**
 * PRD 2 §5's `winner: Quizzly…` column, for every finished game at once.
 *
 * **From `game_team.score`, not from a replay.** The score is a projection kept in step by
 * `appendAndProject`, so it is already correct; folding every finished game's log to render a
 * dashboard row would make the list slower with every quiz a master has ever run.
 *
 * A tie returns every team on the top score, because "winner: A" when B drew with them is a lie the
 * dashboard would tell silently.
 */
export function gameWinners(database: KwizDatabase): Map<string, string[]> {
  const rows = database.db
    .select({
      gameId: gameTeam.gameId,
      name: gameTeam.name,
      score: gameTeam.score,
      status: game.status,
    })
    .from(gameTeam)
    .innerJoin(game, eq(game.id, gameTeam.gameId))
    .where(eq(game.status, 'FINISHED'))
    .all()

  const best = new Map<string, { score: number; names: string[] }>()
  for (const row of rows) {
    const current = best.get(row.gameId)
    if (!current || row.score > current.score) {
      best.set(row.gameId, { score: row.score, names: [row.name] })
    } else if (row.score === current.score) {
      current.names.push(row.name)
    }
  }

  return new Map([...best].map(([gameId, entry]) => [gameId, entry.names]))
}

/** True when a `SETUP` game is behind its template and a re-sync would bring something new. */
export function isStale(summary: GameSummary): boolean {
  return (
    summary.status === 'SETUP' &&
    summary.templateRevision !== null &&
    summary.templateRevision > summary.quizRevision
  )
}

/**
 * What deleting this game would cost, for §12.1's confirmation.
 *
 * Counted rather than estimated, and **named in the dialog**, because the fear that stops masters
 * cleaning up is not knowing what goes — the same reason §5's quiz delete says what survives.
 */
export interface GameLoss {
  teams: number
  answers: number
  quizName: string
}

export function gameLoss(database: KwizDatabase, gameId: string): GameLoss | undefined {
  const row = database.db
    .select({ quizName: game.quizName })
    .from(game)
    .where(eq(game.id, gameId))
    .get()
  if (!row) return undefined

  const count = (table: typeof gameTeam | typeof gameAnswer): number =>
    database.db
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .where(eq(table.gameId, gameId))
      .get()?.n ?? 0

  return { teams: count(gameTeam), answers: count(gameAnswer), quizName: row.quizName }
}

/**
 * Data model §10 — deleting a game **cascades** to its copy subtree, teams, devices, events, drafts
 * and all four projections. One statement, because every one of those tables hangs off `game.id`.
 *
 * Offered per game (§12.1) and deliberately **not** in bulk (Q5): a master who ran a game by mistake
 * must be able to remove it, but a "delete everything older than N" sweep is destructive over the
 * only copy of their history, and it solves a storage problem that does not exist — game copies are
 * a couple of hundred rows and attachment files are shared by checksum.
 *
 * The quiz is untouched. `sourceQuizId` points *at* the quiz, not the other way round.
 */
export function deleteGame(database: KwizDatabase, gameId: string): boolean {
  const result = database.db.delete(game).where(eq(game.id, gameId)).run()
  return result.changes > 0
}
