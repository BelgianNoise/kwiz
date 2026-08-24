import {
  createCategory,
  createQuestion,
  createQuiz,
  createRound,
  setAcceptedAnswers,
  setKeywords,
  setOptions,
  setValueLadder,
  updateQuestion,
  type KwizDatabase,
} from '@kwiz/db'

import { retryOnBusy } from './db'

/**
 * Build-order slice 9's third determinism rule: quizzes are built **directly through
 * `@kwiz/db`**, never through the authoring UI, so twenty-odd scenarios' setup does not
 * depend on the one surface that scenarios 1–4 are the ones actually testing.
 *
 * Every helper below unwraps its `ActionResult` immediately and throws on failure — a fixture
 * that silently built the wrong quiz would fail the *spec*, ten lines later, for a reason that
 * has nothing to do with what the spec is about.
 */

/**
 * Both helpers exist because `ActionResult` covers two shapes: calls that return something
 * (`createQuiz` → `{ quizId }`) and calls that return nothing but can still fail
 * (`setAcceptedAnswers`). Using one helper for both silently rejects every successful void
 * call, since `data` is legitimately `undefined` on those.
 */
function unwrap<T>(call: () => { ok: boolean; data?: T; message?: string }): T {
  const result = retryOnBusy(call)
  if (!result.ok || result.data === undefined) {
    throw new Error(`fixture setup failed: ${result.message ?? 'no data'}`)
  }
  return result.data
}

/** For the void half: a refusal must still stop the fixture rather than build a wrong quiz. */
function must(call: () => { ok: boolean; message?: string }): void {
  const result = retryOnBusy(call)
  if (!result.ok) throw new Error(`fixture setup failed: ${result.message ?? 'refused'}`)
}

export function newQuiz(db: KwizDatabase, name: string): string {
  return unwrap(() => createQuiz(db, { name })).quizId
}

export function newQuestionSetRound(
  db: KwizDatabase,
  quizId: string,
  title: string,
): string {
  return unwrap(() => createRound(db, quizId, { type: 'QUESTION_SET', title })).roundId
}

export interface FreeTextOptions {
  points?: number
  timerMs?: number | null
}

/** A FREE_TEXT question, matched lowercase+trim (D22) — `accepted[0]` is the canonical answer. */
export function addFreeText(
  db: KwizDatabase,
  roundId: string,
  prompt: string,
  accepted: readonly string[],
  options: FreeTextOptions = {},
): string {
  const questionId = unwrap(() => createQuestion(db, roundId)).questionId
  must(() => updateQuestion(db, questionId, { prompt, ...options }))
  must(() => setAcceptedAnswers(db, questionId, accepted))
  return questionId
}

/**
 * A FREE_TEXT question with **no accepted answers** — deliberately broken, for scenario 2: this
 * is the finding pre-flight exists to catch (I5), authored the ordinary way rather than by any
 * special "make it invalid" switch.
 */
export function addUnanswered(db: KwizDatabase, roundId: string, prompt: string): string {
  const questionId = unwrap(() => createQuestion(db, roundId)).questionId
  must(() => updateQuestion(db, questionId, { prompt }))
  return questionId
}

/** Master-only notes (PRD 1 §7 invariant 7) — the canonical "must never reach a player" field. */
export function setMasterNotes(
  db: KwizDatabase,
  questionId: string,
  notes: string,
): void {
  must(() => updateQuestion(db, questionId, { masterNotes: notes }))
}

/** Rewrites one question's prompt in place — used to plant a secret on an existing board tile. */
export function setPrompt(db: KwizDatabase, questionId: string, prompt: string): void {
  must(() => updateQuestion(db, questionId, { prompt }))
}

export interface McOption {
  text: string
  isCorrect: boolean
}

export function addMultipleChoice(
  db: KwizDatabase,
  roundId: string,
  prompt: string,
  options: readonly McOption[],
  extra: FreeTextOptions = {},
): string {
  const questionId = unwrap(() => createQuestion(db, roundId)).questionId
  must(() =>
    updateQuestion(db, questionId, { prompt, answerMethod: 'MULTIPLE_CHOICE', ...extra }),
  )
  must(() => setOptions(db, questionId, options))
  return questionId
}

/**
 * A stand-alone `BUZZER` question. `accepted` names the canonical answer for the review grid
 * and the reveal — the master still adjudicates by ear (PRD 1 §8.4), it is never auto-graded.
 */
export function addBuzzer(
  db: KwizDatabase,
  roundId: string,
  prompt: string,
  accepted: readonly string[] = [],
  extra: FreeTextOptions = {},
): string {
  const questionId = unwrap(() => createQuestion(db, roundId)).questionId
  must(() => updateQuestion(db, questionId, { prompt, answerMethod: 'BUZZER', ...extra }))
  if (accepted.length > 0) must(() => setAcceptedAnswers(db, questionId, accepted))
  return questionId
}

export function addDo(
  db: KwizDatabase,
  roundId: string,
  prompt: string,
  config: {
    scoringMode: 'WINNER_TAKES_ALL' | 'PER_TEAM_SCORE'
    tiePayout?: 'SPLIT' | 'FULL'
  },
  extra: FreeTextOptions = {},
): string {
  const questionId = unwrap(() => createQuestion(db, roundId)).questionId
  must(() =>
    updateQuestion(db, questionId, {
      prompt,
      answerMethod: 'DO',
      // `tiePayout` defaults to 'FULL' in the schema (D24), but the *inferred* config type
      // requires it explicitly once the default is applied — so it is filled in here rather
      // than left for zod to do silently.
      config: { scoringMode: config.scoringMode, tiePayout: config.tiePayout ?? 'FULL' },
      ...extra,
    }),
  )
  return questionId
}

export interface JeopardyTile {
  questionId: string
  categoryId: string
  points: number
  /** The buzzer question's canonical answer — what the master judges the spoken answer against. */
  answer: string
}

/**
 * A Jeopardy board (D34: every tile is `BUZZER`) of `categories.length` × `valueLadder.length`
 * tiles. Returns the flat tile list in board order — category-major, then row — so a spec can
 * address "the 100 in Geography" without re-deriving ids from the UI.
 */
export function addJeopardyRound(
  db: KwizDatabase,
  quizId: string,
  title: string,
  categories: readonly string[],
  valueLadder: readonly number[],
): { roundId: string; tiles: JeopardyTile[] } {
  const roundId = unwrap(() =>
    createRound(db, quizId, { type: 'JEOPARDY', title }),
  ).roundId
  must(() => setValueLadder(db, roundId, valueLadder))

  const tiles: JeopardyTile[] = []
  for (const categoryName of categories) {
    const categoryId = unwrap(() => createCategory(db, roundId, categoryName)).categoryId
    for (const points of valueLadder) {
      const questionId = unwrap(() =>
        createQuestion(db, roundId, { categoryId, points }),
      ).questionId
      const answer = `${categoryName}-${points}-answer`
      must(() =>
        updateQuestion(db, questionId, {
          prompt: `${categoryName} for ${points}`,
          answerMethod: 'BUZZER',
        }),
      )
      must(() => setAcceptedAnswers(db, questionId, [answer]))
      tiles.push({ questionId, categoryId, points, answer })
    }
  }
  return { roundId, tiles }
}

/**
 * The `DSMTW_FINALE` round: exactly one `KEYWORDS` question per call (I17 wants exactly five
 * keywords on it), pinned last by the same rule the authoring UI enforces (PRD 2 §6.1) — this
 * helper does not check that, so a spec adding a round after this one is testing a real bug,
 * not a fixture quirk.
 *
 * **Returns template ids only.** `createGameFromQuiz` copies this whole tree under fresh ids
 * (data model §5, I16's write-once copy) — a keyword's *game* id does not exist until a game is
 * created from this quiz, so there is nothing real to hand back yet. `game.ts`'s
 * `findKeyword`/`findQuestion` resolve the game-side id afterwards, by matching this same
 * `prompt`/`text` against the instantiated `GameContent` tree rather than by index — which
 * stays correct even if a spec's fixture later adds rounds before this one.
 */
export function addFinaleRound(
  db: KwizDatabase,
  quizId: string,
  title: string,
  prompt: string,
  keywords: readonly string[],
): { roundId: string; questionId: string; prompt: string; keywords: readonly string[] } {
  const roundId = unwrap(() =>
    createRound(db, quizId, { type: 'DSMTW_FINALE', title }),
  ).roundId
  const questionId = unwrap(() => createQuestion(db, roundId)).questionId
  must(() => updateQuestion(db, questionId, { prompt, answerMethod: 'KEYWORDS' }))
  must(() => setKeywords(db, questionId, keywords))
  return { roundId, questionId, prompt, keywords }
}
