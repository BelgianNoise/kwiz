import type {
  GameContent,
  KeywordContent,
  MediaContent,
  OptionContent,
  QuestionContent,
  RoundContent,
} from '@kwiz/domain'
import { eq } from 'drizzle-orm'

import type { KwizDatabase, KwizTx } from './client'
import {
  game,
  gameAcceptedAnswer,
  gameAttachment,
  gameJeopardyCategory,
  gameQuestion,
  gameQuestionKeyword,
  gameQuestionOption,
  gameRound,
} from './schema'

/**
 * The game-copy subtree (data model §5) in the shape `@kwiz/domain`'s reducer expects.
 *
 * **This is the half of a projection that is not in the log**, and never could be: a question's
 * prompt is not something that happened. `reduce(content, events)` is a pure function of the two,
 * so a live projection is built by loading this once and folding the log over it.
 *
 * Seven flat queries and an in-memory assembly rather than a join tree: the copy is written once
 * and read whole, and at the documented scale — 40 questions a round (PRD 1 §2.1) — the whole
 * subtree is a few hundred rows. Ordering is always by the explicit `position` column, never by id
 * or insertion order (CLAUDE.md §2.7).
 *
 * Results are **not** re-validated with zod (conventions §10.2): the `config` columns are typed by
 * the schema and were validated on write. The one thing read back as `unknown` is
 * `game_event.payload`, which `readLog` does parse.
 *
 * Takes a `KwizTx` as well as a `KwizDatabase` — the copy-time invariant check (data model §7's
 * last bullet, `instantiate.ts`) needs to read back the rows it just wrote **inside the same
 * transaction**, before anything commits, and a transaction handle has no `.db` to unwrap.
 */
export function loadGameContent(
  database: KwizDatabase | KwizTx,
  gameId: string,
): GameContent | undefined {
  const db = 'db' in database ? database.db : database
  const row = db.select().from(game).where(eq(game.id, gameId)).get()
  if (!row) return undefined

  const rounds = db
    .select()
    .from(gameRound)
    .where(eq(gameRound.gameId, gameId))
    .orderBy(gameRound.position)
    .all()
  const categories = db
    .select()
    .from(gameJeopardyCategory)
    .where(eq(gameJeopardyCategory.gameId, gameId))
    .orderBy(gameJeopardyCategory.position)
    .all()
  const questions = db
    .select()
    .from(gameQuestion)
    .where(eq(gameQuestion.gameId, gameId))
    .orderBy(gameQuestion.position)
    .all()
  const acceptedAnswers = db
    .select()
    .from(gameAcceptedAnswer)
    .where(eq(gameAcceptedAnswer.gameId, gameId))
    .orderBy(gameAcceptedAnswer.position)
    .all()
  const options = db
    .select()
    .from(gameQuestionOption)
    .where(eq(gameQuestionOption.gameId, gameId))
    .orderBy(gameQuestionOption.position)
    .all()
  const keywords = db
    .select()
    .from(gameQuestionKeyword)
    .where(eq(gameQuestionKeyword.gameId, gameId))
    .orderBy(gameQuestionKeyword.position)
    .all()
  const attachments = db
    .select()
    .from(gameAttachment)
    .where(eq(gameAttachment.gameId, gameId))
    .orderBy(gameAttachment.position)
    .all()

  const byQuestion = <T extends { gameQuestionId: string }>(
    rows: T[],
  ): Map<string, T[]> => {
    const grouped = new Map<string, T[]>()
    for (const entry of rows) {
      const bucket = grouped.get(entry.gameQuestionId)
      if (bucket) bucket.push(entry)
      else grouped.set(entry.gameQuestionId, [entry])
    }
    return grouped
  }

  const answersFor = byQuestion(acceptedAnswers)
  const optionsFor = byQuestion(options)
  const keywordsFor = byQuestion(keywords)
  const mediaFor = byQuestion(attachments)

  const questionContent = (q: (typeof questions)[number]): QuestionContent => ({
    id: q.id,
    roundId: q.gameRoundId,
    categoryId: q.gameCategoryId,
    position: q.position,
    prompt: q.prompt,
    answerMethod: q.answerMethod,
    points: q.points,
    timerMs: q.timerMs,
    masterNotes: q.masterNotes,
    config: q.config,
    // `position = 0` first: the canonical answer shown at reveal is the head of this array.
    acceptedAnswers: (answersFor.get(q.id) ?? []).map((answer) => answer.text),
    options: (optionsFor.get(q.id) ?? []).map((option): OptionContent => ({
      id: option.id,
      position: option.position,
      text: option.text,
      isCorrect: option.isCorrect,
    })),
    keywords: (keywordsFor.get(q.id) ?? []).map((keyword): KeywordContent => ({
      id: keyword.id,
      position: keyword.position,
      text: keyword.text,
      // Stored, never recomputed here (I19) — which is what lets a payload filter select the
      // shape without ever loading `text` for an unmarked keyword.
      wordLengths: keyword.wordLengths,
    })),
    media: (mediaFor.get(q.id) ?? []).map((media): MediaContent => ({
      id: media.id,
      kind: media.kind,
      position: media.position,
      durationMs: media.durationMs,
      showOnPlayerDevices: media.showOnPlayerDevices,
      originalName: media.originalName,
      sizeBytes: media.sizeBytes,
    })),
  })

  return {
    gameId: row.id,
    quizName: row.quizName,
    code: row.code,
    defaultPlayerLocale: row.defaultPlayerLocale,
    mainScreenColourScheme: row.mainScreenColourScheme,
    mainScreenTypography: row.mainScreenTypography,
    rounds: rounds.map((round): RoundContent => ({
      id: round.id,
      position: round.position,
      type: round.type,
      title: round.title,
      defaultPoints: round.defaultPoints,
      defaultTimerMs: round.defaultTimerMs,
      config: round.config,
      categories: categories
        .filter((category) => category.gameRoundId === round.id)
        .map((category) => ({
          id: category.id,
          position: category.position,
          name: category.name,
        })),
      questions: questions
        .filter((question) => question.gameRoundId === round.id)
        .map(questionContent),
    })),
  }
}
