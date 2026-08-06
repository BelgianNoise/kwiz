import { z } from 'zod'

import { gameEventPayloadSchemas, isGameEventType, type GameEvent } from './payload'

/**
 * Distinct from a generic `Error` so the boot path and the replay path can report differently:
 * a bad payload on **append** is a bug in code we are running now, while a bad payload on
 * **replay** is a durable row an older build wrote, and the operator needs to know which.
 */
export class EventPayloadError extends Error {
  override readonly name = 'EventPayloadError'
}

function describe(error: unknown): string {
  // `instanceof` rather than a shape assertion: zod owns this type, so let it prove it.
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Validates a payload against the schema for its type. Used **on append**, before a row
 * becomes permanent in an append-only table.
 */
export function parseGameEvent(type: string, payload: unknown): GameEvent {
  if (!isGameEventType(type)) {
    throw new EventPayloadError(`Unknown event type "${type}" (protocol §4)`)
  }

  const result = gameEventPayloadSchemas[type].safeParse(payload)
  if (!result.success) {
    throw new EventPayloadError(`Invalid ${type} payload — ${describe(result.error)}`)
  }

  // The map lookup loses the correlation between `type` and its variant: `result.data` is typed as
  // the union of *all* payloads, so TypeScript cannot see this pair is one of its members. It is —
  // `type` indexed the very schema that produced `data`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { type, payload: result.data } as GameEvent
}

/**
 * Validates a payload read back from disk. **This is the one conventions §10.1 calls out as
 * easy to skip and the one that matters**: the event log outlives every deployment, so a
 * schema change that makes an old payload unparseable must fail loudly here rather than
 * corrupt a projection quietly.
 *
 * The error names the game and sequence number, because that is what an operator needs to
 * find the offending row.
 */
export function parseStoredEvent(row: {
  gameId: string
  seq: number
  type: string
  payload: unknown
}): GameEvent {
  try {
    return parseGameEvent(row.type, row.payload)
  } catch (error) {
    throw new EventPayloadError(
      `game_event ${row.gameId} seq ${row.seq} failed to parse on replay — ${describe(error)}`,
    )
  }
}
