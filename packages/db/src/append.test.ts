import { EventPayloadError, type GameEvent } from '@kwiz/domain'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { appendAndProject, readLog } from './append'
import type { KwizDatabase } from './client'
import {
  game,
  gameAnswer,
  gameDevice,
  gameEvent,
  gameScoreAdjustment,
  gameTeam,
} from './schema'
import { freshTestDatabase, seedGame, type SeededGame } from './test-support'

/**
 * Deliberately malformed events, for the paths that must reject them. Typed as `GameEvent` through
 * a function boundary rather than an inline assertion — the invalidity is the fixture's purpose, so
 * it should be stated once, here, and not look like a mistake at each call site.
 */
const malformed = (type: string, payload: unknown): GameEvent =>
  // The invalidity IS the fixture: these events exist to be rejected.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  ({ type, payload }) as unknown as GameEvent

let database: KwizDatabase
let seed: SeededGame

beforeEach(() => {
  database = freshTestDatabase()
  seed = seedGame(database, { points: 10 })
})

const scoreOf = (teamId: string): number =>
  database.db.select().from(gameTeam).where(eq(gameTeam.id, teamId)).get()?.score ?? -1

const answerOf = (teamId: string) =>
  database.db.select().from(gameAnswer).where(eq(gameAnswer.teamId, teamId)).get()

const submit = (teamId: string, text: string): GameEvent => ({
  type: 'ANSWER_SUBMITTED',
  payload: {
    gameQuestionId: seed.questionId,
    teamId,
    text,
    fromDraft: false,
    enteredByMaster: false,
  },
})

describe('appendAndProject — sequencing (data model §6.4.1)', () => {
  it('numbers events from 1, per game', () => {
    const { seqs, seq } = appendAndProject(database, seed.gameId, [
      { type: 'GAME_STARTED', payload: {} },
      { type: 'ROUND_OPENED', payload: { gameRoundId: seed.roundId } },
    ])
    expect(seqs).toEqual([1, 2])
    expect(seq).toBe(2)
  })

  it('continues from the existing head across calls', () => {
    appendAndProject(database, seed.gameId, [{ type: 'GAME_STARTED', payload: {} }])
    expect(
      appendAndProject(database, seed.gameId, [{ type: 'GAME_FINISHED', payload: {} }])
        .seqs,
    ).toEqual([2])
  })

  /** `seq` is per-game, which is why a `Last-Event-ID` from another game is meaningless. */
  it('keeps sequences independent between two live games', () => {
    const other = seedGame(database)
    appendAndProject(database, seed.gameId, [{ type: 'GAME_STARTED', payload: {} }])
    appendAndProject(database, seed.gameId, [{ type: 'GAME_FINISHED', payload: {} }])

    expect(
      appendAndProject(database, other.gameId, [{ type: 'GAME_STARTED', payload: {} }])
        .seqs,
    ).toEqual([1])
  })

  it('appends nothing and reports the head for an empty batch', () => {
    appendAndProject(database, seed.gameId, [{ type: 'GAME_STARTED', payload: {} }])
    expect(appendAndProject(database, seed.gameId, []).seq).toBe(1)
  })

  /** Property 2 of §6.4.1: the backstop if the synchronous-append assumption ever breaks. */
  it('rejects a duplicate (gameId, seq) at the database level', () => {
    appendAndProject(database, seed.gameId, [{ type: 'GAME_STARTED', payload: {} }])

    expect(() =>
      database.db
        .insert(gameEvent)
        .values({ gameId: seed.gameId, seq: 1, type: 'GAME_FINISHED', payload: {} })
        .run(),
    ).toThrow(/UNIQUE/i)
  })
})

describe('appendAndProject — atomicity (property 3)', () => {
  /**
   * The failure this design exists to prevent: an event committing without its projection, or
   * the other way round. A bad payload mid-batch must take the whole batch with it.
   */
  it('rolls the event back when a later event in the batch is invalid', () => {
    expect(() =>
      appendAndProject(database, seed.gameId, [
        { type: 'GAME_STARTED', payload: {} },
        // teamId is not optional, so this fails validation *inside* the transaction.
        malformed('TEAM_UPDATED', {}),
      ]),
    ).toThrow(EventPayloadError)

    expect(database.db.select().from(gameEvent).all()).toEqual([])
  })

  it('rolls the projection back too, leaving no half-applied state', () => {
    expect(() =>
      appendAndProject(database, seed.gameId, [
        {
          type: 'SCORE_ADJUSTED',
          payload: {
            adjustmentId: 'adj-a5',
            teamId: seed.teamA,
            delta: 5,
            announced: true,
          },
        },
        {
          type: 'KEYWORD_MARKED',
          payload: { gameKeywordId: 'does-not-exist', teamId: seed.teamA },
        },
      ]),
    ).toThrow()

    expect(database.db.select().from(gameScoreAdjustment).all()).toEqual([])
    expect(scoreOf(seed.teamA)).toBe(0)
  })

  it('validates on append, so a malformed payload never reaches disk', () => {
    expect(() =>
      appendAndProject(database, seed.gameId, [
        {
          type: 'SCORE_ADJUSTED',
          // Points are integers only (D24), so a fractional delta must be rejected.
          payload: {
            adjustmentId: 'adj-frac',
            teamId: seed.teamA,
            delta: 1.5,
            announced: true,
          },
        },
      ]),
    ).toThrow(EventPayloadError)
    expect(database.db.select().from(gameEvent).all()).toEqual([])
  })

  it('rejects an unknown event type', () => {
    expect(() =>
      appendAndProject(database, seed.gameId, [malformed('NOT_AN_EVENT', {})]),
    ).toThrow(/Unknown event type/)
  })
})

describe('appendAndProject — projections', () => {
  it('projects a submission as PENDING with no points (§6.5)', () => {
    appendAndProject(database, seed.gameId, [submit(seed.teamA, 'paris')])

    const answer = answerOf(seed.teamA)
    expect(answer?.text).toBe('paris')
    expect(answer?.verdict).toBe('PENDING')
    expect(answer?.pointsAwarded).toBe(0)
    expect(scoreOf(seed.teamA)).toBe(0)
  })

  it('awards the question points on acceptance and nothing on denial (I8)', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'paris'),
      submit(seed.teamB, 'lyon'),
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: seed.questionId, teamId: seed.teamA, accepted: true },
      },
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: seed.questionId, teamId: seed.teamB, accepted: false },
      },
    ])

    expect(scoreOf(seed.teamA)).toBe(10)
    expect(scoreOf(seed.teamB)).toBe(0)
    expect(answerOf(seed.teamB)?.verdict).toBe('DENIED')
  })

  /** A repeated `ANSWER_VALIDATED` supersedes the earlier one — there is no revalidate event. */
  it('lets a repeated validation reverse an earlier verdict', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'paris'),
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: seed.questionId, teamId: seed.teamA, accepted: true },
      },
    ])
    expect(scoreOf(seed.teamA)).toBe(10)

    appendAndProject(database, seed.gameId, [
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: seed.questionId, teamId: seed.teamA, accepted: false },
      },
    ])
    expect(scoreOf(seed.teamA)).toBe(0)
    // Both decisions survive in the log, which is the point of appending over updating.
    expect(
      readLog(database, seed.gameId).filter((e) => e.event.type === 'ANSWER_VALIDATED'),
    ).toHaveLength(2)
  })

  /** I8 / D46: a question skipped from OPEN may already hold answers carrying points. */
  it('strips points from every answer when a question is skipped, keeping verdicts', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'paris'),
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: seed.questionId, teamId: seed.teamA, accepted: true },
      },
    ])
    expect(scoreOf(seed.teamA)).toBe(10)

    appendAndProject(database, seed.gameId, [
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: seed.questionId } },
    ])

    expect(scoreOf(seed.teamA)).toBe(0)
    expect(answerOf(seed.teamA)?.pointsAwarded).toBe(0)
    expect(answerOf(seed.teamA)?.verdict).toBe('ACCEPTED')
  })

  it('keeps adjustments as a separate line and reconciles the total (I9)', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'paris'),
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: seed.questionId, teamId: seed.teamA, accepted: true },
      },
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-h',
          teamId: seed.teamA,
          delta: -3,
          reason: 'heckling',
          announced: true,
        },
      },
    ])
    expect(scoreOf(seed.teamA)).toBe(7)
  })

  it('excludes a revoked adjustment without deleting it (D41)', () => {
    appendAndProject(database, seed.gameId, [
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-a5',
          teamId: seed.teamA,
          delta: 5,
          announced: true,
        },
      },
    ])
    const adjustment = database.db.select().from(gameScoreAdjustment).get()
    expect(scoreOf(seed.teamA)).toBe(5)

    appendAndProject(database, seed.gameId, [
      {
        type: 'SCORE_ADJUSTMENT_REVOKED',
        payload: { adjustmentId: adjustment?.id ?? '' },
      },
    ])

    expect(scoreOf(seed.teamA)).toBe(0)
    const revoked = database.db.select().from(gameScoreAdjustment).get()
    expect(revoked?.revokedAt).toBeInstanceOf(Date)
    expect(revoked?.delta).toBe(5)
  })

  it('treats re-revoking as a no-op rather than moving the timestamp', () => {
    appendAndProject(database, seed.gameId, [
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-a5',
          teamId: seed.teamA,
          delta: 5,
          announced: true,
        },
      },
    ])
    const id = database.db.select().from(gameScoreAdjustment).get()?.id ?? ''

    appendAndProject(database, seed.gameId, [
      { type: 'SCORE_ADJUSTMENT_REVOKED', payload: { adjustmentId: id } },
    ])
    const first = database.db.select().from(gameScoreAdjustment).get()?.revokedAt

    appendAndProject(database, seed.gameId, [
      { type: 'SCORE_ADJUSTMENT_REVOKED', payload: { adjustmentId: id } },
    ])
    expect(database.db.select().from(gameScoreAdjustment).get()?.revokedAt).toEqual(first)
  })

  /** `game.status` is projected so the dashboard lists games without replaying them (§6.1). */
  it('projects game status and timestamps from the lifecycle events', () => {
    const stateOf = () =>
      database.db.select().from(game).where(eq(game.id, seed.gameId)).get()

    expect(stateOf()?.status).toBe('SETUP')

    appendAndProject(database, seed.gameId, [{ type: 'GAME_STARTED', payload: {} }])
    expect(stateOf()?.status).toBe('LIVE')
    expect(stateOf()?.startedAt).toBeInstanceOf(Date)
    expect(stateOf()?.finishedAt).toBeNull()

    appendAndProject(database, seed.gameId, [{ type: 'GAME_FINISHED', payload: {} }])
    expect(stateOf()?.status).toBe('FINISHED')
    expect(stateOf()?.finishedAt).toBeInstanceOf(Date)
  })

  it('creates the device row from DEVICE_JOINED, token included', () => {
    const deviceId = 'device-1'
    appendAndProject(database, seed.gameId, [
      {
        type: 'DEVICE_JOINED',
        payload: { deviceId, teamId: seed.teamA, deviceToken: 'secret-token' },
      },
    ])

    const device = database.db.select().from(gameDevice).get()
    expect(device?.id).toBe(deviceId)
    expect(device?.teamId).toBe(seed.teamA)
    expect(device?.deviceToken).toBe('secret-token')
  })

  /** D24: `PER_TEAM_SCORE` is clamped to `0…points` even if the payload says otherwise. */
  it('clamps DO per-team scores to the question maximum', () => {
    appendAndProject(database, seed.gameId, [
      {
        type: 'DO_SCORES_SET',
        payload: {
          gameQuestionId: seed.questionId,
          scores: [
            { teamId: seed.teamA, score: 999 },
            { teamId: seed.teamB, score: -5 },
          ],
        },
      },
    ])

    expect(scoreOf(seed.teamA)).toBe(10)
    expect(scoreOf(seed.teamB)).toBe(0)
  })

  it('splits a DO tie payout using integers only', () => {
    appendAndProject(database, seed.gameId, [
      {
        type: 'DO_WINNERS_SET',
        payload: {
          gameQuestionId: seed.questionId,
          teamIds: [seed.teamA, seed.teamB],
          tiePayout: 'SPLIT',
        },
      },
    ])
    expect(scoreOf(seed.teamA)).toBe(5)
    expect(scoreOf(seed.teamB)).toBe(5)
  })

  it('pays a DO tie in full when configured to (D23)', () => {
    appendAndProject(database, seed.gameId, [
      {
        type: 'DO_WINNERS_SET',
        payload: {
          gameQuestionId: seed.questionId,
          teamIds: [seed.teamA, seed.teamB],
          tiePayout: 'FULL',
        },
      },
    ])
    expect(scoreOf(seed.teamA)).toBe(10)
    expect(scoreOf(seed.teamB)).toBe(10)
  })

  it('resolves everyone to zero on an explicit "nobody got it"', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'x'),
      {
        type: 'DO_WINNERS_SET',
        payload: { gameQuestionId: seed.questionId, teamIds: [], tiePayout: 'FULL' },
      },
    ])
    expect(scoreOf(seed.teamA)).toBe(0)
    expect(answerOf(seed.teamA)?.verdict).toBe('DENIED')
  })
})

describe('readLog — validation on replay (conventions §10.1)', () => {
  it('returns events in sequence order', () => {
    appendAndProject(database, seed.gameId, [
      { type: 'GAME_STARTED', payload: {} },
      { type: 'ROUND_OPENED', payload: { gameRoundId: seed.roundId } },
    ])

    expect(readLog(database, seed.gameId).map((e) => [e.seq, e.event.type])).toEqual([
      [1, 'GAME_STARTED'],
      [2, 'ROUND_OPENED'],
    ])
  })

  it('can resume after a sequence number', () => {
    appendAndProject(database, seed.gameId, [
      { type: 'GAME_STARTED', payload: {} },
      { type: 'GAME_FINISHED', payload: {} },
    ])
    expect(readLog(database, seed.gameId, 1).map((e) => e.seq)).toEqual([2])
  })

  /**
   * The case this validation exists for: a row an older build wrote, now unparseable. It must
   * fail loudly and say *which* row, not silently corrupt a projection.
   */
  it('fails loudly on a stored payload that no longer parses, naming game and seq', () => {
    appendAndProject(database, seed.gameId, [{ type: 'GAME_STARTED', payload: {} }])

    // Simulate an older build's row by writing past the one writer, which is exactly what no
    // production code path may do.
    database.raw
      .prepare('UPDATE game_event SET payload = ? WHERE seq = 1')
      .run(JSON.stringify({ unexpected: true }))

    expect(() => readLog(database, seed.gameId)).toThrow(EventPayloadError)
    expect(() => readLog(database, seed.gameId)).toThrow(/seq 1/)
  })
})
