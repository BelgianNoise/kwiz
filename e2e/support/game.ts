import {
  appendAndProject,
  createGameFromQuiz,
  loadGameContent,
  type KwizDatabase,
} from '@kwiz/db'
import type { GameContent, QuestionContent, RoundContent } from '@kwiz/domain'
import type { GameEvent } from '@kwiz/domain'

import { freshCode, PALETTE, retryOnBusy } from './db'

/** Thunk-taking for the same reason as `quiz.ts`'s — see `retryOnBusy`. */
function unwrap<T>(call: () => { ok: boolean; data?: T; message?: string }): T {
  const result = retryOnBusy(call)
  if (!result.ok || result.data === undefined) {
    throw new Error(`fixture setup failed: ${result.message ?? 'no data'}`)
  }
  return result.data
}

export interface FixtureGame {
  gameId: string
  code: string
  /** In authored team order, matching the `teams` argument that created them. */
  teamIds: string[]
}

/**
 * Instantiates a game from a template quiz — `createGameFromQuiz`, the same call PRD 2 §11's
 * game-setup form makes, taken directly rather than through that screen (build-order slice 9's
 * third determinism rule: game *setup* is not what any of these 27 scenarios are testing).
 *
 * Teams take PRD 1 §9.3's resolved palette in order, never an invented colour or a bare index —
 * names are never identifiers either way (CLAUDE.md §2.7).
 */
export function createGame(
  db: KwizDatabase,
  quizId: string,
  teamNames: readonly string[],
  options: { finale?: { secondsPerPoint: number; penaltySeconds: number } } = {},
): FixtureGame {
  const code = freshCode()
  const created = unwrap(() =>
    createGameFromQuiz(db, {
      quizId,
      code,
      defaultPlayerLocale: 'en',
      teams: teamNames.map((name, i) => ({
        name,
        colour: PALETTE[i % PALETTE.length] ?? '#EF4444',
      })),
    }),
  )

  // D54 — the live rate and penalty are an event, never authored into the game copy (I16).
  // Optional because most scenarios have no finale round at all.
  // Bound outside the closure so the narrowing survives into it.
  const finale = options.finale
  if (finale) {
    retryOnBusy(() =>
      appendAndProject(db, created.gameId, [
        { type: 'FINALE_CONFIGURED', payload: finale },
      ]),
    )
  }

  return { gameId: created.gameId, code, teamIds: created.teamIds }
}

/** The game's own copy of its content tree — every id from here on is the game's, not the template's. */
export function gameContent(db: KwizDatabase, gameId: string): GameContent {
  const content = loadGameContent(db, gameId)
  if (!content) throw new Error(`fixture error: no game content for ${gameId}`)
  return content
}

/**
 * Finds a round **by its authored title**, never by position — a spec that inserts an extra
 * round for its own purposes must not silently shift every other lookup in the same file.
 */
export function findRound(content: GameContent, title: string): RoundContent {
  const round = content.rounds.find((candidate) => candidate.title === title)
  if (!round) throw new Error(`fixture error: no round titled "${title}"`)
  return round
}

/** Finds a question **by its authored prompt**, for the same reason `findRound` matches by title. */
export function findQuestion(content: GameContent, prompt: string): QuestionContent {
  for (const round of content.rounds) {
    const question = round.questions.find((candidate) => candidate.prompt === prompt)
    if (question) return question
  }
  throw new Error(`fixture error: no question prompted "${prompt}"`)
}

/**
 * A finale keyword's **game-side** id, found by the text it was authored with. This is the id
 * `KEYWORD_MARKED`/`KEYWORD_UNMARKED` need — `quiz.ts`'s `addFinaleRound` cannot hand it out,
 * because it runs before any game (and therefore any game-copy id) exists.
 */
export function findKeyword(question: QuestionContent, text: string): string {
  const keyword = question.keywords.find((candidate) => candidate.text === text)
  if (!keyword) throw new Error(`fixture error: no keyword "${text}" on this question`)
  return keyword.id
}

/**
 * A Jeopardy tile's game-side question id, found by category name and points — the same two
 * facts a room reads a tile by, never by row/column index.
 */
export function findTile(
  content: GameContent,
  category: string,
  points: number,
): QuestionContent {
  for (const round of content.rounds) {
    const cat = round.categories.find((candidate) => candidate.name === category)
    if (!cat) continue
    const tile = round.questions.find(
      (candidate) => candidate.categoryId === cat.id && candidate.points === points,
    )
    if (tile) return tile
  }
  throw new Error(`fixture error: no tile "${category}" at ${points}`)
}

/**
 * The one escape hatch for appending events directly rather than through the UI — used only
 * where no UI path exists at all (PRD 3's own control desk relies on server-computed values
 * like `TEAM_ELIMINATED.at`, which a spec cannot type into a form) or where build-order slice 9
 * explicitly calls for it (§22's "kill and restart the server mid-game" needs a fact to have
 * happened *before* the kill, not a UI flow to drive around the restart itself).
 */
export function appendEvents(
  db: KwizDatabase,
  gameId: string,
  events: GameEvent[],
): void {
  retryOnBusy(() => appendAndProject(db, gameId, events))
}
