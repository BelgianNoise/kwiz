import { findDeviceByToken, touchDevice } from '@kwiz/db'
import { fail, type Audience } from '@kwiz/domain'

import { getRuntime, isDatabaseUsable } from './runtime'
import { publishState, stateFrame, type CommandContext } from './service'
import {
  encodeFrame,
  parseLastEventId,
  SSE_HEADERS,
  SSE_PING_MS,
  SSE_RETRY_HINT_MS,
  type Frame,
  type Subscriber,
} from './transport'

/**
 * protocol §3 — the connection lifecycle, shared by all three routes.
 *
 * The routes differ only in **which audience they are**, and that is deliberate (§2.1): the filter is
 * selected by the route rather than by an `?audience=` parameter, so the wrong filter cannot be
 * reached by editing a URL and every call site is greppable.
 *
 * This module owns the socket; the framing belongs to `transport.ts` and the views to
 * `packages/domain`. No route handler writes to a stream itself (PRD 1 §6.9 constraint 2).
 */
export async function openStream(
  request: Request,
  gameId: string,
  audience: Audience,
): Promise<Response> {
  const runtime = await getRuntime()
  if (!isDatabaseUsable(runtime)) {
    return Response.json(
      fail('DATABASE_MIGRATION_REQUIRED', 'the database has pending migrations'),
      { status: 503 },
    )
  }

  const state = runtime.registry.get(gameId)
  // `EventSource` retries a 404 forever, so the client has to detect it and stop (§3.4). Answering
  // with the typed body gives it something to branch on.
  if (!state) {
    return Response.json(fail('GAME_NOT_FOUND', `no game ${gameId}`), { status: 404 })
  }

  let teamId: string | undefined
  if (audience === 'PLAYER') {
    const token = request.headers.get('x-kwiz-device')
    const device = token ? findDeviceByToken(runtime.database, gameId, token) : undefined
    // 401-equivalent: the client clears storage and rejoins (§3.1). A token from another game lands
    // here too, which is the point of scoping the lookup.
    if (!device) {
      return Response.json(fail('UNKNOWN_DEVICE', 'this device is not in this game'), {
        status: 401,
      })
    }
    teamId = device.teamId
    touchDevice(runtime.database, device.id, new Date())
  }

  const context: CommandContext = { runtime, gameId, now: Date.now() }
  const lastSeq = parseLastEventId(gameId, request.headers.get('last-event-id'))

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let ping: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true
      const write = (frame: Frame): void => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(encodeFrame(frame)))
        } catch {
          // The client vanished between our check and the write. Not a game event (§3.3).
          open = false
        }
      }

      const subscriber: Subscriber = {
        gameId,
        audience,
        ...(teamId === undefined ? {} : { teamId }),
        send: write,
        close() {
          open = false
          controller.close()
        },
      }

      // A dropped stream reconnects in ~3 s rather than at the browser default (protocol §2.2).
      write({ kind: 'retry', ms: SSE_RETRY_HINT_MS })

      /*
       * The whole of reconnection: **send the current view** (protocol §3.2). Because views are
       * whole and idempotent, `Last-Event-ID` only ever skips a send — and a value from another game
       * parses as unknown rather than as a number to compare, which is what stops two games' `seq`
       * ranges from silently matching (PRD 1 §6.5).
       */
      if (lastSeq === null || lastSeq !== state.seq) {
        write(stateFrame(context, state, subscriber))
      }

      unsubscribe = runtime.transport.subscribe(subscriber)
      ping = setInterval(() => write({ kind: 'ping' }), SSE_PING_MS)
    },

    cancel() {
      // A closed stream is unregistered and **nothing else happens** — disconnection is not a game
      // event (§3.3). A team whose phone died has not forfeited anything.
      if (ping) clearInterval(ping)
      unsubscribe?.()
      runtime.registry.evictIfFinished(gameId, runtime.transport.count(gameId) > 0)
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}

/** Re-exported so a route that only needs to push does not have to know about the service. */
export { publishState }
