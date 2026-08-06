import { join } from 'node:path'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { v7 as uuidv7 } from 'uuid'

import { openDatabase, type KwizDatabase } from './client'
import { game, gameQuestion, gameRound, gameTeam } from './schema'

/**
 * Test scaffolding, not part of the package's API — deliberately absent from `./index.ts`.
 *
 * An in-memory database with the real migrations applied. Real, not a mock: `better-sqlite3`
 * being synchronous means a database costs a function call, so there is never a reason to fake
 * one (CLAUDE.md §6). Every FK and constraint under test is the one that ships.
 */
/**
 * Absolute, derived from this file's location. A relative path resolves against the *process*
 * cwd — the workspace root when vitest runs from there — not the package.
 */
export const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', 'migrations')

export function freshTestDatabase(): KwizDatabase {
  const database = openDatabase(':memory:')
  migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER })
  return database
}

export interface SeededGame {
  gameId: string
  roundId: string
  questionId: string
  teamA: string
  teamB: string
}

/**
 * The minimum tree an append test needs. Parents first, because `foreign_keys = ON` means the
 * order actually matters — which is itself worth exercising.
 */
/**
 * Codes are unique among joinable games (data model §6.1), so a fixture that hardcodes one
 * cannot seed two `SETUP` games — the partial unique index rejects the second, correctly.
 */
let codeCounter = 0
const nextCode = (): string => `TEST${String(++codeCounter).padStart(2, '0')}`

export function seedGame(
  database: KwizDatabase,
  {
    points = 10,
    /**
     * Set `false` to leave the teams out, so a test can create them through `TEAM_ADDED` instead.
     * Seeding rows directly is fine for most tests, but any test comparing this projection against
     * `@kwiz/domain`'s reducer must drive **everything** through the log, or the two halves are not
     * reading the same history and the comparison is meaningless.
     */
    withTeams = true,
  }: { points?: number; withTeams?: boolean } = {},
): SeededGame {
  const gameId = uuidv7()
  const roundId = uuidv7()
  const questionId = uuidv7()
  const teamA = uuidv7()
  const teamB = uuidv7()

  database.db
    .insert(game)
    .values({ id: gameId, quizName: 'Test quiz', quizRevision: 1, code: nextCode() })
    .run()

  database.db
    .insert(gameRound)
    .values({
      id: roundId,
      gameId,
      position: 0,
      type: 'QUESTION_SET',
      title: 'Round 1',
      config: {},
    })
    .run()

  database.db
    .insert(gameQuestion)
    .values({
      id: questionId,
      gameId,
      gameRoundId: roundId,
      position: 0,
      prompt: 'Capital of France?',
      answerMethod: 'FREE_TEXT',
      points,
      config: {},
    })
    .run()

  if (withTeams) {
    for (const [position, id] of [teamA, teamB].entries()) {
      database.db
        .insert(gameTeam)
        .values({ id, gameId, position, name: `Team ${position + 1}`, colour: '#EF4444' })
        .run()
    }
  }

  return { gameId, roundId, questionId, teamA, teamB }
}
