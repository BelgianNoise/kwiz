import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { appendAndProject, readLog } from './append'
import type { KwizDatabase } from './client'
import { loadGameContent } from './content'
import { createGameFromQuiz, resyncGame } from './instantiate'
import {
  acceptedAnswer,
  attachment,
  game,
  gameDevice,
  gameEvent,
  gameQuestion,
  gameTeam,
  jeopardyCategory,
  question,
  questionKeyword,
  questionOption,
  quiz,
  round,
} from './schema'
import { freshTestDatabase } from './test-support'

/**
 * data model §7 — the copy, and §7.1 the re-sync.
 *
 * The parity guard (`parity.test.ts`) proves the *columns* line up. This proves the copy actually
 * moves them, that parents are remapped rather than carried, and that a re-sync keeps the two things
 * a master would be furious to lose: their teams and the phones already joined.
 */

let database: KwizDatabase
let quizId: string
let roundId: string
let boardRoundId: string
let questionId: string

beforeEach(() => {
  database = freshTestDatabase()
  const { db } = database

  quizId = 'quiz-1'
  roundId = 'round-1'
  boardRoundId = 'round-2'
  questionId = 'question-1'

  db.insert(quiz).values({ id: quizId, name: 'Pub Quiz #4', revision: 7 }).run()

  db.insert(round)
    .values({
      id: roundId,
      quizId,
      position: 0,
      type: 'QUESTION_SET',
      title: 'Openers',
      defaultPoints: 10,
      defaultTimerMs: 30_000,
      config: {},
    })
    .run()
  db.insert(round)
    .values({
      id: boardRoundId,
      quizId,
      position: 1,
      type: 'JEOPARDY',
      title: 'Board',
      defaultPoints: 20,
      config: { valueLadder: [20, 40] },
    })
    .run()

  db.insert(jeopardyCategory)
    .values({ id: 'cat-1', roundId: boardRoundId, position: 0, name: 'Film' })
    .run()

  db.insert(question)
    .values({
      id: questionId,
      roundId,
      position: 0,
      prompt: 'Capital of France?',
      answerMethod: 'FREE_TEXT',
      points: 10,
      masterNotes: 'accept Paris, France',
      config: {},
    })
    .run()
  db.insert(question)
    .values({
      id: 'question-2',
      roundId: boardRoundId,
      categoryId: 'cat-1',
      position: 0,
      prompt: 'This 1975 film…',
      answerMethod: 'BUZZER',
      points: 20,
      config: {},
    })
    .run()

  db.insert(acceptedAnswer)
    .values([
      { id: 'aa-1', questionId, position: 0, text: 'Paris' },
      { id: 'aa-2', questionId, position: 1, text: 'Paris, France' },
    ])
    .run()
  db.insert(questionOption)
    .values({ id: 'opt-1', questionId, position: 0, text: 'Paris', isCorrect: true })
    .run()
  db.insert(questionKeyword)
    .values({
      id: 'kw-1',
      questionId,
      position: 0,
      text: 'i like cows',
      wordLengths: [1, 4, 4],
    })
    .run()
  db.insert(attachment)
    .values({
      id: 'att-1',
      questionId,
      position: 0,
      kind: 'AUDIO',
      mimeType: 'audio/mpeg',
      originalName: 'clip.mp3',
      ext: 'mp3',
      sizeBytes: 4_211_233,
      checksum: '3f8a2c',
      durationMs: 134_000,
    })
    .run()
})

describe('creating a game from a template', () => {
  it('copies the tree with new ids, remapped parents and the same checksum', () => {
    const created = createGameFromQuiz(database, {
      quizId,
      code: 'KWIZ01',
      teams: [
        { name: 'Quizzly Bears', colour: '#EF4444' },
        { name: 'Norfolk & Chance', colour: '#22D3EE' },
      ],
    })
    expect(created.ok).toBe(true)
    if (!created.ok || !created.data) throw new Error('expected a created game')
    const { gameId } = created.data

    const content = loadGameContent(database, gameId)
    if (!content) throw new Error('expected content')

    expect(content.quizName).toBe('Pub Quiz #4')
    expect(content.rounds.map((r) => r.title)).toEqual(['Openers', 'Board'])

    const copied = content.rounds[0]?.questions[0]
    // A new id, never the template's: a template row and its copy have to coexist.
    expect(copied?.id).not.toBe(questionId)
    expect(copied?.prompt).toBe('Capital of France?')
    // Shared columns carried by the factory spread, including the ones easiest to forget.
    expect(copied?.masterNotes).toBe('accept Paris, France')
    expect(copied?.timerMs).toBeNull()
    // `position = 0` first, so the canonical reveal answer is the head of the array.
    expect(copied?.acceptedAnswers).toEqual(['Paris', 'Paris, France'])
    expect(copied?.options[0]?.isCorrect).toBe(true)
    expect(copied?.keywords[0]?.wordLengths).toEqual([1, 4, 4])
    // No bytes are copied: the game's row shares the file by checksum (§8).
    expect(copied?.media[0]?.kind).toBe('AUDIO')

    // The Jeopardy tile points at *this game's* board column, not the template's (I1).
    const tile = content.rounds[1]?.questions[0]
    const category = content.rounds[1]?.categories[0]
    expect(tile?.categoryId).toBe(category?.id)
    expect(tile?.categoryId).not.toBe('cat-1')

    // Teams arrived as events, so the log is complete from `seq = 1`.
    const log = readLog(database, gameId)
    expect(log.map((entry) => entry.event.type)).toEqual([
      'GAME_CREATED',
      'TEAM_ADDED',
      'TEAM_ADDED',
    ])
    expect(log[0]?.seq).toBe(1)
    expect(
      database.db.select().from(gameTeam).where(eq(gameTeam.gameId, gameId)).all(),
    ).toHaveLength(2)
  })

  it('refuses a quiz that is not there', () => {
    const result = createGameFromQuiz(database, { quizId: 'nope', code: 'KWIZ02' })
    expect(result).toMatchObject({ ok: false, error: 'SOURCE_QUIZ_DELETED' })
  })

  /**
   * P1.6 — data model §7's last bullet: a copy is validated after writing, not trusted. A free-text
   * question with no accepted answer is invalid on the template side too (I5), so this is a quiz
   * `preflight()` would already flag in the editor — creating a game from it must refuse identically,
   * not silently hand a room an unanswerable question.
   */
  it('refuses to create a game from a quiz that already fails preflight, and commits nothing', () => {
    const { db } = database
    db.insert(quiz).values({ id: 'bad-quiz', name: 'Broken', revision: 1 }).run()
    db.insert(round)
      .values({
        id: 'bad-round',
        quizId: 'bad-quiz',
        position: 0,
        type: 'QUESTION_SET',
        title: 'Round',
        defaultPoints: 10,
        config: {},
      })
      .run()
    db.insert(question)
      .values({
        id: 'bad-question',
        roundId: 'bad-round',
        position: 0,
        prompt: 'Unanswerable',
        answerMethod: 'FREE_TEXT',
        points: 10,
        config: {},
        // No accepted answers — I5, and this is the point.
      })
      .run()

    const result = createGameFromQuiz(database, { quizId: 'bad-quiz', code: 'KWIZ99' })
    expect(result).toMatchObject({ ok: false, error: 'COPY_INVALID' })

    // The whole transaction rolled back — no half-created game left behind for a master to find.
    expect(
      database.db.select().from(game).where(eq(game.sourceQuizId, 'bad-quiz')).all(),
    ).toHaveLength(0)
    expect(database.db.select().from(gameEvent).all()).toHaveLength(0)
  })
})

describe('re-syncing a SETUP game', () => {
  // A code per game: they are unique among joinable games (data model §6.1), and a `LIVE` game is
  // joinable — so reusing one here is rejected, correctly.
  let codes = 0
  const create = (): string => {
    const created = createGameFromQuiz(database, {
      quizId,
      code: `KWIZ${String(++codes).padStart(2, '0')}`,
      teams: [{ name: 'Quizzly Bears', colour: '#EF4444' }],
    })
    if (!created.ok || !created.data) throw new Error('expected a created game')
    return created.data.gameId
  }

  it('re-copies the tree while keeping the teams and the phones already joined', () => {
    const gameId = create()
    const teamId = database.db
      .select()
      .from(gameTeam)
      .where(eq(gameTeam.gameId, gameId))
      .get()?.id
    if (!teamId) throw new Error('expected a team')

    appendAndProject(database, gameId, [
      {
        type: 'DEVICE_JOINED',
        payload: { deviceId: 'dev-1', teamId, deviceToken: 'tok-1' },
      },
    ])

    // The master fixes a typo and adds a question after the game was created.
    database.db
      .update(quiz)
      .set({ name: 'Pub Quiz #5', revision: 8 })
      .where(eq(quiz.id, quizId))
      .run()
    database.db
      .insert(question)
      .values({
        id: 'question-3',
        roundId,
        position: 1,
        prompt: 'Added later',
        answerMethod: 'FREE_TEXT',
        points: 10,
        config: {},
      })
      .run()
    // A free-text question needs at least one accepted answer (I5) — without it the copy this
    // produces is genuinely invalid, and `resyncGame` is now expected to refuse exactly that.
    database.db
      .insert(acceptedAnswer)
      .values({ id: 'aa-3', questionId: 'question-3', position: 0, text: 'Anything' })
      .run()

    const before = database.db
      .select({ id: gameQuestion.id })
      .from(gameQuestion)
      .where(eq(gameQuestion.gameId, gameId))
      .all()

    const result = resyncGame(database, gameId)
    expect(result).toMatchObject({ ok: true, data: { quizRevision: 8 } })

    const content = loadGameContent(database, gameId)
    expect(content?.quizName).toBe('Pub Quiz #5')
    expect(content?.rounds[0]?.questions.map((q) => q.prompt)).toEqual([
      'Capital of France?',
      'Added later',
    ])
    // Wholly new copy rows — the old subtree was deleted, not merged.
    const after = database.db
      .select({ id: gameQuestion.id })
      .from(gameQuestion)
      .where(eq(gameQuestion.gameId, gameId))
      .all()
    expect(after.map((row) => row.id)).not.toContain(before[0]?.id)

    // What a master would be furious to lose, and the reason re-sync exists at all (§7.1).
    expect(
      database.db.select().from(gameTeam).where(eq(gameTeam.gameId, gameId)).all(),
    ).toHaveLength(1)
    expect(
      database.db.select().from(gameDevice).where(eq(gameDevice.gameId, gameId)).all(),
    ).toHaveLength(1)

    expect(readLog(database, gameId).at(-1)?.event.type).toBe('GAME_RESYNCED')
  })

  /**
   * P1.6 — mirrors the create-side test above, but for the delete-then-recopy re-sync does: the two
   * halves of that transaction must roll back together, so a bad edit leaves the game exactly as
   * playable as it was before the master touched the quiz.
   */
  it('refuses to re-sync into a copy that fails preflight, and keeps the old copy intact', () => {
    const gameId = create()
    const before = database.db
      .select({ id: gameQuestion.id })
      .from(gameQuestion)
      .where(eq(gameQuestion.gameId, gameId))
      .all()

    database.db
      .insert(question)
      .values({
        id: 'question-bad',
        roundId,
        position: 1,
        prompt: 'Unanswerable',
        answerMethod: 'FREE_TEXT',
        points: 10,
        config: {},
        // No accepted answers — I5, and this is the point.
      })
      .run()

    const result = resyncGame(database, gameId)
    expect(result).toMatchObject({ ok: false, error: 'COPY_INVALID' })

    const after = database.db
      .select({ id: gameQuestion.id })
      .from(gameQuestion)
      .where(eq(gameQuestion.gameId, gameId))
      .all()
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort())
  })

  it('refuses once anything has been played, on the real condition rather than the status', () => {
    const gameId = create()
    const first = loadGameContent(database, gameId)?.rounds[0]?.questions[0]?.id
    if (!first) throw new Error('expected a question')
    const teamId = database.db
      .select()
      .from(gameTeam)
      .where(eq(gameTeam.gameId, gameId))
      .get()?.id
    if (!teamId) throw new Error('expected a team')

    appendAndProject(database, gameId, [
      { type: 'QUESTION_OPENED', payload: { gameQuestionId: first } },
      {
        type: 'ANSWER_SUBMITTED',
        payload: {
          gameQuestionId: first,
          teamId,
          text: 'paris',
          fromDraft: false,
          enteredByMaster: false,
        },
      },
    ])

    // The game is still `SETUP` as far as the projected column is concerned — the answer row is the
    // thing that makes a re-sync unsafe, which is why §7.1 checks it separately.
    expect(resyncGame(database, gameId)).toMatchObject({
      ok: false,
      error: 'RESYNC_BLOCKED',
    })
  })

  it('refuses once the game is live, and when the template is gone', () => {
    const gameId = create()
    appendAndProject(database, gameId, [{ type: 'GAME_STARTED', payload: {} }])
    expect(resyncGame(database, gameId)).toMatchObject({
      ok: false,
      error: 'NOT_IN_SETUP',
    })

    const other = create()
    // `sourceQuizId` is SET NULL, so deleting a template never destroys played history (§10) —
    // there is simply nothing left to re-sync from.
    database.db.delete(quiz).where(eq(quiz.id, quizId)).run()
    expect(resyncGame(database, other)).toMatchObject({
      ok: false,
      error: 'SOURCE_QUIZ_DELETED',
    })
    // …and the copy the game already owns is untouched.
    expect(loadGameContent(database, other)?.rounds[0]?.questions[0]?.prompt).toBe(
      'Capital of France?',
    )
  })
})
