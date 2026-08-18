import { reduce, type GameContent, type GameEvent, type LoggedEvent } from '@kwiz/domain'
import { and, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { beforeEach, describe, expect, it } from 'vitest'

import { appendAndProject, readLog } from './append'
import type { KwizDatabase } from './client'
import { loadGameContent } from './content'
import {
  gameAcceptedAnswer,
  gameAnswer,
  gameBuzz,
  gameKeywordMark,
  gameQuestion,
  gameQuestionKeyword,
  gameTeam,
} from './schema'
import { freshTestDatabase, seedGame, type SeededGame } from './test-support'

/**
 * **The two halves of I15 must agree.**
 *
 * `packages/db` writes the projection tables that the review screens and the validation queue read.
 * `packages/domain` folds the same log into the `GameState` that every pushed view is built from.
 * They are two readings of one log, and if they drift the symptom is ugly and confusing: master
 * control calls a team correct and scoring while the review grid still calls the answer pending.
 *
 * CLAUDE.md §6 names this exactly — *"if it fails, a reducer and a writer have drifted"* — so this
 * runs the identical event list through both and compares the answers side by side.
 */

let database: KwizDatabase
let seed: SeededGame

const ACCEPTED = 'paris'
/** A second question, because a buzzer question is scored by a path a `FREE_TEXT` one never takes. */
const BUZZ_Q = 'q-buzzer'

beforeEach(() => {
  database = freshTestDatabase()
  // `withTeams: false`, then `TEAM_ADDED` below — **everything** must come through the log, or the
  // two halves are not reading the same history and comparing them proves nothing.
  seed = seedGame(database, { points: 10, withTeams: false })

  // seedGame leaves the question with no accepted answers, which would make every FREE_TEXT
  // submission PENDING and hide the grading path entirely.
  database.db
    .insert(gameAcceptedAnswer)
    .values({
      gameId: seed.gameId,
      gameQuestionId: seed.questionId,
      position: 0,
      text: ACCEPTED,
    })
    .run()

  database.db
    .insert(gameQuestion)
    .values({
      id: BUZZ_Q,
      gameId: seed.gameId,
      gameRoundId: seed.roundId,
      position: 1,
      prompt: 'Name that tune',
      answerMethod: 'BUZZER',
      points: 20,
      config: {},
    })
    .run()

  appendAndProject(database, seed.gameId, [
    {
      type: 'TEAM_ADDED',
      payload: { teamId: seed.teamA, name: 'A', colour: '#EF4444', position: 0 },
    },
    {
      type: 'TEAM_ADDED',
      payload: { teamId: seed.teamB, name: 'B', colour: '#22D3EE', position: 1 },
    },
    { type: 'GAME_STARTED', payload: {} },
    { type: 'QUESTION_OPENED', payload: { gameQuestionId: seed.questionId } },
  ])
})

/** The same content the game-copy rows describe, as domain expects to receive it. */
function contentFor(seeded: SeededGame): GameContent {
  return {
    gameId: seeded.gameId,
    quizName: 'Test quiz',
    code: 'TEST',
    defaultPlayerLocale: 'en',
    rounds: [
      {
        id: seeded.roundId,
        position: 0,
        type: 'QUESTION_SET',
        title: 'Round 1',
        defaultPoints: 10,
        defaultTimerMs: null,
        config: {},
        categories: [],
        questions: [
          {
            id: seeded.questionId,
            roundId: seeded.roundId,
            categoryId: null,
            position: 0,
            prompt: 'Capital of France?',
            answerMethod: 'FREE_TEXT',
            points: 10,
            timerMs: null,
            masterNotes: null,
            config: {},
            acceptedAnswers: [ACCEPTED],
            options: [],
            keywords: [],
            media: [],
          },
          {
            id: BUZZ_Q,
            roundId: seeded.roundId,
            categoryId: null,
            position: 1,
            prompt: 'Name that tune',
            answerMethod: 'BUZZER',
            points: 20,
            timerMs: null,
            masterNotes: null,
            config: {},
            acceptedAnswers: [],
            options: [],
            keywords: [],
            media: [],
          },
        ],
      },
    ],
  }
}

/** What both halves must agree on, per team. */
interface Row {
  teamId: string
  verdict: string
  pointsAwarded: number
  score: number
}

function fromDatabase(questionId = seed.questionId): Row[] {
  const teams = database.db
    .select()
    .from(gameTeam)
    .where(eq(gameTeam.gameId, seed.gameId))
    .orderBy(gameTeam.position)
    .all()

  return teams.map((team) => {
    const answer = database.db
      .select()
      .from(gameAnswer)
      .where(
        and(eq(gameAnswer.teamId, team.id), eq(gameAnswer.gameQuestionId, questionId)),
      )
      .get()
    return {
      teamId: team.id,
      verdict: answer?.verdict ?? 'NONE',
      pointsAwarded: answer?.pointsAwarded ?? 0,
      score: team.score,
    }
  })
}

function fromDomain(questionId = seed.questionId): Row[] {
  // Replayed from the very rows `appendAndProject` wrote, so the two halves see one identical log.
  const log: LoggedEvent[] = readLog(database, seed.gameId).map((entry) => ({
    seq: entry.seq,
    event: entry.event,
    createdAt: entry.createdAt.getTime(),
  }))
  const state = reduce(contentFor(seed), log)

  return [...state.teams.values()]
    .sort((a, b) => a.position - b.position)
    .map((team) => {
      const answer = state.questions.get(questionId)?.answers.get(team.id)
      return {
        teamId: team.id,
        verdict: answer?.verdict ?? 'NONE',
        pointsAwarded: answer?.pointsAwarded ?? 0,
        score: team.score,
      }
    })
}

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

describe('the writer and the reducer agree', () => {
  it('on an auto-correct match', () => {
    appendAndProject(database, seed.gameId, [submit(seed.teamA, '  PARIS ')])

    expect(fromDatabase()).toEqual(fromDomain())
    // …and both actually graded it, rather than agreeing on nothing.
    expect(fromDatabase()[0]).toMatchObject({
      verdict: 'AUTO_CORRECT',
      pointsAwarded: 10,
      score: 10,
    })
  })

  /** D22: a near-miss must land on PENDING in *both* halves, never AUTO_WRONG. */
  it('on a near-miss going to the master', () => {
    appendAndProject(database, seed.gameId, [submit(seed.teamA, 'Pariss')])

    expect(fromDatabase()).toEqual(fromDomain())
    expect(fromDatabase()[0]).toMatchObject({
      verdict: 'PENDING',
      pointsAwarded: 0,
      score: 0,
    })
  })

  it('on a master validation reversing an auto-verdict', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'paris'),
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: seed.questionId, teamId: seed.teamA, accepted: false },
      },
    ])

    expect(fromDatabase()).toEqual(fromDomain())
    expect(fromDatabase()[0]).toMatchObject({ verdict: 'DENIED', score: 0 })
  })

  it('on a skip stripping points that were already awarded (I8)', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'paris'),
      { type: 'QUESTION_SKIPPED', payload: { gameQuestionId: seed.questionId } },
    ])

    expect(fromDatabase()).toEqual(fromDomain())
    // The verdict is kept for the record; only the points go.
    expect(fromDatabase()[0]).toMatchObject({
      verdict: 'AUTO_CORRECT',
      pointsAwarded: 0,
      score: 0,
    })
  })

  it('on adjustments and their revocation (I9, D41)', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'paris'),
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-1',
          teamId: seed.teamA,
          delta: -4,
          announced: true,
        },
      },
    ])
    expect(fromDatabase()).toEqual(fromDomain())
    expect(fromDatabase()[0]?.score).toBe(6)

    appendAndProject(database, seed.gameId, [
      { type: 'SCORE_ADJUSTMENT_REVOKED', payload: { adjustmentId: 'adj-1' } },
    ])
    expect(fromDatabase()).toEqual(fromDomain())
    expect(fromDatabase()[0]?.score).toBe(10)
  })

  it('on two teams graded differently on the same question', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'PARIS'),
      submit(seed.teamB, 'lyon'),
    ])

    expect(fromDatabase()).toEqual(fromDomain())
    const rows = fromDatabase()
    expect(rows.map((row) => row.verdict)).toEqual(['AUTO_CORRECT', 'PENDING'])
  })

  /**
   * The buzzer path, which is scored by nothing a `FREE_TEXT` question ever touches: PRD 1 §8.4 and
   * D35 credit the accepted team, and there is no `ANSWER_SUBMITTED` to validate because nothing was
   * typed. Both halves have to do it on `BUZZ_ADJUDICATED` or a whole answer method scores zero.
   */
  it('on an accepted buzz crediting the team, and a denied one crediting nobody', () => {
    appendAndProject(database, seed.gameId, [
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: BUZZ_Q } },
      {
        type: 'BUZZ_RECEIVED',
        payload: {
          buzzId: 'bz-1',
          gameQuestionId: BUZZ_Q,
          teamId: seed.teamA,
          receivedAt: 1_000,
          offsetMs: 900,
        },
      },
      { type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'bz-1', accepted: false } },
      {
        type: 'BUZZ_RECEIVED',
        payload: {
          buzzId: 'bz-2',
          gameQuestionId: BUZZ_Q,
          teamId: seed.teamB,
          receivedAt: 2_000,
          offsetMs: 1_900,
        },
      },
      { type: 'BUZZ_ADJUDICATED', payload: { buzzId: 'bz-2', accepted: true } },
    ])

    expect(fromDatabase(BUZZ_Q)).toEqual(fromDomain(BUZZ_Q))
    expect(fromDatabase(BUZZ_Q)).toEqual([
      { teamId: seed.teamA, verdict: 'DENIED', pointsAwarded: 0, score: 0 },
      { teamId: seed.teamB, verdict: 'ACCEPTED', pointsAwarded: 20, score: 20 },
    ])
  })

  /**
   * I10 allows one `AWAITING` buzz per question, and a buzz arriving during adjudication is
   * `NOT_FIRST`. No payload field carries that, so both halves have to derive it the same way — the
   * projection wrote `AWAITING` unconditionally until this test existed.
   */
  it('on which of two simultaneous buzzes was first', () => {
    appendAndProject(database, seed.gameId, [
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: BUZZ_Q } },
      {
        type: 'BUZZ_RECEIVED',
        payload: {
          buzzId: 'bz-1',
          gameQuestionId: BUZZ_Q,
          teamId: seed.teamA,
          receivedAt: 4_210,
          offsetMs: 4_210,
        },
      },
      {
        type: 'BUZZ_RECEIVED',
        payload: {
          buzzId: 'bz-2',
          gameQuestionId: BUZZ_Q,
          teamId: seed.teamB,
          receivedAt: 4_280,
          offsetMs: 4_280,
        },
      },
    ])

    const rows = database.db
      .select({ id: gameBuzz.id, outcome: gameBuzz.outcome })
      .from(gameBuzz)
      .where(eq(gameBuzz.gameQuestionId, BUZZ_Q))
      .orderBy(gameBuzz.receivedAt)
      .all()
    expect(rows).toEqual([
      { id: 'bz-1', outcome: 'AWAITING' },
      { id: 'bz-2', outcome: 'NOT_FIRST' },
    ])

    const log: LoggedEvent[] = readLog(database, seed.gameId).map((entry) => ({
      seq: entry.seq,
      event: entry.event,
      createdAt: entry.createdAt.getTime(),
    }))
    const state = reduce(contentFor(seed), log)
    expect(state.questions.get(BUZZ_Q)?.buzzes.map((buzz) => buzz.outcome)).toEqual(
      rows.map((row) => row.outcome),
    )
  })

  /** D47 — the one legitimate overwrite. Both halves must re-grade, not keep the old verdict. */
  it('on the master re-answering for a team', () => {
    appendAndProject(database, seed.gameId, [submit(seed.teamA, 'lyon')])
    expect(fromDatabase()[0]?.verdict).toBe('PENDING')

    appendAndProject(database, seed.gameId, [
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: seed.questionId,
          teamId: seed.teamA,
          text: 'paris',
          fromDraft: false,
          enteredByMaster: true,
        },
      },
    ])

    expect(fromDatabase()).toEqual(fromDomain())
    expect(fromDatabase()[0]).toMatchObject({ verdict: 'AUTO_CORRECT', score: 10 })
  })
})

/**
 * The finale's keyword marks, which are the one projection with a **unique index that a revoked row
 * keeps holding** — so "insert a new mark" and "the reducer overwrites its map entry" are not the
 * same operation, and the difference only shows up after a revoke.
 *
 * This is PRD 3 §10.4's `Shift`+`n` used the way it is meant to be: un-mark, then credit the right
 * team. It threw `UNIQUE constraint failed` mid-finale until slice 8 — a state the log could express
 * and the projection could not, which is exactly what I15 forbids.
 */
describe('keyword marks stay in step with the reducer', () => {
  let keywordId: string

  beforeEach(() => {
    keywordId = uuidv7()
    database.db
      .insert(gameQuestionKeyword)
      .values({
        id: keywordId,
        gameId: seed.gameId,
        gameQuestionId: seed.questionId,
        position: 0,
        text: 'i like cows',
        wordLengths: [1, 4, 4],
      })
      .run()
  })

  const marksInDatabase = () =>
    database.db
      .select({
        keyword: gameKeywordMark.gameKeywordId,
        teamId: gameKeywordMark.teamId,
        revoked: gameKeywordMark.revokedAt,
      })
      .from(gameKeywordMark)
      .all()
      .map((row) => ({ ...row, revoked: row.revoked !== null }))

  const marksInDomain = () => {
    const log = readLog(database, seed.gameId).map((entry): LoggedEvent => ({
      seq: entry.seq,
      event: entry.event,
      createdAt: entry.createdAt.getTime(),
    }))
    /*
     * The **real** content loader here, not `contentFor`'s hand-written tree: the keyword only
     * exists in the database, and a fixture that omitted it would let the reducer report no marks
     * while the projection held three — a comparison that passes by agreeing about nothing.
     */
    const content = loadGameContent(database, seed.gameId)
    if (!content) throw new Error('expected game content')
    return [...reduce(content, log).keywordMarks.values()].map((mark) => ({
      keyword: mark.gameKeywordId,
      teamId: mark.teamId,
      revoked: mark.revokedAt !== null,
    }))
  }

  it('re-marks a revoked keyword to another team rather than failing', () => {
    appendAndProject(database, seed.gameId, [
      {
        type: 'KEYWORD_MARKED',
        payload: { gameKeywordId: keywordId, teamId: seed.teamA },
      },
      { type: 'KEYWORD_UNMARKED', payload: { gameKeywordId: keywordId } },
      {
        type: 'KEYWORD_MARKED',
        payload: { gameKeywordId: keywordId, teamId: seed.teamB },
      },
    ])

    // Alive again, and credited to the team the master actually meant.
    expect(marksInDatabase()).toEqual([
      { keyword: keywordId, teamId: seed.teamB, revoked: false },
    ])
    expect(marksInDatabase()).toEqual(marksInDomain())
  })

  it('reveals over a revoked mark rather than failing', () => {
    appendAndProject(database, seed.gameId, [
      {
        type: 'KEYWORD_MARKED',
        payload: { gameKeywordId: keywordId, teamId: seed.teamA },
      },
      { type: 'KEYWORD_UNMARKED', payload: { gameKeywordId: keywordId } },
      { type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: seed.questionId } },
    ])

    // Nobody found it (I21) — not "still credited to A", and not a crash.
    expect(marksInDatabase()).toEqual([
      { keyword: keywordId, teamId: null, revoked: false },
    ])
    expect(marksInDatabase()).toEqual(marksInDomain())
  })

  it('leaves an ordinary mark alone when the question is revealed', () => {
    appendAndProject(database, seed.gameId, [
      {
        type: 'KEYWORD_MARKED',
        payload: { gameKeywordId: keywordId, teamId: seed.teamA },
      },
      { type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: seed.questionId } },
    ])

    expect(marksInDatabase()).toEqual([
      { keyword: keywordId, teamId: seed.teamA, revoked: false },
    ])
    expect(marksInDatabase()).toEqual(marksInDomain())
  })
})

/**
 * `AnswerState.corrections` (PRD 2 §13.1) is the one piece of answer state with **no projection
 * column** — it is folded in memory on every replay and never written down.
 *
 * So I15 does not apply to it and it cannot join the `Row` comparison above: there is no database
 * side to compare against, and a domain-to-domain assertion would prove nothing. What *does* apply
 * is D4 — a replay reproduces the state exactly — and that is worth pinning, because a derived
 * counter is precisely the kind of thing that quietly resets when a server restarts and nobody
 * notices until a master reopens a review the morning after.
 */
describe('the correction count survives a replay (D4)', () => {
  it('rebuilds from the log rather than from anything stored', () => {
    appendAndProject(database, seed.gameId, [
      submit(seed.teamA, 'paris'), // AUTO_CORRECT
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: seed.questionId, teamId: seed.teamA, accepted: false },
      },
    ])

    const rebuilt = reduce(
      contentFor(seed),
      readLog(database, seed.gameId).map((entry): LoggedEvent => ({
        seq: entry.seq,
        event: entry.event,
        createdAt: entry.createdAt.getTime(),
      })),
    )

    // Overturning an auto-accept is a correction; the count is derived, so a fresh fold must find it.
    expect(
      rebuilt.questions.get(seed.questionId)?.answers.get(seed.teamA)?.corrections,
    ).toBe(1)
    // And nothing was persisted for it — the projection has no column to drift from.
    expect(
      Object.keys(database.db.select().from(gameAnswer).all()[0] ?? {}),
    ).not.toContain('corrections')
  })
})

/**
 * `TEAM_ELIMINATED` writes `gameTeam.eliminatedAt`, and the **order** of those instants is what
 * produces the finale's final ranking (D51) — so a drift here does not merely misreport a time, it
 * reorders the podium. It had no parity test; the keyword marks above got one when their bug
 * surfaced, and this is the same shape of small write in the same round.
 */
describe('elimination instants stay in step with the reducer', () => {
  it('writes the computed instant, not the moment the event was appended', () => {
    // `at` is the instant the clock hit zero, which is deliberately *not* `createdAt` (payload doc).
    appendAndProject(database, seed.gameId, [
      { type: 'TEAM_ELIMINATED', payload: { teamId: seed.teamA, at: 1_234_000 } },
    ])

    const row = database.db
      .select({ id: gameTeam.id, eliminatedAt: gameTeam.eliminatedAt })
      .from(gameTeam)
      .where(eq(gameTeam.id, seed.teamA))
      .get()

    const rebuilt = reduce(
      contentFor(seed),
      readLog(database, seed.gameId).map((entry): LoggedEvent => ({
        seq: entry.seq,
        event: entry.event,
        createdAt: entry.createdAt.getTime(),
      })),
    )

    expect(row?.eliminatedAt?.getTime()).toBe(1_234_000)
    expect(row?.eliminatedAt?.getTime()).toBe(
      rebuilt.teams.get(seed.teamA)?.eliminatedAt ?? null,
    )
    // The team that stayed in has none, in both halves.
    expect(rebuilt.teams.get(seed.teamB)?.eliminatedAt).toBeNull()
  })
})
