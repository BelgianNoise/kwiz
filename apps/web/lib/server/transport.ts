import {
  SSE_PING_MS,
  SSE_RETRY_HINT_MS,
  type Audience,
  type AudienceView,
  type Notice,
} from '@kwiz/domain'

/**
 * PRD 1 §6.9 constraint 2 — **all server→client communication goes through this interface.** No
 * route handler writes to a stream.
 *
 * That is the constraint that keeps D2 reversible: if a future drawing round needs bidirectional
 * messaging, a WebSocket transport implements `RealtimeTransport` and the three files PRD 1 §6.9
 * names are the only ones that change. Game logic, schema, payload filtering and all four surfaces
 * stay untouched — so the indirection here is load-bearing rather than decorative.
 */

/**
 * protocol §2.2 — **two event names and only two**, plus the keepalive comment and the retry hint.
 *
 * `state` is the whole audience-filtered view and carries `id`. `notice` is a transient moment and
 * carries none, because it is **never replayed** (§3.2) — an id would invite a client to ask for it.
 */
export type Frame =
  | { kind: 'state'; id: string; data: AudienceView }
  | { kind: 'notice'; notice: Notice }
  | { kind: 'ping' }
  | { kind: 'retry'; ms: number }

/**
 * A live stream. **No `lastSeq` here on purpose:** `Last-Event-ID` is consulted exactly once, when
 * the connection is made (protocol §3.2), and only to decide whether the first frame can be skipped.
 * Keeping it on the subscriber would invite a later push to be suppressed as "already current" —
 * which is wrong, because a draft push (D45) changes a view without changing `seq`.
 */
export interface Subscriber {
  gameId: string
  audience: Audience
  /** `PLAYER` only: which team's view to build. Identity, not authorisation (PRD 1 §4). */
  teamId?: string
  send(frame: Frame): void
  close(): void
}

export interface RealtimeTransport {
  /** Returns the unsubscribe, which is also what a closed stream calls (§3.3). */
  subscribe(subscriber: Subscriber): () => void
  /**
   * Fan out to one game's subscribers, letting the caller build **each subscriber's own** frame.
   *
   * The transport deliberately does not know how to build a view: per-audience filtering has exactly
   * one implementation (protocol §6.1) and it lives in `packages/domain`. Returning `null` from
   * `build` skips that subscriber, which is how "nothing changed for you" is expressed (§3.2).
   */
  broadcast(gameId: string, build: (subscriber: Subscriber) => Frame | null): void
  /**
   * Live subscribers on one game, optionally of one audience.
   *
   * The audience filter is PRD 3 §12's *"2 control screens connected"* — a fact about sockets rather
   * than about the game, which is why it is counted here and passed **into** the view filter rather
   * than derived inside it. Nothing in the event log could ever answer it.
   */
  count(gameId: string, audience?: Audience): number
  /** `ABANDONED` or deleted: the final frame has been sent and the stream is over (§3.4). */
  closeAll(gameId: string): void
}

export function createTransport(): RealtimeTransport {
  // Keyed by game, because a broadcast is always to one game's subscribers and never to "everyone":
  // multiple games are live at once (D21) and nothing may cross between them.
  const byGame = new Map<string, Set<Subscriber>>()

  return {
    subscribe(subscriber) {
      const existing = byGame.get(subscriber.gameId) ?? new Set<Subscriber>()
      existing.add(subscriber)
      byGame.set(subscriber.gameId, existing)

      return () => {
        const subscribers = byGame.get(subscriber.gameId)
        if (!subscribers) return
        subscribers.delete(subscriber)
        if (subscribers.size === 0) byGame.delete(subscriber.gameId)
      }
    },

    broadcast(gameId, build) {
      for (const subscriber of byGame.get(gameId) ?? []) {
        const frame = build(subscriber)
        if (frame) subscriber.send(frame)
      }
    },

    count(gameId, audience) {
      const subscribers = byGame.get(gameId)
      if (!subscribers) return 0
      if (!audience) return subscribers.size
      let total = 0
      for (const subscriber of subscribers) {
        if (subscriber.audience === audience) total += 1
      }
      return total
    },

    closeAll(gameId) {
      for (const subscriber of byGame.get(gameId) ?? []) subscriber.close()
      byGame.delete(gameId)
    },
  }
}

// ─── SSE wire format ───

/**
 * The SSE `id`, **qualified by game**.
 *
 * protocol §3.2 requires that a `Last-Event-ID` from a different game be *treated as unknown, never
 * compared numerically* — `seq` is per-game (PRD 1 §6.5), so two games' ids sit in the same range
 * and would silently match. A bare `id: 42` makes that rule unenforceable: nothing in the value says
 * which game produced it. Qualifying it makes the guarantee structural, and costs nothing, because
 * `EventSource` echoes the id back without a client ever reading it.
 */
export function frameId(gameId: string, seq: number): string {
  return `${gameId}:${seq}`
}

/** `null` for absent, malformed, or belonging to another game — all three are "unknown". */
export function parseLastEventId(gameId: string, header: string | null): number | null {
  if (!header) return null
  const separator = header.lastIndexOf(':')
  if (separator <= 0) return null
  if (header.slice(0, separator) !== gameId) return null
  const raw = header.slice(separator + 1)
  // `Number('')` is 0, which would read an id of `game-1:` as sequence zero rather than as garbage.
  if (!/^\d+$/.test(raw)) return null
  const seq = Number(raw)
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null
}

/**
 * One frame as SSE text. Every `data:` line is a single line of JSON — a raw newline inside a `data:`
 * field would be read as the end of the event, and `JSON.stringify` never emits one.
 */
export function encodeFrame(frame: Frame): string {
  switch (frame.kind) {
    case 'state':
      return `id: ${frame.id}\nevent: state\ndata: ${JSON.stringify(frame.data)}\n\n`
    case 'notice':
      return `event: notice\ndata: ${JSON.stringify(frame.notice)}\n\n`
    case 'retry':
      return `retry: ${frame.ms}\n\n`
    case 'ping':
      // A comment: it keeps intermediaries from timing out an idle stream and lets the server notice
      // a dead socket, without being an event any client has to handle.
      return ': ping\n\n'
    default: {
      // protocol §2.2 has two event names and only two. A third would be a spec change, and this is
      // where it fails to compile rather than going out as something no client parses.
      const unhandled: never = frame
      throw new Error(`unknown frame ${JSON.stringify(unhandled)}`)
    }
  }
}

/** protocol §2.2's response headers. */
export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Required: nginx and friends buffer an event stream without it, and the symptom is a screen that
  // updates in bursts minutes late.
  'X-Accel-Buffering': 'no',
}

export { SSE_PING_MS, SSE_RETRY_HINT_MS }
