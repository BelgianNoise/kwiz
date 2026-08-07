import { CODE_ALPHABET } from '@kwiz/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { appendAndProject } from './append'
import type { KwizDatabase } from './client'
import { findDeviceByToken, findJoinableGameByCode, generateUnusedCode } from './games'
import { game } from './schema'
import { freshTestDatabase, seedGame } from './test-support'

/**
 * Resolution, and the two places it must **not** be helpful: a code that belongs to a finished game,
 * and a device token that belongs to another game (CLAUDE.md §2.4, D21).
 */

let database: KwizDatabase

beforeEach(() => {
  database = freshTestDatabase()
})

describe('finding a game by its code', () => {
  it('normalises what the player typed (conventions §2)', () => {
    const seed = seedGame(database)
    const code = database.db.select().from(game).all()[0]?.code
    if (!code) throw new Error('expected a code')

    // `TEST01` read off a projector and typed with an l and a space.
    const typed = code.replace('1', 'l')
    expect(findJoinableGameByCode(database, ` ${typed} `)?.id).toBe(seed.gameId)
  })

  it('ignores a code that a finished game is still holding', () => {
    const seed = seedGame(database)
    const code = database.db.select().from(game).all()[0]?.code
    if (!code) throw new Error('expected a code')

    appendAndProject(database, seed.gameId, [{ type: 'GAME_FINISHED', payload: {} }])
    // Codes are unique only among joinable games, so a finished one's code is free to recycle —
    // which also means it must stop resolving.
    expect(findJoinableGameByCode(database, code)).toBeUndefined()
  })
})

describe('finding a device by its token', () => {
  it('will not resolve a token from another live game', () => {
    const one = seedGame(database)
    const two = seedGame(database)

    appendAndProject(database, one.gameId, [
      {
        type: 'DEVICE_JOINED',
        payload: { deviceId: 'dev-1', teamId: one.teamA, deviceToken: 'tok-1' },
      },
    ])

    expect(findDeviceByToken(database, one.gameId, 'tok-1')?.teamId).toBe(one.teamA)
    // Two games are live at once (D21). A token is scoped to its game, or a phone from game one
    // would be handed a team in game two.
    expect(findDeviceByToken(database, two.gameId, 'tok-1')).toBeUndefined()
  })
})

describe('generating a code', () => {
  it('walks past one that a joinable game already holds', () => {
    const seed = seedGame(database)
    const taken = database.db.select().from(game).all()[0]?.code
    if (!taken) throw new Error('expected a code')
    expect(seed.gameId).toBeTruthy()

    // A generator that hands out the taken code once, then a free one. Uniqueness is the partial
    // unique index's job; this is what keeps the insert from having to retry.
    const codes = [taken, 'ZZZZZZ']
    let call = 0
    const bytes = (): Uint8Array => {
      const code = codes[Math.min(call++, codes.length - 1)] ?? 'ZZZZZZ'
      return Uint8Array.from(Array.from(code).map((char) => CODE_ALPHABET.indexOf(char)))
    }

    expect(generateUnusedCode(database, bytes)).toBe('ZZZZZZ')
  })

  it('fails loudly rather than looping when the generator is not random', () => {
    const seed = seedGame(database)
    const taken = database.db.select().from(game).all()[0]?.code
    if (!taken) throw new Error('expected a code')
    expect(seed.gameId).toBeTruthy()

    const always = (): Uint8Array =>
      Uint8Array.from(Array.from(taken).map((char) => CODE_ALPHABET.indexOf(char)))

    expect(() => generateUnusedCode(database, always, 3)).toThrow(/unused game code/)
  })
})
