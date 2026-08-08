import {
  fail,
  ok,
  wordLengths,
  type ActionResult,
  type AnswerMethod,
  type QuestionConfig,
  type QuizContent,
  roundConfigSchemaByType,
  type RoundConfig,
  type RoundType,
} from '@kwiz/domain'
import { and, desc, eq, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { KwizDatabase, KwizTx } from './client'
import { loadQuizTree } from './quiz-tree'
import {
  acceptedAnswer,
  attachment,
  jeopardyCategory,
  question,
  questionKeyword,
  questionOption,
  quiz,
  round,
} from './schema'

/**
 * The template half's writers — PRD 2's authoring surface, one function per thing a master can do.
 *
 * Unlike the play half there is **no event log here**: template rows are ordinary mutable rows (data
 * model §1), and editing one never touches a played game, because a game owns a deep copy. That is
 * the whole reason the two halves are separate, and it is why `appendAndProject` has nothing to say
 * about any of this.
 *
 * Three rules every function below keeps:
 *
 * 1. **`position` is explicit and contiguous** (I7). Never insertion order, never id order.
 * 2. **`quiz.revision` and `updatedAt` move on any descendant change.** A schema cannot express
 *    "a descendant changed", so it is this layer's job — and PRD 2 §14.2 compares `updatedAt` when
 *    an import collides, so a stale one is a wrong answer to a destructive question.
 * 3. **Refusals are typed** (conventions §4), never thrown, because the routes above return them.
 */

/** Bumps the quiz a row belongs to. Called by **every** writer here, including the deletes. */
function touchQuiz(tx: KwizTx, quizId: string, at: Date): void {
  tx.update(quiz)
    .set({ revision: sql`${quiz.revision} + 1`, updatedAt: at })
    .where(eq(quiz.id, quizId))
    .run()
}

const nextPosition = (
  tx: KwizTx,
  table: typeof round | typeof question | typeof jeopardyCategory,
  where: ReturnType<typeof eq>,
): number =>
  tx
    .select({ next: sql<number>`coalesce(max(${table.position}), -1) + 1` })
    .from(table)
    .where(where)
    .get()?.next ?? 0

/** Rewrites a sibling set to `0…n-1` in their current order, so I7 holds after every move. */
function renumber(
  tx: KwizTx,
  table: typeof round | typeof question | typeof jeopardyCategory,
  where: ReturnType<typeof eq>,
): void {
  const rows = tx
    .select({ id: table.id })
    .from(table)
    .where(where)
    .orderBy(table.position)
    .all()
  for (const [index, row] of rows.entries()) {
    tx.update(table).set({ position: index }).where(eq(table.id, row.id)).run()
  }
}

// ─── quizzes ───

export interface QuizSummary {
  id: string
  name: string
  description: string | null
  updatedAt: Date
  rounds: number
  questions: number
}

/**
 * The dashboard list (PRD 2 §5), with the two counts it shows per row.
 *
 * Three grouped queries merged in memory rather than one with correlated sub-selects, and that is
 * not a style preference: **inside a raw `sql` template drizzle renders `${table.column}` without
 * its table qualifier**, so `where ${round.quizId} = ${quiz.id}` becomes `where "quiz_id" = "id"` —
 * which inside the sub-select resolves both names against `round` and is therefore always false. It
 * returns zero rather than failing, so nothing tells you except a count that is wrong.
 */
export function listQuizzes(database: KwizDatabase): QuizSummary[] {
  const { db } = database

  // Most recently edited first, then most recently created. The tiebreak is not decoration:
  // `updatedAt` is milliseconds, two quizzes touched in the same one would otherwise come back in
  // whatever order SQLite felt like, and a list a human scans should not reshuffle itself. uuidv7
  // is time-ordered, so `id` says "newer" without a second timestamp column.
  const quizzes = db
    .select()
    .from(quiz)
    .orderBy(desc(quiz.updatedAt), desc(quiz.id))
    .all()

  const roundCounts = new Map(
    db
      .select({ quizId: round.quizId, count: sql<number>`count(*)` })
      .from(round)
      .groupBy(round.quizId)
      .all()
      .map((row) => [row.quizId, row.count]),
  )

  const questionCounts = new Map(
    db
      .select({ quizId: round.quizId, count: sql<number>`count(*)` })
      .from(question)
      .innerJoin(round, eq(round.id, question.roundId))
      .groupBy(round.quizId)
      .all()
      .map((row) => [row.quizId, row.count]),
  )

  return quizzes.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    updatedAt: row.updatedAt,
    rounds: roundCounts.get(row.id) ?? 0,
    questions: questionCounts.get(row.id) ?? 0,
  }))
}

export function createQuiz(
  database: KwizDatabase,
  input: { name: string },
  now: Date = new Date(),
): ActionResult<{ quizId: string }> {
  const id = uuidv7()
  database.db
    .insert(quiz)
    .values({ id, name: input.name, revision: 1, createdAt: now, updatedAt: now })
    .run()
  return ok({ quizId: id })
}

export function updateQuiz(
  database: KwizDatabase,
  quizId: string,
  patch: { name?: string; description?: string | null },
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    if (!exists(tx, quiz, quizId)) return fail('GAME_NOT_FOUND', `no quiz ${quizId}`)
    tx.update(quiz)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        revision: sql`${quiz.revision} + 1`,
        updatedAt: now,
      })
      .where(eq(quiz.id, quizId))
      .run()
    return ok()
  })
}

/**
 * **Deleting a quiz is safe** (data model §10): games keep their own copies, so played history
 * survives. PRD 2 §5's confirmation says so out loud, because masters otherwise assume the opposite
 * and never clean up.
 */
export function deleteQuiz(database: KwizDatabase, quizId: string): ActionResult {
  database.db.delete(quiz).where(eq(quiz.id, quizId)).run()
  return ok()
}

/** `[⋯] → Duplicate` (PRD 2 §5). A whole new tree, so the copy can be edited freely. */
export function duplicateQuiz(
  database: KwizDatabase,
  quizId: string,
  now: Date = new Date(),
): ActionResult<{ quizId: string }> {
  const source = loadQuizTree(database, quizId)
  if (!source) return fail('GAME_NOT_FOUND', `no quiz ${quizId}`)

  const newQuizId = uuidv7()
  database.db.transaction((tx) => {
    tx.insert(quiz)
      .values({
        id: newQuizId,
        name: `${source.name} (copy)`,
        description: source.description,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    for (const sourceRound of source.rounds) {
      const roundId = uuidv7()
      tx.insert(round)
        .values({
          id: roundId,
          quizId: newQuizId,
          position: sourceRound.position,
          type: sourceRound.type,
          title: sourceRound.title,
          defaultPoints: sourceRound.defaultPoints,
          defaultTimerMs: sourceRound.defaultTimerMs,
          config: sourceRound.config,
        })
        .run()

      const categoryIds = new Map<string, string>()
      for (const category of sourceRound.categories) {
        const id = uuidv7()
        categoryIds.set(category.id, id)
        tx.insert(jeopardyCategory)
          .values({ id, roundId, position: category.position, name: category.name })
          .run()
      }

      for (const sourceQuestion of sourceRound.questions) {
        const questionId = uuidv7()
        tx.insert(question)
          .values({
            id: questionId,
            roundId,
            categoryId:
              sourceQuestion.categoryId === null
                ? null
                : (categoryIds.get(sourceQuestion.categoryId) ?? null),
            position: sourceQuestion.position,
            prompt: sourceQuestion.prompt,
            answerMethod: sourceQuestion.answerMethod,
            points: sourceQuestion.points,
            timerMs: sourceQuestion.timerMs,
            masterNotes: sourceQuestion.masterNotes,
            config: sourceQuestion.config,
          })
          .run()

        for (const [index, text] of sourceQuestion.acceptedAnswers.entries()) {
          tx.insert(acceptedAnswer)
            .values({ id: uuidv7(), questionId, position: index, text })
            .run()
        }
        for (const option of sourceQuestion.options) {
          tx.insert(questionOption)
            .values({
              id: uuidv7(),
              questionId,
              position: option.position,
              text: option.text,
              isCorrect: option.isCorrect,
            })
            .run()
        }
        for (const kw of sourceQuestion.keywords) {
          tx.insert(questionKeyword)
            .values({
              id: uuidv7(),
              questionId,
              position: kw.position,
              text: kw.text,
              wordLengths: kw.wordLengths,
            })
            .run()
        }
        // Attachment rows are copied; the files are not. Content addressing means the copy shares
        // them by checksum (data model §8), so duplicating a quiz with 2 GB of video costs nothing.
        copyAttachments(tx, sourceQuestion.id, questionId)
      }
    }
  })

  return ok({ quizId: newQuizId })
}

function copyAttachments(tx: KwizTx, fromQuestionId: string, toQuestionId: string): void {
  const rows = tx
    .select()
    .from(attachment)
    .where(eq(attachment.questionId, fromQuestionId))
    .orderBy(attachment.position)
    .all()

  for (const row of rows) {
    tx.insert(attachment)
      .values({
        id: uuidv7(),
        questionId: toQuestionId,
        position: row.position,
        kind: row.kind,
        mimeType: row.mimeType,
        originalName: row.originalName,
        ext: row.ext,
        sizeBytes: row.sizeBytes,
        checksum: row.checksum,
        showOnPlayerDevices: row.showOnPlayerDevices,
        durationMs: row.durationMs,
        createdAt: row.createdAt,
      })
      .run()
  }
}

// ─── rounds, and the finale's one legal position ───

/**
 * PRD 2 §6.1 — **a new round lands before the finale, never after it.**
 *
 * A master with a finished quiz who wants one more ordinary round should get it in the right place
 * by default; requiring add-then-drag, when dragging past the finale is refused, would be a dead
 * end. The editor also stops offering `DSMTW_FINALE` once one exists, and this refuses it anyway —
 * prevention is the UI's job, but an imported quiz never passed through that UI.
 */
export function createRound(
  database: KwizDatabase,
  quizId: string,
  input: { type: RoundType; title: string },
  now: Date = new Date(),
): ActionResult<{ roundId: string }> {
  return database.db.transaction((tx) => {
    if (!exists(tx, quiz, quizId)) return fail('GAME_NOT_FOUND', `no quiz ${quizId}`)

    const rounds = tx
      .select({ id: round.id, type: round.type, position: round.position })
      .from(round)
      .where(eq(round.quizId, quizId))
      .orderBy(round.position)
      .all()

    const finale = rounds.find((existing) => existing.type === 'DSMTW_FINALE')
    if (input.type === 'DSMTW_FINALE' && finale) {
      return fail('VALIDATION_ERROR', 'this quiz already ends with a finale (I20)')
    }

    // Before the finale if there is one, otherwise at the end.
    const position = finale ? finale.position : rounds.length
    if (finale) {
      tx.update(round)
        .set({ position: sql`${round.position} + 1` })
        .where(and(eq(round.quizId, quizId), sql`${round.position} >= ${position}`))
        .run()
    }

    const roundId = uuidv7()
    tx.insert(round)
      .values({
        id: roundId,
        quizId,
        position,
        type: input.type,
        title: input.title,
        defaultPoints: 10,
        defaultTimerMs: input.type === 'DSMTW_FINALE' ? null : 30_000,
        config: defaultRoundConfig(input.type),
      })
      .run()

    touchQuiz(tx, quizId, now)
    return ok({ roundId })
  })
}

function defaultRoundConfig(type: RoundType): RoundConfig {
  switch (type) {
    case 'JEOPARDY':
      return { valueLadder: [100, 200, 300, 400, 500] }
    case 'DSMTW_FINALE':
      // conventions §5 owns the penalty default; the rate has none, because a wrong guess here is
      // worse than an empty field the editor makes the master fill in (PRD 2 §9).
      return { secondsPerPoint: 0.5, penaltySeconds: 20 }
    default:
      return {}
  }
}

export function updateRound(
  database: KwizDatabase,
  roundId: string,
  patch: {
    title?: string
    defaultPoints?: number
    defaultTimerMs?: number | null
    config?: RoundConfig
  },
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const row = tx
      .select({ quizId: round.quizId, type: round.type })
      .from(round)
      .where(eq(round.id, roundId))
      .get()
    if (!row) return fail('VALIDATION_ERROR', `no round ${roundId}`)

    /*
     * I6 — `config` must validate against the schema for this round's `type`, and the pairing cannot
     * be expressed in the column: the discriminator is a sibling column, so the boundary above can
     * only check the shape is *one of* the three. This is the layer that knows which.
     */
    if (patch.config !== undefined) {
      const parsed = roundConfigSchemaByType[row.type].safeParse(patch.config)
      if (!parsed.success) {
        return fail(
          'VALIDATION_ERROR',
          `that config is not valid for a ${row.type} round`,
        )
      }
    }

    tx.update(round)
      .set({
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.defaultPoints === undefined
          ? {}
          : { defaultPoints: patch.defaultPoints }),
        ...(patch.defaultTimerMs === undefined
          ? {}
          : { defaultTimerMs: patch.defaultTimerMs }),
        ...(patch.config === undefined ? {} : { config: patch.config }),
      })
      .where(eq(round.id, roundId))
      .run()

    touchQuiz(tx, row.quizId, now)
    return ok()
  })
}

export function deleteRound(
  database: KwizDatabase,
  roundId: string,
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const row = tx
      .select({ quizId: round.quizId })
      .from(round)
      .where(eq(round.id, roundId))
      .get()
    if (!row) return ok()

    tx.delete(round).where(eq(round.id, roundId)).run()
    renumber(tx, round, eq(round.quizId, row.quizId))
    touchQuiz(tx, row.quizId, now)
    return ok()
  })
}

/**
 * Moves a round one place, the `Alt+↑/↓` path and the drag path alike.
 *
 * PRD 2 §15.2 is explicit that **both routes must refuse identically**, or the keyboard becomes a way
 * around the rule the drag enforces: the finale never moves, and nothing moves past it.
 */
export function moveRound(
  database: KwizDatabase,
  roundId: string,
  direction: 'UP' | 'DOWN',
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const moving = tx
      .select({
        id: round.id,
        quizId: round.quizId,
        position: round.position,
        type: round.type,
      })
      .from(round)
      .where(eq(round.id, roundId))
      .get()
    if (!moving) return fail('VALIDATION_ERROR', `no round ${roundId}`)
    // It has one legal position (I20), so there is nowhere to move it to.
    if (moving.type === 'DSMTW_FINALE') {
      return fail('VALIDATION_ERROR', 'the finale is pinned as the last round')
    }

    const siblings = tx
      .select({ id: round.id, position: round.position, type: round.type })
      .from(round)
      .where(eq(round.quizId, moving.quizId))
      .orderBy(round.position)
      .all()

    const index = siblings.findIndex((sibling) => sibling.id === roundId)
    const targetIndex = direction === 'UP' ? index - 1 : index + 1
    const target = siblings[targetIndex]
    // Off the end, or the pinned finale below — the same refusal the drop indicator gives.
    if (!target || target.type === 'DSMTW_FINALE') return ok()

    tx.update(round)
      .set({ position: target.position })
      .where(eq(round.id, moving.id))
      .run()
    tx.update(round)
      .set({ position: moving.position })
      .where(eq(round.id, target.id))
      .run()
    touchQuiz(tx, moving.quizId, now)
    return ok()
  })
}

// ─── questions ───

export interface NewQuestionInput {
  /** `JEOPARDY` only — which column the tile sits in (I1). */
  categoryId?: string | null
  /** `JEOPARDY` only: the row, so the value comes from the ladder rather than being typed (O3). */
  points?: number
}

/**
 * A question, with everything the round already implies.
 *
 * A finale question is created **as** a finale question: `KEYWORDS`, and five empty keyword slots,
 * because I17 says exactly five and PRD 2 §9.1 renders five always. Creating four and letting
 * pre-flight complain would be inventing a broken state on purpose.
 */
export function createQuestion(
  database: KwizDatabase,
  roundId: string,
  input: NewQuestionInput = {},
  now: Date = new Date(),
): ActionResult<{ questionId: string }> {
  return database.db.transaction((tx) => {
    const parent = tx
      .select({
        quizId: round.quizId,
        type: round.type,
        defaultPoints: round.defaultPoints,
      })
      .from(round)
      .where(eq(round.id, roundId))
      .get()
    if (!parent) return fail('VALIDATION_ERROR', `no round ${roundId}`)

    const questionId = uuidv7()
    const answerMethod: AnswerMethod =
      parent.type === 'DSMTW_FINALE'
        ? 'KEYWORDS'
        : parent.type === 'JEOPARDY'
          ? 'BUZZER'
          : 'FREE_TEXT'

    tx.insert(question)
      .values({
        id: questionId,
        roundId,
        categoryId: input.categoryId ?? null,
        position: nextPosition(tx, question, eq(question.roundId, roundId)),
        prompt: '',
        answerMethod,
        // The round's default cascades (D6); a Jeopardy tile takes its value from the ladder (O3).
        points: input.points ?? parent.defaultPoints,
        timerMs: null,
        masterNotes: null,
        // Empty until the method needs settings: only `DO` has any (D24), and it acquires them
        // when the master picks that method in the sheet.
        config: {},
      })
      .run()

    if (parent.type === 'DSMTW_FINALE') {
      for (let position = 0; position < 5; position += 1) {
        tx.insert(questionKeyword)
          .values({ id: uuidv7(), questionId, position, text: '', wordLengths: [1] })
          .run()
      }
    }

    touchQuiz(tx, parent.quizId, now)
    return ok({ questionId })
  })
}

export interface QuestionPatch {
  prompt?: string
  answerMethod?: AnswerMethod
  points?: number
  timerMs?: number | null
  masterNotes?: string | null
  config?: QuestionConfig
}

export function updateQuestion(
  database: KwizDatabase,
  questionId: string,
  patch: QuestionPatch,
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = quizOfQuestion(tx, questionId)
    if (!parent) return fail('VALIDATION_ERROR', `no question ${questionId}`)

    /*
     * Changing the answer method **keeps** whatever the new method cannot use (PRD 2 §7.1): options
     * and accepted answers stay in their tables, hidden rather than deleted, so flipping to multiple
     * choice and back does not silently destroy typed answers. Only an explicit "clear" removes them.
     */
    tx.update(question)
      .set({
        ...(patch.prompt === undefined ? {} : { prompt: patch.prompt }),
        ...(patch.answerMethod === undefined ? {} : { answerMethod: patch.answerMethod }),
        ...(patch.points === undefined ? {} : { points: patch.points }),
        ...(patch.timerMs === undefined ? {} : { timerMs: patch.timerMs }),
        ...(patch.masterNotes === undefined ? {} : { masterNotes: patch.masterNotes }),
        ...(patch.config === undefined ? {} : { config: patch.config }),
      })
      .where(eq(question.id, questionId))
      .run()

    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

export function deleteQuestion(
  database: KwizDatabase,
  questionId: string,
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = quizOfQuestion(tx, questionId)
    if (!parent) return ok()

    tx.delete(question).where(eq(question.id, questionId)).run()
    renumber(tx, question, eq(question.roundId, parent.roundId))
    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

export function moveQuestion(
  database: KwizDatabase,
  questionId: string,
  direction: 'UP' | 'DOWN',
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = quizOfQuestion(tx, questionId)
    if (!parent) return fail('VALIDATION_ERROR', `no question ${questionId}`)

    const siblings = tx
      .select({ id: question.id, position: question.position })
      .from(question)
      .where(eq(question.roundId, parent.roundId))
      .orderBy(question.position)
      .all()

    const index = siblings.findIndex((sibling) => sibling.id === questionId)
    const target = siblings[direction === 'UP' ? index - 1 : index + 1]
    const moving = siblings[index]
    if (!target || !moving) return ok()

    tx.update(question)
      .set({ position: target.position })
      .where(eq(question.id, moving.id))
      .run()
    tx.update(question)
      .set({ position: moving.position })
      .where(eq(question.id, target.id))
      .run()
    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

// ─── a question's lists ───

/**
 * The accepted answers, replaced wholesale — `position = 0` is the canonical one shown at reveal.
 *
 * Replace rather than diff: these are template rows nothing else references (game copies get their
 * own ids), and rewriting the set is what keeps `position` contiguous by construction.
 */
export function setAcceptedAnswers(
  database: KwizDatabase,
  questionId: string,
  answers: readonly string[],
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = quizOfQuestion(tx, questionId)
    if (!parent) return fail('VALIDATION_ERROR', `no question ${questionId}`)

    tx.delete(acceptedAnswer).where(eq(acceptedAnswer.questionId, questionId)).run()
    for (const [position, text] of answers.entries()) {
      if (text.trim() === '') continue
      tx.insert(acceptedAnswer).values({ id: uuidv7(), questionId, position, text }).run()
    }

    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

export interface OptionInput {
  text: string
  isCorrect: boolean
}

/** I4 lives in the UI's radio group; this refuses anything that got past it. */
export function setOptions(
  database: KwizDatabase,
  questionId: string,
  options: readonly OptionInput[],
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = quizOfQuestion(tx, questionId)
    if (!parent) return fail('VALIDATION_ERROR', `no question ${questionId}`)
    if (options.length > 4) {
      return fail(
        'VALIDATION_ERROR',
        'a multiple-choice question takes at most four options',
      )
    }
    if (options.filter((option) => option.isCorrect).length > 1) {
      return fail('VALIDATION_ERROR', 'exactly one option may be correct (I4)')
    }

    tx.delete(questionOption).where(eq(questionOption.questionId, questionId)).run()
    for (const [position, option] of options.entries()) {
      tx.insert(questionOption)
        .values({
          id: uuidv7(),
          questionId,
          position,
          text: option.text,
          isCorrect: option.isCorrect,
        })
        .run()
    }

    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

/**
 * The five keywords (I17), with **`wordLengths` computed here on write** (I19).
 *
 * That is the difference between a rule and a guarantee: because the shape is stored, a payload
 * filter can select it and **never load `text` at all** for an unmarked keyword (D53). Recomputing
 * it in the filter would mean holding the secret in a variable next to the code that must not send
 * it.
 */
export function setKeywords(
  database: KwizDatabase,
  questionId: string,
  keywords: readonly string[],
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = quizOfQuestion(tx, questionId)
    if (!parent) return fail('VALIDATION_ERROR', `no question ${questionId}`)
    if (keywords.length !== 5) {
      return fail('VALIDATION_ERROR', 'a finale question has exactly five keywords (I17)')
    }

    tx.delete(questionKeyword).where(eq(questionKeyword.questionId, questionId)).run()
    for (const [position, text] of keywords.entries()) {
      tx.insert(questionKeyword)
        .values({
          id: uuidv7(),
          questionId,
          position,
          text,
          // An empty slot still needs a valid shape: the column is `min(1)`, and the question is
          // incomplete rather than malformed until the master fills it in.
          wordLengths: text.trim() === '' ? [1] : wordLengths(text),
        })
        .run()
    }

    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

// ─── the Jeopardy board ───

export function createCategory(
  database: KwizDatabase,
  roundId: string,
  name: string,
  now: Date = new Date(),
): ActionResult<{ categoryId: string }> {
  return database.db.transaction((tx) => {
    const parent = tx
      .select({ quizId: round.quizId })
      .from(round)
      .where(eq(round.id, roundId))
      .get()
    if (!parent) return fail('VALIDATION_ERROR', `no round ${roundId}`)

    const categoryId = uuidv7()
    tx.insert(jeopardyCategory)
      .values({
        id: categoryId,
        roundId,
        position: nextPosition(
          tx,
          jeopardyCategory,
          eq(jeopardyCategory.roundId, roundId),
        ),
        name,
      })
      .run()

    touchQuiz(tx, parent.quizId, now)
    return ok({ categoryId })
  })
}

/**
 * PRD 2 §8's `[edit ▾] → reorder`. Column order is what the room reads left to right, so it is
 * authored, not incidental.
 *
 * A straight swap with the neighbour, exactly like `moveRound`, because `position` is explicit and
 * contiguous (I7) — the same reason both reorder routes in the UI can send a direction rather than
 * an index. Off the end is a **no-op, not an error**: the UI offers the control at the ends anyway
 * and a refusal there would be noise.
 */
export function moveCategory(
  database: KwizDatabase,
  categoryId: string,
  direction: 'LEFT' | 'RIGHT',
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = quizOfCategory(tx, categoryId)
    if (!parent) return fail('VALIDATION_ERROR', `no category ${categoryId}`)

    const siblings = tx
      .select({ id: jeopardyCategory.id, position: jeopardyCategory.position })
      .from(jeopardyCategory)
      .where(eq(jeopardyCategory.roundId, parent.roundId))
      .orderBy(jeopardyCategory.position)
      .all()

    const index = siblings.findIndex((sibling) => sibling.id === categoryId)
    const moving = siblings[index]
    const target = siblings[direction === 'LEFT' ? index - 1 : index + 1]
    if (!moving || !target) return ok()

    tx.update(jeopardyCategory)
      .set({ position: target.position })
      .where(eq(jeopardyCategory.id, moving.id))
      .run()
    tx.update(jeopardyCategory)
      .set({ position: moving.position })
      .where(eq(jeopardyCategory.id, target.id))
      .run()
    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

export function renameCategory(
  database: KwizDatabase,
  categoryId: string,
  name: string,
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = quizOfCategory(tx, categoryId)
    if (!parent) return fail('VALIDATION_ERROR', `no category ${categoryId}`)

    tx.update(jeopardyCategory)
      .set({ name })
      .where(eq(jeopardyCategory.id, categoryId))
      .run()
    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

/** Takes its tiles with it (PRD 2 §8), which the confirmation names before this is called. */
export function deleteCategory(
  database: KwizDatabase,
  categoryId: string,
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = quizOfCategory(tx, categoryId)
    if (!parent) return ok()

    tx.delete(jeopardyCategory).where(eq(jeopardyCategory.id, categoryId)).run()
    renumber(tx, jeopardyCategory, eq(jeopardyCategory.roundId, parent.roundId))
    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

/**
 * PRD 2 §8 / O3 — **the ladder governs, and tiles cannot deviate.**
 *
 * Editing the ladder re-values the whole row, which is what a master means when they change it: a
 * column that does not read 100/200/300 looks broken to a room that knows the game. The schema
 * permits per-tile values, so this can be opened up later without a migration.
 */
export function setValueLadder(
  database: KwizDatabase,
  roundId: string,
  ladder: readonly number[],
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const parent = tx
      .select({ quizId: round.quizId, type: round.type })
      .from(round)
      .where(eq(round.id, roundId))
      .get()
    if (!parent) return fail('VALIDATION_ERROR', `no round ${roundId}`)
    if (parent.type !== 'JEOPARDY') {
      return fail('VALIDATION_ERROR', 'only a Jeopardy round has a value ladder')
    }
    if (
      ladder.length === 0 ||
      ladder.some((value) => !Number.isInteger(value) || value <= 0)
    ) {
      return fail(
        'VALIDATION_ERROR',
        'a value ladder is one or more positive whole numbers',
      )
    }

    tx.update(round)
      .set({ config: { valueLadder: [...ladder] } })
      .where(eq(round.id, roundId))
      .run()

    // Re-value every tile from its row. A tile's row is its position within its category.
    const categories = tx
      .select({ id: jeopardyCategory.id })
      .from(jeopardyCategory)
      .where(eq(jeopardyCategory.roundId, roundId))
      .all()

    for (const category of categories) {
      const tiles = tx
        .select({ id: question.id })
        .from(question)
        .where(and(eq(question.roundId, roundId), eq(question.categoryId, category.id)))
        .orderBy(question.position)
        .all()

      for (const [row, tile] of tiles.entries()) {
        // A tile below the ladder keeps the last rung rather than becoming worthless.
        const points = ladder[Math.min(row, ladder.length - 1)] ?? 0
        tx.update(question).set({ points }).where(eq(question.id, tile.id)).run()
      }
    }

    touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

// ─── attachments ───

export function deleteAttachment(
  database: KwizDatabase,
  attachmentId: string,
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const row = tx
      .select({ questionId: attachment.questionId })
      .from(attachment)
      .where(eq(attachment.id, attachmentId))
      .get()
    if (!row) return ok()

    const parent = quizOfQuestion(tx, row.questionId)
    tx.delete(attachment).where(eq(attachment.id, attachmentId)).run()
    /*
     * **The file is deliberately left on disk** (data model §8). Removing a row and a file
     * non-atomically can strand either one; reconciliation makes the recoverable direction — an
     * orphaned file — the direction that happens. PRD 2 §16's `Reclaim space` sweeps them.
     */
    if (parent) touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

export function setAttachmentVisibility(
  database: KwizDatabase,
  attachmentId: string,
  showOnPlayerDevices: boolean,
  now: Date = new Date(),
): ActionResult {
  return database.db.transaction((tx) => {
    const row = tx
      .select({ questionId: attachment.questionId, kind: attachment.kind })
      .from(attachment)
      .where(eq(attachment.id, attachmentId))
      .get()
    if (!row) return fail('VALIDATION_ERROR', `no attachment ${attachmentId}`)
    // D27 / I3: audio and video are main-screen-only and not configurable. Twenty phones playing
    // the same song a fraction of a second apart is the failure this prevents.
    if (row.kind !== 'IMAGE' && showOnPlayerDevices) {
      return fail('VALIDATION_ERROR', 'only an image can be shown on player devices (I3)')
    }

    tx.update(attachment)
      .set({ showOnPlayerDevices })
      .where(eq(attachment.id, attachmentId))
      .run()
    const parent = quizOfQuestion(tx, row.questionId)
    if (parent) touchQuiz(tx, parent.quizId, now)
    return ok()
  })
}

// ─── lookups ───

function exists(tx: KwizTx, table: typeof quiz, id: string): boolean {
  return (
    tx.select({ id: table.id }).from(table).where(eq(table.id, id)).get() !== undefined
  )
}

function quizOfQuestion(
  tx: KwizTx,
  questionId: string,
): { quizId: string; roundId: string } | undefined {
  const row = tx
    .select({ roundId: question.roundId, quizId: round.quizId })
    .from(question)
    .innerJoin(round, eq(round.id, question.roundId))
    .where(eq(question.id, questionId))
    .get()
  return row
}

function quizOfCategory(
  tx: KwizTx,
  categoryId: string,
): { quizId: string; roundId: string } | undefined {
  return tx
    .select({ roundId: jeopardyCategory.roundId, quizId: round.quizId })
    .from(jeopardyCategory)
    .innerJoin(round, eq(round.id, jeopardyCategory.roundId))
    .where(eq(jeopardyCategory.id, categoryId))
    .get()
}

export type { QuizContent }
