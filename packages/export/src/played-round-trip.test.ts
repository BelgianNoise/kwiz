import { createHash } from 'node:crypto'

import {
  appendAndProject,
  collectQuizExport,
  createGameFromQuiz,
  createQuestion,
  createQuiz,
  createRound,
  findJoinableGameByCode,
  game,
  importQuiz,
  listGames,
  loadGameContent,
  quiz as quizTable,
  readLog,
  setAcceptedAnswers,
  setKeywords,
  setOptions,
  updateQuestion,
  type KwizDatabase,
} from '@kwiz/db'
import { freshTestDatabase } from '@kwiz/db/test-support'
import { reduce, toGameReview, type GameEvent, type GameReview } from '@kwiz/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { readExport, writeExport } from './zip'

/**
 * **A whole played evening, exported and imported** (build-order slice 8), and the
 * **author → export → import → play → score** path it names beside it.
 *
 * `round-trip.test.ts` already proves a *minimal* game survives: one question, one answer, one
 * verdict. That is the mechanism. This is the claim a master actually cares about — the night they
 * ran, with the corrections they made, the points they docked and the finale they watched, opening
 * on another machine as the same night.
 *
 * The strongest assertion available is the last one: the two databases' **reviews** are compared
 * whole, with ids normalised away. Nothing in the zip is a projection (protocol §8.2), so an
 * identical review on the far side means the log alone rebuilt every score, verdict, correction
 * count, keyword attribution and finale clock — I15, end to end, on a real game.
 */

let source: KwizDatabase
let target: KwizDatabase

beforeEach(() => {
  source = freshTestDatabase()
  target = freshTestDatabase()
})

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

const bytes = (size: number): Uint8Array => Uint8Array.from({ length: size }, () => 7)

function unwrap<T>(result: { ok: boolean; data?: T }): T {
  if (!result.ok || result.data === undefined) throw new Error('expected success')
  return result.data
}

/** Two scoring rounds and a finale — the shapes a review has to render (PRD 2 §13.1, §13.2). */
function seedFullQuiz(database: KwizDatabase): string {
  const quizId = unwrap(createQuiz(database, { name: 'Pub Quiz #4' })).quizId

  const music = unwrap(
    createRound(database, quizId, { type: 'QUESTION_SET', title: 'Music' }),
  ).roundId

  const free = unwrap(createQuestion(database, music)).questionId
  updateQuestion(database, free, { prompt: 'Who released "Kid A"?' })
  setAcceptedAnswers(database, free, ['radiohead', 'kid a'])

  const choice = unwrap(createQuestion(database, music)).questionId
  updateQuestion(database, choice, {
    prompt: 'Which band recorded "OK Computer"?',
    answerMethod: 'MULTIPLE_CHOICE',
  })
  setOptions(database, choice, [
    { text: 'Blur', isCorrect: false },
    { text: 'Radiohead', isCorrect: true },
  ])

  const finaleRound = unwrap(
    createRound(database, quizId, { type: 'DSMTW_FINALE', title: 'Finale' }),
  ).roundId
  const finaleQuestion = unwrap(createQuestion(database, finaleRound)).questionId
  updateQuestion(database, finaleQuestion, { prompt: 'Describe a cow' })
  setKeywords(database, finaleQuestion, ['i like cows', 'moo', 'grass', 'milk', 'field'])

  return quizId
}

/**
 * The review with every id replaced by something stable across machines.
 *
 * Ids are regenerated on import by design (data model §10) — a copy is a new game, not the same one
 * — so comparing them would fail for the one reason that is *correct*. Names and positions are what
 * a master would recognise, and they are exactly what must survive.
 */
function normalise(review: GameReview): unknown {
  const teamName = new Map(review.teams.map((team) => [team.id, team.name]))

  return {
    quizName: review.quizName,
    status: review.status,
    corrections: review.corrections,
    teams: review.teams.map((team) => ({
      name: team.name,
      colour: team.colour,
      score: team.score,
      rank: team.rank,
    })),
    rounds: review.rounds.map((round) => ({
      title: round.title,
      type: round.type,
      corrections: round.corrections,
      questions: round.questions.map((question) => ({
        prompt: question.prompt,
        state: question.state,
        correctAnswer: question.correctAnswer,
        alsoAccepted: question.alsoAccepted,
        cells: question.cells.map((cell) => ({
          team: teamName.get(cell.teamId),
          answer: cell.answer,
          verdict: cell.verdict,
          points: cell.points,
          corrections: cell.corrections,
        })),
      })),
    })),
    finale: review.finale
      ? {
          wonBy: review.finale.wonByTeamId
            ? teamName.get(review.finale.wonByTeamId)
            : null,
          nonFinalists: review.finale.nonFinalistIds.map((id) => teamName.get(id)),
          questions: review.finale.questions.map((question) => ({
            prompt: question.prompt,
            keywords: question.keywords.map((keyword) => ({
              text: keyword.text,
              by: keyword.teamId === null ? null : teamName.get(keyword.teamId),
              reached: keyword.reached,
            })),
          })),
          finalists: review.finale.finalists.map((finalist) => ({
            team: teamName.get(finalist.teamId),
            startedSeconds: finalist.startedSeconds,
            endedSeconds: finalist.endedSeconds,
            survived: finalist.survived,
          })),
        }
      : null,
    adjustments: review.adjustments.map((adjustment) => ({
      team: teamName.get(adjustment.teamId),
      delta: adjustment.delta,
      reason: adjustment.reason,
      announced: adjustment.announced,
      revoked: adjustment.revokedAt !== null,
    })),
  }
}

/** Rebuilds a game's review from whatever database it lives in, by replaying its log. */
function reviewOf(database: KwizDatabase, gameId: string): GameReview {
  const content = loadGameContent(database, gameId)
  if (!content) throw new Error('expected game content')
  const log = readLog(database, gameId, 0).map((entry) => ({
    seq: entry.seq,
    event: entry.event,
    createdAt: entry.createdAt.getTime(),
  }))
  return toGameReview(reduce(content, log), 2_000_000)
}

describe('a whole played evening survives the round trip', () => {
  it('rebuilds the same review from the log alone', () => {
    const quizId = seedFullQuiz(source)
    const created = unwrap(
      createGameFromQuiz(source, {
        quizId,
        code: 'ABC234',
        defaultPlayerLocale: 'en',
        teams: [
          { name: 'Aardappel', colour: '#EF4444' },
          { name: 'Pintjes', colour: '#22D3EE' },
          { name: 'Frieten', colour: '#A78BFA' },
        ],
      }),
    )

    const [aardappel = '', pintjes = '', frieten = ''] = created.teamIds
    // Through the game's own tree, so every id is the copy's — never the template's (protocol §8.2).
    const content = loadGameContent(source, created.gameId)
    if (!content) throw new Error('expected game content')
    const [music, finaleRound] = content.rounds
    const [free = { id: '' }, choice = { id: '', options: [] }] = music?.questions ?? []
    const finaleQuestion = finaleRound?.questions[0]
    if (!finaleQuestion) throw new Error('expected a finale question')
    const correctOption = choice.options.find((option) => option.isCorrect)
    const keywords = finaleQuestion.keywords

    const evening: GameEvent[] = [
      { type: 'GAME_STARTED', payload: {} },
      { type: 'ROUND_OPENED', payload: { gameRoundId: music?.id ?? '' } },

      // ── a free-text question, judged three ways ──
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: free.id } },
      answered(free.id, aardappel, 'radiohead'),
      // Not a match, so it lands PENDING and the master decides (D22).
      answered(free.id, pintjes, 'Radio Head'),
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: free.id, teamId: pintjes, accepted: true },
      },
      // …and then changes their mind. **This is the correction the review has to remember.**
      {
        type: 'ANSWER_VALIDATED',
        payload: { gameQuestionId: free.id, teamId: pintjes, accepted: false },
      },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: free.id } },
      { type: 'QUESTION_REVEALED', payload: { gameQuestionId: free.id } },
      { type: 'QUESTION_SCORED', payload: { gameQuestionId: free.id } },

      // ── a multiple-choice question, auto-graded both ways ──
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: choice.id } },
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: choice.id,
          teamId: aardappel,
          selectedOptionId: correctOption?.id ?? '',
          fromDraft: true,
          enteredByMaster: false,
        },
      },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: choice.id } },
      { type: 'QUESTION_REVEALED', payload: { gameQuestionId: choice.id } },
      { type: 'QUESTION_SCORED', payload: { gameQuestionId: choice.id } },
      { type: 'ROUND_CLOSED', payload: { gameRoundId: music?.id ?? '' } },

      // ── the two adjustments §13.3 is an audit of: one standing, one revoked ──
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-heckle',
          teamId: frieten,
          delta: 5,
          reason: 'best heckle of the night',
          announced: true,
        },
      },
      {
        type: 'SCORE_ADJUSTED',
        payload: {
          adjustmentId: 'adj-oops',
          teamId: pintjes,
          delta: 50,
          announced: false,
        },
      },
      { type: 'SCORE_ADJUSTMENT_REVOKED', payload: { adjustmentId: 'adj-oops' } },

      // ── the finale ──
      { type: 'ROUND_OPENED', payload: { gameRoundId: finaleRound?.id ?? '' } },
      { type: 'FINALE_CONFIGURED', payload: { secondsPerPoint: 2, penaltySeconds: 20 } },
      { type: 'FINALISTS_SET', payload: { teamIds: [aardappel, frieten] } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: finaleQuestion.id } },
      { type: 'TURN_STARTED', payload: { teamId: aardappel } },
      {
        type: 'KEYWORD_MARKED',
        payload: { gameKeywordId: keywords[0]?.id ?? '', teamId: aardappel },
      },
      { type: 'TURN_ENDED', payload: { teamId: aardappel, reason: 'PASSED' } },
      { type: 'TURN_STARTED', payload: { teamId: frieten } },
      // Marked, then unmarked: D41 has to reverse the record *and* the seconds it charged.
      {
        type: 'KEYWORD_MARKED',
        payload: { gameKeywordId: keywords[1]?.id ?? '', teamId: frieten },
      },
      { type: 'KEYWORD_UNMARKED', payload: { gameKeywordId: keywords[1]?.id ?? '' } },
      { type: 'TURN_ENDED', payload: { teamId: frieten, reason: 'PASSED' } },
      { type: 'KEYWORDS_REVEALED', payload: { gameQuestionId: finaleQuestion.id } },
      { type: 'TEAM_ELIMINATED', payload: { teamId: frieten, at: 1_800_000 } },
      { type: 'FINALE_ENDED', payload: { ranking: [[aardappel], [frieten]] } },
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: finaleQuestion.id } },
      { type: 'ROUND_CLOSED', payload: { gameRoundId: finaleRound?.id ?? '' } },
      { type: 'GAME_FINISHED', payload: {} },
    ]

    appendAndProject(source, created.gameId, evening)

    // Sanity: the evening actually produced the facts the comparison is about, so a round trip of
    // two empty reviews cannot pass this test.
    const before = reviewOf(source, created.gameId)
    expect(before.corrections).toBe(1)
    expect(before.adjustments).toHaveLength(2)
    expect(before.finale?.wonByTeamId).toBe(aardappel)

    const exported = collectQuizExport(source, quizId, { includeGames: true })
    if (!exported) throw new Error('expected an export')

    const zip = writeExport({
      quiz: exported.quiz,
      games: exported.games,
      includesGames: true,
      attachments: [],
      exportedAt: new Date('2026-08-08T12:00:00.000Z'),
    })

    const read = readExport(zip.bytes, sha256)
    if (!read.ok || !read.data) throw new Error(read.ok ? 'no data' : read.message)

    importQuiz(target, {
      quiz: read.data.quiz,
      games: read.data.games,
      mode: 'COPY',
      randomBytes: bytes,
    })

    const imported = target.db.select().from(game).all()[0]
    if (!imported) throw new Error('expected an imported game')

    /*
     * **The whole night, compared whole.** Every number here — scores, ranks, the correction count,
     * which keyword belonged to whom, how many seconds each finalist had left — is a projection that
     * travelled in no file. Matching means the replay rebuilt all of it.
     */
    expect(normalise(reviewOf(target, imported.id))).toEqual(normalise(before))
  })
})

/**
 * Build-order slice 8's last bullet: **author → export → import → play → score.**
 *
 * The round trip above proves a *played* game survives. This proves the imported **template** is
 * playable — that a quiz can be authored on one laptop, carried on a stick, and run on another. The
 * two are different claims, and only this one exercises `createGameFromQuiz` against imported rows.
 */
describe('author → export → import → play → score', () => {
  it('runs and scores a game created from an imported quiz', () => {
    const quizId = seedFullQuiz(source)

    // Exported **without** games: this is a quiz being shared, not a night being archived.
    const exported = collectQuizExport(source, quizId, { includeGames: false })
    if (!exported) throw new Error('expected an export')
    expect(exported.games).toHaveLength(0)

    const zip = writeExport({
      quiz: exported.quiz,
      games: [],
      includesGames: false,
      attachments: [],
      exportedAt: new Date('2026-08-08T12:00:00.000Z'),
    })
    const read = readExport(zip.bytes, sha256)
    if (!read.ok || !read.data) throw new Error(read.ok ? 'no data' : read.message)

    importQuiz(target, {
      quiz: read.data.quiz,
      games: [],
      mode: 'COPY',
      randomBytes: bytes,
    })

    // ── play it on the machine that only ever received a zip ──
    const importedQuizId = target.db.select().from(game).all()[0]?.sourceQuizId ?? null
    expect(importedQuizId).toBeNull() // no games came across, so nothing points at a quiz yet

    const quizzes = read.data.quiz
    expect(quizzes.rounds).toHaveLength(2)

    const created = unwrap(
      createGameFromQuiz(target, {
        quizId: onlyQuizId(target),
        code: 'PLAY01',
        defaultPlayerLocale: 'nl',
        teams: [
          { name: 'Aardappel', colour: '#EF4444' },
          { name: 'Pintjes', colour: '#22D3EE' },
        ],
      }),
    )

    const [aardappel = '', pintjes = ''] = created.teamIds
    const content = loadGameContent(target, created.gameId)
    const free = content?.rounds[0]?.questions[0]
    if (!free) throw new Error('expected a question in the imported copy')

    appendAndProject(target, created.gameId, [
      { type: 'GAME_STARTED', payload: {} },
      { type: 'ROUND_OPENED', payload: { gameRoundId: content?.rounds[0]?.id ?? '' } },
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: free.id } },
      // The accepted answers came across, so this auto-grades without anyone re-typing them.
      answered(free.id, aardappel, '  RADIOHEAD  '),
      answered(free.id, pintjes, 'Oasis'),
      { type: 'QUESTION_LOCKED', payload: { gameQuestionId: free.id } },
      { type: 'QUESTION_SCORED', payload: { gameQuestionId: free.id } },
      { type: 'GAME_FINISHED', payload: {} },
    ])

    const review = reviewOf(target, created.gameId)
    const cells = review.rounds[0]?.questions[0]?.cells ?? []

    // `  RADIOHEAD  ` matches `radiohead` — lowercase + trim, nothing more (D22) — which means the
    // accepted-answer list survived the zip and is being applied on a machine that never saw it typed.
    expect(cells[0]).toMatchObject({ verdict: 'AUTO_CORRECT', points: 10 })
    expect(cells[1]).toMatchObject({ verdict: 'PENDING', points: 0 })
    expect(review.teams.find((team) => team.name === 'Aardappel')?.score).toBe(10)

    // And the game is joinable on this machine under its own new code (data model §6.1).
    expect(findJoinableGameByCode(target, 'PLAY01')).toBeUndefined()
    expect(listGames(target)).toHaveLength(1)
  })
})

function answered(gameQuestionId: string, teamId: string, text: string): GameEvent {
  return {
    type: 'ANSWER_SUBMITTED',
    payload: { gameQuestionId, teamId, text, fromDraft: false, enteredByMaster: false },
  }
}

function onlyQuizId(database: KwizDatabase): string {
  const rows = database.db.select().from(quizTable).all()
  const first = rows[0]
  if (rows.length !== 1 || !first)
    throw new Error(`expected one quiz, got ${rows.length}`)
  return first.id
}
