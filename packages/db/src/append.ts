import { parseGameEvent, parseStoredEvent, type GameEvent } from '@kwiz/domain'
import { and, eq, max } from 'drizzle-orm'

import type { KwizDatabase } from './client'
import { applyProjection } from './projections'
import { gameEvent } from './schema'

/**
 * **The only writer for the play half** (data model §6.4.1, CLAUDE.md §2.2).
 *
 * Appends to `game_event` and updates the projections **in the same transaction**, so an event
 * cannot commit without its projection or the other way round. If you find yourself wanting to
 * `UPDATE game_answer`, the change you want is an event.
 *
 * Three properties this relies on, each a silent bug if broken:
 *
 * 1. **`better-sqlite3` is synchronous**, so `max(seq) + 1` cannot interleave with another
 *    append inside the transaction. That is why the driver's synchronicity is a feature here
 *    and not an inconvenience.
 * 2. **`unique(gameId, seq)`** is the backstop if property 1 is ever violated — a second
 *    process, or a future async driver. The insert fails loudly rather than duplicating a
 *    sequence number.
 * 3. **The projection write is inside the transaction.** An event committing without its
 *    projection, or vice versa, is exactly the drift this design exists to avoid.
 *
 * Broadcast happens **after commit** (PRD 1 §6.4): nothing reaches a client that is not already
 * durable, which is why this returns the sequence numbers rather than pushing anything itself.
 */
export interface AppendResult {
  /** The `seq` assigned to each appended event, in order. */
  seqs: number[]
  /** The game's latest `seq` after the append — the SSE `id` for the resulting view. */
  seq: number
}

export function appendAndProject(
  database: KwizDatabase,
  gameId: string,
  events: GameEvent[],
  now: () => Date = () => new Date(),
): AppendResult {
  if (events.length === 0) {
    return { seqs: [], seq: latestSeq(database, gameId) }
  }

  return database.db.transaction((tx) => {
    const last =
      tx
        .select({ seq: max(gameEvent.seq) })
        .from(gameEvent)
        .where(eq(gameEvent.gameId, gameId))
        .get()?.seq ?? 0

    let seq = last
    const seqs: number[] = []

    for (const event of events) {
      // Validated before it becomes permanent in an append-only table (conventions §10.1).
      // Re-parsing a value the caller already typed is deliberate: this is the boundary the
      // log outlives, and a malformed payload must never reach disk.
      const validated = parseGameEvent(event.type, event.payload)
      const at = now()

      seq += 1
      tx.insert(gameEvent)
        .values({
          gameId,
          seq,
          type: validated.type,
          payload: validated.payload,
          createdAt: at,
        })
        .run()

      applyProjection(tx, gameId, validated, at)
      seqs.push(seq)
    }

    return { seqs, seq }
  })
}

/** The current head. Used for the SSE `id` when nothing was appended. */
export function latestSeq(database: KwizDatabase, gameId: string): number {
  return (
    database.db
      .select({ seq: max(gameEvent.seq) })
      .from(gameEvent)
      .where(eq(gameEvent.gameId, gameId))
      .get()?.seq ?? 0
  )
}

/**
 * Reads a game's log in order, validating every payload on the way out.
 *
 * **This is the validation conventions §10.1 singles out as easy to skip.** The log is the one
 * thing that outlives every deployment, so a payload an older build wrote must fail loudly here
 * rather than quietly corrupt a projection.
 */
export function readLog(
  database: KwizDatabase,
  gameId: string,
  afterSeq = 0,
): { seq: number; event: GameEvent; createdAt: Date }[] {
  const rows = database.db
    .select()
    .from(gameEvent)
    .where(and(eq(gameEvent.gameId, gameId)))
    .orderBy(gameEvent.seq)
    .all()

  return rows
    .filter((row) => row.seq > afterSeq)
    .map((row) => ({
      seq: row.seq,
      createdAt: row.createdAt,
      // `parseStoredEvent`, not `parseGameEvent`: the error names the game and seq, because a
      // replay failure is a durable row someone has to go and find.
      event: parseStoredEvent(row),
    }))
}
