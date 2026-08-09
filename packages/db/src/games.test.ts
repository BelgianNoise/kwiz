import { CODE_ALPHABET } from '@kwiz/domain'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { appendAndProject } from './append'
import {
  createQuestion,
  createQuiz,
  createRound,
  setAcceptedAnswers,
  updateQuestion,
} from './authoring'
import type { KwizDatabase } from './client'
import { loadGameContent } from './content'
import {
  deleteGame,
  findDeviceByToken,
  findJoinableGameByCode,
  gameLoss,
  gameWinners,
  generateUnusedCode,
  isStale,
  listGames,
  type GameSummary,
} from './games'
import { createGameFromQuiz } from './instantiate'
import { game, gameTeam, quiz } from './schema'
import { freshTestDatabase, seedGame } from './test-support'

function unwrap<T>(result: { ok: boolean; data?: T }): T {
  if (!result.ok || result.data === undefined) throw new Error('expected success')
  return result.data
}

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

/**
 * Code review — `listGames`, `gameWinners`, `isStale`, `gameLoss` and `deleteGame` had no direct
 * unit test: `deleteGame`'s cascade was only indirectly proven via a schema-level FK test, and
 * `gameWinners`'s tie-handling and `isStale`'s branches were exercised nowhere.
 */

/** A real template quiz + a real game copy, so `sourceQuizId` and `templateRevision` are real. */
function setUpRealGame(
  db: KwizDatabase,
  teams: { name: string; colour: string }[] = [
    { name: 'Quizzly Bears', colour: '#EF4444' },
    { name: 'Norfolk & Chance', colour: '#22D3EE' },
  ],
): { gameId: string; quizId: string; teamIds: string[] } {
  const quizId = unwrap(createQuiz(db, { name: 'Pub Quiz' })).quizId
  const roundId = unwrap(
    createRound(db, quizId, { type: 'QUESTION_SET', title: 'Round' }),
  ).roundId
  const questionId = unwrap(createQuestion(db, roundId)).questionId
  updateQuestion(db, questionId, { prompt: 'Capital of France?' })
  setAcceptedAnswers(db, questionId, ['paris'])

  const created = unwrap(createGameFromQuiz(db, { quizId, code: 'ABCD01', teams }))
  return { gameId: created.gameId, quizId, teamIds: created.teamIds }
}

describe('the dashboard game list (listGames)', () => {
  it('carries the team count and the template revision', () => {
    const { gameId, quizId } = setUpRealGame(database)
    const templateRevision = database.db
      .select({ revision: quiz.revision })
      .from(quiz)
      .where(eq(quiz.id, quizId))
      .get()?.revision

    const row = listGames(database).find((entry) => entry.id === gameId)
    expect(row?.teams).toBe(2)
    expect(row?.templateRevision).toBe(templateRevision)
  })

  it('reports templateRevision as null once the template is deleted, and the game survives', () => {
    const { gameId, quizId } = setUpRealGame(database)
    database.db.delete(quiz).where(eq(quiz.id, quizId)).run()

    const row = listGames(database).find((entry) => entry.id === gameId)
    expect(row).toBeDefined()
    expect(row?.templateRevision).toBeNull()
  })

  it('counts zero teams for a game with none', () => {
    const seed = seedGame(database, { withTeams: false })
    const row = listGames(database).find((entry) => entry.id === seed.gameId)
    expect(row?.teams).toBe(0)
  })
})

describe('gameWinners', () => {
  it('names every team on a tie, not just one', () => {
    const { gameId, teamIds } = setUpRealGame(database)
    appendAndProject(database, gameId, [
      { type: 'GAME_STARTED', payload: {} },
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-1',
          teamId: teamIds[0] ?? '',
          delta: 10,
          announced: false,
        },
      },
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-2',
          teamId: teamIds[1] ?? '',
          delta: 10,
          announced: false,
        },
      },
      { type: 'GAME_FINISHED', payload: {} },
    ])

    const winners = gameWinners(database).get(gameId)
    expect(winners).toHaveLength(2)
    expect(winners).toEqual(expect.arrayContaining(['Quizzly Bears', 'Norfolk & Chance']))
  })

  it('names only the outright winner when there is no tie', () => {
    const { gameId, teamIds } = setUpRealGame(database)
    appendAndProject(database, gameId, [
      { type: 'GAME_STARTED', payload: {} },
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-1',
          teamId: teamIds[0] ?? '',
          delta: 10,
          announced: false,
        },
      },
      { type: 'GAME_FINISHED', payload: {} },
    ])

    expect(gameWinners(database).get(gameId)).toEqual(['Quizzly Bears'])
  })

  it('says nothing about a game that has not finished', () => {
    const { gameId } = setUpRealGame(database)
    appendAndProject(database, gameId, [{ type: 'GAME_STARTED', payload: {} }])
    expect(gameWinners(database).has(gameId)).toBe(false)
  })
})

describe('isStale', () => {
  const summary = (over: Partial<GameSummary>): GameSummary => ({
    id: 'g',
    status: 'SETUP',
    code: 'ABC123',
    quizName: 'Q',
    sourceQuizId: 'q',
    quizRevision: 1,
    createdAt: new Date(),
    finishedAt: null,
    teams: 2,
    templateRevision: 1,
    ...over,
  })

  it('is true for a SETUP game behind its template', () => {
    expect(isStale(summary({ quizRevision: 1, templateRevision: 2 }))).toBe(true)
  })

  it('is false for a SETUP game already current', () => {
    expect(isStale(summary({ quizRevision: 2, templateRevision: 2 }))).toBe(false)
  })

  it('is false once the game is LIVE, even if behind — re-sync is SETUP-only (data model §7.1)', () => {
    expect(
      isStale(summary({ status: 'LIVE', quizRevision: 1, templateRevision: 2 })),
    ).toBe(false)
  })

  it('is false once the template is gone — nothing to re-sync from', () => {
    expect(
      isStale(summary({ quizRevision: 1, templateRevision: null, sourceQuizId: null })),
    ).toBe(false)
  })
})

describe('gameLoss', () => {
  it('counts zero teams and zero answers before anything has happened', () => {
    const { gameId, teamIds } = setUpRealGame(database)
    const loss = gameLoss(database, gameId)
    expect(loss?.quizName).toBe('Pub Quiz')
    expect(loss?.teams).toBe(teamIds.length)
    expect(loss?.answers).toBe(0)
  })

  it('counts a real submitted answer', () => {
    const { gameId, teamIds } = setUpRealGame(database)
    const content = loadGameContent(database, gameId)
    const gameQuestionId = content?.rounds[0]?.questions[0]?.id ?? ''

    appendAndProject(database, gameId, [
      { type: 'GAME_STARTED', payload: {} },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId } },
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId,
          teamId: teamIds[0] ?? '',
          text: 'paris',
          fromDraft: false,
          enteredByMaster: false,
        },
      },
    ])

    expect(gameLoss(database, gameId)?.answers).toBe(1)
  })

  it('is undefined for a game that does not exist', () => {
    expect(gameLoss(database, 'nope')).toBeUndefined()
  })
})

describe('deleteGame', () => {
  it('deletes the game and cascades to its teams', () => {
    const { gameId } = setUpRealGame(database)
    expect(
      database.db.select().from(gameTeam).where(eq(gameTeam.gameId, gameId)).all(),
    ).toHaveLength(2)

    expect(deleteGame(database, gameId)).toBe(true)
    expect(database.db.select().from(game).where(eq(game.id, gameId)).all()).toHaveLength(
      0,
    )
    expect(
      database.db.select().from(gameTeam).where(eq(gameTeam.gameId, gameId)).all(),
    ).toHaveLength(0)
  })

  it('leaves the template quiz untouched', () => {
    const { gameId, quizId } = setUpRealGame(database)
    deleteGame(database, gameId)
    expect(database.db.select().from(quiz).where(eq(quiz.id, quizId)).all()).toHaveLength(
      1,
    )
  })

  it('returns false for a game that does not exist', () => {
    expect(deleteGame(database, 'nope')).toBe(false)
  })
})
