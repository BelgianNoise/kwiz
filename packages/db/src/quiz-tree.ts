import type {
  KeywordContent,
  MediaContent,
  OptionContent,
  QuestionContent,
  QuizContent,
  RoundContent,
} from '@kwiz/domain'
import { eq, inArray } from 'drizzle-orm'

import type { KwizDatabase } from './client'
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
 * The **template** tree, in the shape PRD 2's editors and `preflight()` read.
 *
 * The twin of `loadGameContent`, and deliberately a separate function rather than a shared one with
 * a flag: the two halves have different mutability rules (data model §1), and a single loader that
 * could return either would be one `if` away from an editor writing to a game copy, which I16
 * forbids.
 *
 * Same shape as there — flat queries, assembled in memory, ordered by the explicit `position`
 * column and never by id or insertion order (CLAUDE.md §2.7).
 *
 * Scoped by parent id at the query, the way `export-read.ts`'s `collectQuizExport` already does
 * for the identical problem — not loaded whole and filtered in memory (code review dup #5). The
 * difference is invisible at PRD 1 §2.1's scale, but it scales with the *total* number of quizzes
 * ever authored rather than the one being loaded, which is the wrong axis as a venue's library
 * grows.
 */
export function loadQuizTree(
  database: KwizDatabase,
  quizId: string,
): QuizContent | undefined {
  const row = database.db.select().from(quiz).where(eq(quiz.id, quizId)).get()
  if (!row) return undefined

  const { db } = database
  const rounds = db
    .select()
    .from(round)
    .where(eq(round.quizId, quizId))
    .orderBy(round.position)
    .all()
  const roundIds = rounds.map((entry) => entry.id)

  const categories = ids(roundIds, (list) =>
    db
      .select()
      .from(jeopardyCategory)
      .where(inArray(jeopardyCategory.roundId, list))
      .orderBy(jeopardyCategory.position)
      .all(),
  )
  const questions = ids(roundIds, (list) =>
    db
      .select()
      .from(question)
      .where(inArray(question.roundId, list))
      .orderBy(question.position)
      .all(),
  )
  const questionIds = questions.map((entry) => entry.id)

  const answers = ids(questionIds, (list) =>
    db
      .select()
      .from(acceptedAnswer)
      .where(inArray(acceptedAnswer.questionId, list))
      .orderBy(acceptedAnswer.position)
      .all(),
  )
  const options = ids(questionIds, (list) =>
    db
      .select()
      .from(questionOption)
      .where(inArray(questionOption.questionId, list))
      .orderBy(questionOption.position)
      .all(),
  )
  const keywords = ids(questionIds, (list) =>
    db
      .select()
      .from(questionKeyword)
      .where(inArray(questionKeyword.questionId, list))
      .orderBy(questionKeyword.position)
      .all(),
  )
  const media = ids(questionIds, (list) =>
    db
      .select()
      .from(attachment)
      .where(inArray(attachment.questionId, list))
      .orderBy(attachment.position)
      .all(),
  )

  const group = <T extends { questionId: string }>(rows: T[]): Map<string, T[]> => {
    const grouped = new Map<string, T[]>()
    for (const entry of rows) {
      const bucket = grouped.get(entry.questionId)
      if (bucket) bucket.push(entry)
      else grouped.set(entry.questionId, [entry])
    }
    return grouped
  }

  const answersFor = group(answers)
  const optionsFor = group(options)
  const keywordsFor = group(keywords)
  const mediaFor = group(media)

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    revision: row.revision,
    updatedAt: row.updatedAt.getTime(),
    mainScreenColourScheme: row.mainScreenColourScheme,
    mainScreenTypography: row.mainScreenTypography,
    rounds: rounds.map((entry): RoundContent => ({
      id: entry.id,
      position: entry.position,
      type: entry.type,
      title: entry.title,
      defaultPoints: entry.defaultPoints,
      defaultTimerMs: entry.defaultTimerMs,
      config: entry.config,
      categories: categories
        .filter((category) => category.roundId === entry.id)
        .map((category) => ({
          id: category.id,
          position: category.position,
          name: category.name,
        })),
      questions: questions
        .filter((candidate) => candidate.roundId === entry.id)
        .map((candidate): QuestionContent => ({
          id: candidate.id,
          roundId: candidate.roundId,
          categoryId: candidate.categoryId,
          position: candidate.position,
          prompt: candidate.prompt,
          answerMethod: candidate.answerMethod,
          points: candidate.points,
          timerMs: candidate.timerMs,
          masterNotes: candidate.masterNotes,
          config: candidate.config,
          acceptedAnswers: (answersFor.get(candidate.id) ?? []).map((a) => a.text),
          options: (optionsFor.get(candidate.id) ?? []).map((option): OptionContent => ({
            id: option.id,
            position: option.position,
            text: option.text,
            isCorrect: option.isCorrect,
          })),
          keywords: (keywordsFor.get(candidate.id) ?? []).map(
            (keyword): KeywordContent => ({
              id: keyword.id,
              position: keyword.position,
              text: keyword.text,
              // Stored on write (I19), never recomputed on read.
              wordLengths: keyword.wordLengths,
            }),
          ),
          media: (mediaFor.get(candidate.id) ?? []).map((file): MediaContent => ({
            id: file.id,
            kind: file.kind,
            position: file.position,
            durationMs: file.durationMs,
            showOnPlayerDevices: file.showOnPlayerDevices,
            originalName: file.originalName,
            sizeBytes: file.sizeBytes,
          })),
        })),
    })),
  }
}

/**
 * `inArray` with an empty list generates `in ()`, which SQLite rejects as a syntax error — so an
 * empty parent list short-circuits. It is the ordinary case, not an edge one: a quiz with a round
 * that has no questions yet reaches this on every load. Mirrors `export-read.ts`'s own helper.
 */
function ids<T>(parents: string[], query: (list: string[]) => T[]): T[] {
  return parents.length === 0 ? [] : query(parents)
}
