import type { DraftAnswer, DraftSubmission } from '@kwiz/domain'
import { and, eq } from 'drizzle-orm'

import type { KwizDatabase } from './client'
import { gameAnswerDraft } from './schema'

/**
 * `game_answer_draft` — **the second and final exemption from event sourcing** (protocol §4.8,
 * data model §6.8).
 *
 * A draft is not a game fact: keystroke timing is not reproducible by replay, and twenty teams
 * typing would flood the log for zero replay value. So this table is upserted directly, and it is
 * the only table besides `game_device.lastSeenAt` that `appendAndProject` does not own.
 *
 * It is a **real table rather than memory** because that is the entire point of D8's safety net: a
 * draft has to survive a server restart. It is deliberately not part of `game_answer`, so that
 * table stays a pure projection and I15 (`projection == replay`) holds with no carve-out.
 */

/** Debounced ≈500 ms by the client (`DRAFT_DEBOUNCE_MS`), then shared to the team's devices (D45). */
export function saveDraft(
  database: KwizDatabase,
  draft: {
    gameId: string
    gameQuestionId: string
    teamId: string
    text: string | null
    selectedOptionId: string | null
  },
  at: Date,
): void {
  database.db
    .insert(gameAnswerDraft)
    .values({ ...draft, updatedAt: at })
    .onConflictDoUpdate({
      // The composite primary key `(gameQuestionId, teamId)` makes the upsert natural and enforces
      // one draft per team per question without a separate constraint.
      target: [gameAnswerDraft.gameQuestionId, gameAnswerDraft.teamId],
      set: { text: draft.text, selectedOptionId: draft.selectedOptionId, updatedAt: at },
    })
    .run()
}

/**
 * Every draft this team currently holds, keyed by question — the shape `toPlayerView` takes.
 *
 * Bounded by the number of questions the team has typed in, so it stays well inside the
 * bounded-view rule (protocol §1.1) in practice: a team drafts on the open question, and submitting
 * deletes it.
 */
export function teamDrafts(
  database: KwizDatabase,
  gameId: string,
  teamId: string,
): Map<string, DraftAnswer> {
  const rows = database.db
    .select()
    .from(gameAnswerDraft)
    .where(and(eq(gameAnswerDraft.gameId, gameId), eq(gameAnswerDraft.teamId, teamId)))
    .all()

  return new Map(
    rows.map((row) => [
      row.gameQuestionId,
      { text: row.text, optionId: row.selectedOptionId },
    ]),
  )
}

/** The drafts `QUESTION_LOCKED` has to commit (protocol §4.3), for one question, all teams. */
export function questionDrafts(
  database: KwizDatabase,
  gameQuestionId: string,
): DraftSubmission[] {
  return database.db
    .select()
    .from(gameAnswerDraft)
    .where(eq(gameAnswerDraft.gameQuestionId, gameQuestionId))
    .all()
    .map((row) => ({
      teamId: row.teamId,
      text: row.text,
      selectedOptionId: row.selectedOptionId,
    }))
}

/**
 * **Submitting deletes the team's draft** (protocol §4.3), so a stale draft can never resurface at
 * lock. Draft commitment therefore only ever applies to teams that never submitted at all.
 */
export function deleteDraft(
  database: KwizDatabase,
  gameQuestionId: string,
  teamId: string,
): void {
  database.db
    .delete(gameAnswerDraft)
    .where(
      and(
        eq(gameAnswerDraft.gameQuestionId, gameQuestionId),
        eq(gameAnswerDraft.teamId, teamId),
      ),
    )
    .run()
}
