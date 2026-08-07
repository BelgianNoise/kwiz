import { appendAndProject } from '@kwiz/db'
import { seedGame, type SeededGame } from '@kwiz/db/test-support'
import type { GameEvent } from '@kwiz/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runJoin } from './join'
import { openStream } from './sse'
import { createTestRuntime, type TestRuntime } from './test-runtime'
import { frameId } from './transport'

/**
 * protocol §3's connection lifecycle, at the route.
 *
 * `transport.test.ts` covers the wire format and `live.test.ts` the pushes; this covers the seam
 * between them — the headers, the two frames a fresh connection gets, and the two ways a connection
 * is refused. Those are exactly the parts a unit test of the modules underneath cannot reach, and
 * the parts a browser would only tell you about at a live event.
 */

let runtime: TestRuntime
let seed: SeededGame

/**
 * `openStream` reaches for the process-wide runtime, which in a server is booted once. Pointing that
 * at the test's runtime is the only substitution here — everything else is the real thing.
 */
vi.mock('./runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('./runtime')>()
  return {
    ...original,
    getRuntime: () => Promise.resolve(runtime),
  }
})

beforeEach(() => {
  runtime = createTestRuntime()
  seed = seedGame(runtime.database, { withTeams: false })
  const events: GameEvent[] = [
    {
      type: 'TEAM_ADDED',
      payload: {
        teamId: seed.teamA,
        name: 'Quizzly Bears',
        colour: '#EF4444',
        position: 0,
      },
    },
    { type: 'GAME_STARTED', payload: {} },
  ]
  appendAndProject(runtime.database, seed.gameId, events)
})

/**
 * Reads the frames a fresh connection produces, then cancels.
 *
 * Two chunks, not one: every `controller.enqueue` is its own chunk, so the retry hint and the first
 * view arrive separately. A reader that took only the first would have "proved" that no view is ever
 * sent — which is how a test ends up asserting the opposite of the truth.
 */
async function firstFrames(response: Response, chunks = 2): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('expected a stream')

  const decoder = new TextDecoder()
  let text = ''
  for (let read = 0; read < chunks; read += 1) {
    // The stream stays open by design, so a read that would block ends the loop instead.
    const next = await Promise.race([
      reader.read(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 50)),
    ])
    if (!next || next.done) break
    text += decoder.decode(next.value)
  }
  await reader.cancel()
  return text
}

const request = (headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/api/live/x/screen', { headers })

describe('opening a stream', () => {
  it('answers with the SSE headers protocol §2.2 requires', async () => {
    const response = await openStream(request(), seed.gameId, 'MAIN_SCREEN')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform')
    // Without this, nginx and friends buffer the stream and the room sees the game in bursts.
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    await response.body?.cancel()
  })

  it('sends the retry hint and one full view, in that order', async () => {
    const response = await openStream(request(), seed.gameId, 'MAIN_SCREEN')
    const text = await firstFrames(response)

    expect(text).toContain('retry: 3000')
    expect(text).toContain('event: state')
    // Qualified by game, so the client's next `Last-Event-ID` cannot be misread as another game's.
    const state = runtime.registry.get(seed.gameId)
    expect(text).toContain(`id: ${frameId(seed.gameId, state?.seq ?? 0)}`)
    expect(text).toContain('Quizzly Bears')
  })

  it('skips the view when the client says it is already at this seq', async () => {
    const seq = runtime.registry.get(seed.gameId)?.seq ?? 0
    const response = await openStream(
      request({ 'last-event-id': frameId(seed.gameId, seq) }),
      seed.gameId,
      'MAIN_SCREEN',
    )
    const text = await firstFrames(response)

    // An optimisation, not a correctness mechanism (protocol §1): the retry hint still goes, the
    // redundant view does not.
    expect(text).toContain('retry: 3000')
    expect(text).not.toContain('event: state')
  })

  it('sends the view anyway when the id belongs to another game', async () => {
    const other = seedGame(runtime.database, { withTeams: false })
    const seq = runtime.registry.get(seed.gameId)?.seq ?? 0

    const response = await openStream(
      // The same number, from a different game — which is why the id carries the game (§3.2).
      request({ 'last-event-id': frameId(other.gameId, seq) }),
      seed.gameId,
      'MAIN_SCREEN',
    )
    expect(await firstFrames(response)).toContain('event: state')
  })

  it('registers the subscriber, and unregisters it when the client goes away', async () => {
    const response = await openStream(request(), seed.gameId, 'MAIN_SCREEN')
    // Deliberately not `firstFrames`, which cancels: the point of this test is the count *while*
    // the stream is open, and cancelling first would make it pass by measuring nothing.
    const reader = response.body?.getReader()
    await reader?.read()

    expect(runtime.transport.count(seed.gameId)).toBe(1)
    await reader?.cancel()
    // A closed stream is unregistered and nothing else happens: disconnection is not a game event
    // (§3.3), so a team whose phone died has forfeited nothing.
    expect(runtime.transport.count(seed.gameId)).toBe(0)
    expect(runtime.registry.get(seed.gameId)?.teams.size).toBe(1)
  })
})

describe('refusing a stream', () => {
  it('404s an unknown game, with a body the client can branch on', async () => {
    const response = await openStream(request(), 'no-such-game', 'MAIN_SCREEN')

    expect(response.status).toBe(404)
    // `EventSource` retries a 404 for ever, so the client has to detect it and stop (§3.4) — which
    // it can only do from a typed body.
    expect(await response.json()).toMatchObject({ ok: false, error: 'GAME_NOT_FOUND' })
  })

  it('401s a player with no token, an unknown one, or one from another game', async () => {
    const joined = runJoin(runtime, {
      code: runtime.registry.get(seed.gameId)?.code ?? '',
      teamId: seed.teamA,
      now: 1_000,
    })
    if (!joined.ok || !joined.data) throw new Error('expected a join')

    const noToken: Record<string, string> = {}
    for (const headers of [noToken, { 'x-kwiz-device': 'invented' }]) {
      const refused = await openStream(request(headers), seed.gameId, 'PLAYER')
      expect(refused.status).toBe(401)
      expect(await refused.json()).toMatchObject({ error: 'UNKNOWN_DEVICE' })
    }

    // The token is real, but it belongs to the other game (D21).
    const other = seedGame(runtime.database, { withTeams: false })
    const wrongGame = await openStream(
      request({ 'x-kwiz-device': joined.data.deviceToken }),
      other.gameId,
      'PLAYER',
    )
    expect(wrongGame.status).toBe(401)

    // …and with the right game it opens and carries that team's view.
    const accepted = await openStream(
      request({ 'x-kwiz-device': joined.data.deviceToken }),
      seed.gameId,
      'PLAYER',
    )
    expect(accepted.status).toBe(200)
    expect(await firstFrames(accepted)).toContain('Quizzly Bears')
  })

  it('refuses everything while migrations are pending (D14)', async () => {
    runtime.migration = {
      kind: 'DECLINED',
      pending: [{ tag: '0001', statements: 1, folderMillis: 1 }],
    }

    const response = await openStream(request(), seed.gameId, 'MAIN_SCREEN')
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'DATABASE_MIGRATION_REQUIRED' })
  })
})
