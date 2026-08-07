import type { PlayerView } from '@kwiz/domain'
import { describe, expect, it } from 'vitest'

import { recordingSubscriber } from './test-runtime'
import { createTransport, encodeFrame, frameId, parseLastEventId } from './transport'

/**
 * protocol §2.2's wire format and §3.2's reconnect rule.
 *
 * Worth testing at this level because the format is unforgiving in ways that are invisible until a
 * real browser refuses to parse it: a missing blank line, a newline inside `data:`, or an `id` on a
 * notice would all look fine in a unit test that asserted on objects instead of text.
 */

/**
 * A real `PlayerView`, because a `state` frame carries one of the three audience views and nothing
 * else — the frame type says so, which is what stops a debug object being pushed by accident.
 */
const view = (over: Partial<PlayerView> = {}): PlayerView => ({
  team: { id: 't1', name: 'Quizzly Bears', colour: '#EF4444', score: 0 },
  otherTeams: [],
  locale: 'en',
  stage: { kind: 'BETWEEN_QUESTIONS' },
  ...over,
})

describe('the SSE wire format', () => {
  it('frames a state event with its id and a terminating blank line', () => {
    const text = encodeFrame({ kind: 'state', id: 'game-1:42', data: view() })
    expect(text.startsWith('id: game-1:42\nevent: state\ndata: {')).toBe(true)
    // The blank line ends the event; without it a browser holds the frame for ever.
    expect(text.endsWith('}\n\n')).toBe(true)
  })

  it('sends a notice with no id, because notices are never replayed', () => {
    const text = encodeFrame({
      kind: 'notice',
      notice: { kind: 'SCORE_ADJUSTED', teamId: 't1', delta: 5, reason: 'best heckle' },
    })
    // An id would invite a client to ask for it again after a disconnect, and a notice is
    // deliberately lossy (§2.3): every fact it refers to is in the next `state` frame anyway.
    expect(text).not.toContain('id:')
    expect(text).toBe(
      'event: notice\ndata: {"kind":"SCORE_ADJUSTED","teamId":"t1","delta":5,"reason":"best heckle"}\n\n',
    )
  })

  it('keeps the payload on one line whatever the content', () => {
    const text = encodeFrame({
      kind: 'state',
      id: 'g:1',
      data: view({
        team: { id: 't1', name: 'line one\nline two', colour: '#EF4444', score: 0 },
      }),
    })
    // A raw newline inside `data:` ends the event early, so the newline must survive only as an
    // escape — which `JSON.stringify` guarantees and string concatenation would not.
    expect(text.split('\n').filter((line) => line.startsWith('data: '))).toHaveLength(1)
    expect(text).toContain('line one\\nline two')
  })

  it('sends the ping as a comment and the retry hint on its own', () => {
    expect(encodeFrame({ kind: 'ping' })).toBe(': ping\n\n')
    expect(encodeFrame({ kind: 'retry', ms: 3_000 })).toBe('retry: 3000\n\n')
  })
})

describe('Last-Event-ID', () => {
  it('is qualified by game, so another game’s id can never match numerically', () => {
    expect(frameId('game-1', 42)).toBe('game-1:42')

    expect(parseLastEventId('game-1', 'game-1:42')).toBe(42)
    // `seq` is per-game (PRD 1 §6.5): both games reach 42, and comparing the numbers would silently
    // convince the server that a screen watching game two is already current on game one.
    expect(parseLastEventId('game-2', 'game-1:42')).toBeNull()
  })

  it('treats absent, malformed and non-numeric ids as unknown', () => {
    expect(parseLastEventId('game-1', null)).toBeNull()
    expect(parseLastEventId('game-1', '42')).toBeNull()
    expect(parseLastEventId('game-1', 'game-1:')).toBeNull()
    expect(parseLastEventId('game-1', 'game-1:abc')).toBeNull()
    expect(parseLastEventId('game-1', ':7')).toBeNull()
  })

  it('handles a game id containing a colon', () => {
    // Not something uuidv7 produces, but the parser splits on the *last* colon so that an id which
    // did would still resolve rather than silently reading as another game's.
    expect(parseLastEventId('a:b', 'a:b:9')).toBe(9)
  })
})

describe('fan-out', () => {
  it('reaches one game’s subscribers and no other game’s', () => {
    const transport = createTransport()
    const screenOne = recordingSubscriber('game-1', 'MAIN_SCREEN')
    const screenTwo = recordingSubscriber('game-2', 'MAIN_SCREEN')
    transport.subscribe(screenOne)
    transport.subscribe(screenTwo)

    transport.broadcast('game-1', () => ({ kind: 'ping' }))

    expect(screenOne.frames).toHaveLength(1)
    // Two games are live at once (D21) and nothing crosses between them.
    expect(screenTwo.frames).toHaveLength(0)
    expect(transport.count('game-1')).toBe(1)
  })

  it('lets the caller skip a subscriber by building nothing for it', () => {
    const transport = createTransport()
    const player = recordingSubscriber('game-1', 'PLAYER', 'team-a')
    const other = recordingSubscriber('game-1', 'PLAYER', 'team-b')
    transport.subscribe(player)
    transport.subscribe(other)

    // How a draft push reaches one team only (D45), without the transport knowing what a team is.
    transport.broadcast('game-1', (subscriber) =>
      subscriber.teamId === 'team-a' ? { kind: 'ping' } : null,
    )

    expect(player.frames).toHaveLength(1)
    expect(other.frames).toHaveLength(0)
  })

  it('stops delivering after an unsubscribe, and closes every stream on demand', () => {
    const transport = createTransport()
    const screen = recordingSubscriber('game-1', 'MAIN_SCREEN')
    const unsubscribe = transport.subscribe(screen)
    const control = recordingSubscriber('game-1', 'MASTER_CONTROL')
    transport.subscribe(control)

    unsubscribe()
    transport.broadcast('game-1', () => ({ kind: 'ping' }))
    expect(screen.frames).toHaveLength(0)
    expect(control.frames).toHaveLength(1)

    // `ABANDONED`, or the game deleted (§3.4).
    transport.closeAll('game-1')
    expect(control.closed).toBe(true)
    expect(transport.count('game-1')).toBe(0)
  })
})
