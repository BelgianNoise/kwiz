import type { GameEvent } from '@kwiz/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { appendAndProject, readLog } from './append'
import type { KwizDatabase } from './client'
import { applyProjection } from './projections'
import {
  gameAnswer,
  gameBuzz,
  gameDevice,
  gameKeywordMark,
  gameScoreAdjustment,
  gameTeam,
} from './schema'
import { freshTestDatabase, seedGame, type SeededGame } from './test-support'

/**
 * **I15 is the keystone** (data model §9): every projection table's contents equal a replay of
 * `game_event` for that game. It is what makes the projections safe to treat as derived — and
 * the one test that catches a reducer and a writer drifting apart.
 *
 * Verified by rebuild-and-compare: wipe the projections, replay the log through the *same*
 * `applyProjection`, and require identical rows. That the two paths share one function is
 * exactly why the projections can be dropped and rebuilt at will (§1).
 */

let database: KwizDatabase
let seed: SeededGame

beforeEach(() => {
  database = freshTestDatabase()
  seed = seedGame(database, { points: 10 })
})

/**
 * I15 is equality of **content**, not of surrogate keys: a rebuild regenerates any row id left
 * to a column default. `game_answer` and `game_keyword_mark` ids are nothing's reference, so
 * they are dropped here. Ids that *are* referenced — `game_buzz.id`, `game_score_adjustment.id`
 * — stay in the comparison on purpose, because the log carries them and a rebuild must
 * reproduce them exactly or the events pointing at them orphan.
 */
const withoutId = <T extends { id: string }>(rows: T[]): Omit<T, 'id'>[] =>
  rows.map(({ id: _id, ...rest }) => rest)

/** Everything derived. `game_answer_draft` is absent because it is not a projection (§6.8). */
function snapshot(db: KwizDatabase) {
  return {
    answers: withoutId(db.db.select().from(gameAnswer).orderBy(gameAnswer.teamId).all()),
    buzzes: db.db.select().from(gameBuzz).orderBy(gameBuzz.receivedAt).all(),
    adjustments: db.db
      .select()
      .from(gameScoreAdjustment)
      .orderBy(gameScoreAdjustment.id)
      .all(),
    marks: withoutId(
      db.db.select().from(gameKeywordMark).orderBy(gameKeywordMark.id).all(),
    ),
    teams: db.db.select().from(gameTeam).orderBy(gameTeam.position).all(),
    devices: db.db.select().from(gameDevice).orderBy(gameDevice.id).all(),
  }
}

/**
 * Drops the derived rows and rebuilds them from the log. Deliberately **not** production code:
 * a rebuild belongs with the migration that changes a projection's shape (§11), and inventing an
 * API for it before there is a second caller would be abstraction ahead of need.
 */
function rebuildProjections(db: KwizDatabase, gameId: string) {
  const log = readLog(db, gameId)

  db.db.transaction((tx) => {
    tx.delete(gameAnswer).run()
    tx.delete(gameBuzz).run()
    tx.delete(gameScoreAdjustment).run()
    tx.delete(gameKeywordMark).run()
    tx.delete(gameDevice).run()
    tx.update(gameTeam).set({ score: 0, eliminatedAt: null }).run()

    for (const { event, createdAt } of log) {
      applyProjection(tx, gameId, event, createdAt)
    }
  })
}

/** A game with something in every projection table, so the comparison has teeth. */
function playAGame(): void {
  const events: GameEvent[] = [
    { type: 'GAME_STARTED', payload: {} },
    {
      type: 'DEVICE_JOINED',
      payload: { deviceId: 'dev-a', teamId: seed.teamA, deviceToken: 'tok-a' },
    },
    { type: 'ROUND_OPENED', payload: { gameRoundId: seed.roundId } },
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: seed.questionId } },
    {
      type: 'ANSWER_SUBMITTED',
      payload: {
        gameQuestionId: seed.questionId,
        teamId: seed.teamA,
        text: 'paris',
        fromDraft: false,
        enteredByMaster: false,
      },
    },
    {
      type: 'ANSWER_SUBMITTED',
      payload: {
        gameQuestionId: seed.questionId,
        teamId: seed.teamB,
        text: 'lyon',
        fromDraft: true,
        enteredByMaster: false,
      },
    },
    {
      type: 'BUZZ_RECEIVED',
      payload: {
        buzzId: 'buzz-1',
        gameQuestionId: seed.questionId,
        teamId: seed.teamB,
        receivedAt: 1_700_000_000_000,
        offsetMs: 4210,
      },
    },
    { type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'buzz-1', accepted: false } },
    {
      type: 'ANSWER_VALIDATED',
      payload: { gameQuestionId: seed.questionId, teamId: seed.teamA, accepted: true },
    },
    {
      type: 'ANSWER_VALIDATED',
      payload: { gameQuestionId: seed.questionId, teamId: seed.teamB, accepted: false },
    },
    {
      type: 'SCORE_ADJUSTED',
      payload: {
        adjustmentId: 'adj-p',
        teamId: seed.teamA,
        delta: -2,
        reason: 'phone out',
        announced: true,
      },
    },
    {
      type: 'SCORE_ADJUSTED',
      payload: { adjustmentId: 'adj-b7', teamId: seed.teamB, delta: 7, announced: false },
    },
    { type: 'QUESTION_REVEALED', payload: { gameQuestionId: seed.questionId } },
    { type: 'QUESTION_SCORED', payload: { gameQuestionId: seed.questionId } },
  ]

  appendAndProject(database, seed.gameId, events)
}

describe('projection == replay (I15)', () => {
  it('rebuilds byte-identical projections from the log', () => {
    playAGame()
    const live = snapshot(database)

    rebuildProjections(database, seed.gameId)

    expect(snapshot(database)).toEqual(live)
  })

  it('is a meaningful comparison — every projection table has rows', () => {
    playAGame()
    const state = snapshot(database)

    expect(state.answers.length).toBe(2)
    expect(state.buzzes.length).toBe(1)
    expect(state.adjustments.length).toBe(2)
    expect(state.devices.length).toBe(1)
    expect(state.teams.length).toBe(2)
  })

  it('reconciles scores as sum(answers) + sum(non-revoked adjustments) (I9)', () => {
    playAGame()
    const { teams } = snapshot(database)

    // Team A: 10 accepted − 2 adjustment. Team B: 0 denied + 7 adjustment.
    expect(teams.map((t) => t.score)).toEqual([8, 7])
  })

  it('survives a revocation, which changes a total without deleting a row', () => {
    playAGame()
    const adjustment = database.db
      .select()
      .from(gameScoreAdjustment)
      .all()
      .find((a) => a.delta === 7)

    appendAndProject(database, seed.gameId, [
      {
        type: 'SCORE_ADJUSTMENT_REVOKED',
        payload: { adjustmentId: adjustment?.id ?? '' },
      },
    ])

    const live = snapshot(database)
    expect(live.teams.map((t) => t.score)).toEqual([8, 0])

    rebuildProjections(database, seed.gameId)
    expect(snapshot(database)).toEqual(live)
  })

  /** A skip rewrites points on answers that were already graded, so replay must too (I8). */
  it('survives a skip that strips points already awarded', () => {
    playAGame()
    appendAndProject(database, seed.gameId, [
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: seed.questionId } },
    ])

    const live = snapshot(database)
    expect(live.teams.map((t) => t.score)).toEqual([-2, 7])

    rebuildProjections(database, seed.gameId)
    expect(snapshot(database)).toEqual(live)
  })
})
