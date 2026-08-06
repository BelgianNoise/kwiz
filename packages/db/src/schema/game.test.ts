import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { freshTestDatabase } from '../test-support'
import { game } from './game'

const insert = (
  db: ReturnType<typeof freshTestDatabase>['db'],
  code: string,
  id: string,
) => db.insert(game).values({ id, quizName: 'Q', quizRevision: 1, code }).run()

/**
 * data model §6.1 — codes are unique only among **joinable** games (PRD 1 §8.10), so finished
 * codes recycle. A plain unique constraint would exhaust the code space over time, which is why
 * this is a partial index and why it is worth a test: the `WHERE` clause is the whole point and
 * would be silently dropped by a hand-written migration.
 */
describe('game.code uniqueness', () => {
  it('rejects a second joinable game with the same code', () => {
    const { db } = freshTestDatabase()
    insert(db, 'KWIZ01', 'a')
    expect(() => insert(db, 'KWIZ01', 'b')).toThrow(/UNIQUE/i)
  })

  it('frees the code once the holder is no longer joinable', () => {
    const { db } = freshTestDatabase()
    insert(db, 'KWIZ01', 'a')
    db.update(game).set({ status: 'FINISHED' }).where(eq(game.id, 'a')).run()

    expect(() => insert(db, 'KWIZ01', 'b')).not.toThrow()
  })

  it('still blocks a LIVE holder, not just SETUP', () => {
    const { db } = freshTestDatabase()
    insert(db, 'KWIZ01', 'a')
    db.update(game).set({ status: 'LIVE' }).where(eq(game.id, 'a')).run()

    expect(() => insert(db, 'KWIZ01', 'b')).toThrow(/UNIQUE/i)
  })

  it('allows an abandoned game to release its code', () => {
    const { db } = freshTestDatabase()
    insert(db, 'KWIZ01', 'a')
    db.update(game).set({ status: 'ABANDONED' }).where(eq(game.id, 'a')).run()

    expect(() => insert(db, 'KWIZ01', 'b')).not.toThrow()
  })
})

/** CLAUDE.md §4: every FK in the schema is inert without `foreign_keys = ON`. */
describe('foreign keys are enforced', () => {
  it('refuses a game_round pointing at no game', () => {
    const { raw } = freshTestDatabase()
    expect(() =>
      raw
        .prepare(
          `INSERT INTO game_round (id, game_id, position, type, title, default_points, config)
           VALUES ('r', 'nope', 0, 'QUESTION_SET', 'R', 10, '{}')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i)
  })

  it('cascades a game delete through its copy subtree and play tables', () => {
    const database = freshTestDatabase()
    const { db, raw } = database
    insert(db, 'KWIZ02', 'g')
    raw
      .prepare(
        `INSERT INTO game_round (id, game_id, position, type, title, default_points, config)
         VALUES ('r', 'g', 0, 'QUESTION_SET', 'R', 10, '{}')`,
      )
      .run()

    db.delete(game).where(eq(game.id, 'g')).run()

    expect(raw.prepare('SELECT count(*) AS c FROM game_round').get()).toEqual({ c: 0 })
  })
})
