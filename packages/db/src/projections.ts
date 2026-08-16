import {
  gradeFreeText,
  gradeMultipleChoice,
  verdictAwardsPoints,
  type AnswerVerdict,
  type GameEvent,
} from '@kwiz/domain'
import { and, eq, isNull, sql } from 'drizzle-orm'

import type { KwizTx } from './client'
import {
  game,
  gameAcceptedAnswer,
  gameAnswer,
  gameBuzz,
  gameDevice,
  gameKeywordMark,
  gameQuestion,
  gameQuestionKeyword,
  gameQuestionOption,
  gameScoreAdjustment,
  gameTeam,
} from './schema'

/**
 * The derived half of `appendAndProject` (data model §6.4.1). **Never called from anywhere
 * else**: a projection write without its event is the drift this design exists to prevent.
 *
 * Most event types project nothing. Live in-flight state — current round and question, the
 * lifecycle state, timer deadlines, lockout sets, the Jeopardy picker, who is connected — lives
 * *only* in the in-memory projection (§1.1), because persisting a derivable fact creates a
 * second source of truth for it.
 *
 * **Auto-grading calls `@kwiz/domain`'s matcher, never a local copy.** A `FREE_TEXT` or
 * `MULTIPLE_CHOICE` verdict is computed from the submission plus the accepted answers (protocol
 * §4), and `packages/domain`'s reducer computes exactly the same thing for the pushed views. Two
 * implementations would drift, and the symptom would be nasty: master control calling a team
 * correct and scoring while the review screen still calls it pending. `projection-parity.test.ts`
 * asserts the two agree.
 */
export function applyProjection(
  tx: KwizTx,
  gameId: string,
  event: GameEvent,
  at: Date,
): void {
  switch (event.type) {
    // ─── game ───

    case 'CODE_REGENERATED':
      tx.update(game).set({ code: event.payload.code }).where(eq(game.id, gameId)).run()
      return

    case 'GAME_RESYNCED':
      tx.update(game)
        .set({ quizRevision: event.payload.quizRevision })
        .where(eq(game.id, gameId))
        .run()
      return

    case 'GAME_STARTED':
      tx.update(game)
        .set({ status: 'LIVE', startedAt: at })
        .where(eq(game.id, gameId))
        .run()
      return

    case 'GAME_FINISHED':
      tx.update(game)
        .set({ status: 'FINISHED', finishedAt: at })
        .where(eq(game.id, gameId))
        .run()
      return

    case 'GAME_ABANDONED':
      tx.update(game)
        .set({ status: 'ABANDONED', finishedAt: at })
        .where(eq(game.id, gameId))
        .run()
      return

    // ─── teams & devices ───

    case 'TEAM_ADDED':
      tx.insert(gameTeam)
        .values({
          id: event.payload.teamId,
          gameId,
          name: event.payload.name,
          colour: event.payload.colour,
          position: event.payload.position,
          // As above: a projection row's timestamps come from its event, not the write clock.
          createdAt: at,
        })
        .run()
      return

    case 'TEAM_UPDATED': {
      const { name, colour } = event.payload
      // Renaming and recolouring is legal at any time, including after the game ends.
      tx.update(gameTeam)
        .set({
          ...(name === undefined ? {} : { name }),
          ...(colour === undefined ? {} : { colour }),
        })
        .where(eq(gameTeam.id, event.payload.teamId))
        .run()
      return
    }

    case 'TEAM_ELIMINATED':
      // `at` comes from the payload, not from now: it is the *computed* instant the clock hit
      // zero, which can be while the team was not on turn (protocol §4.6).
      tx.update(gameTeam)
        .set({ eliminatedAt: new Date(event.payload.at) })
        .where(eq(gameTeam.id, event.payload.teamId))
        .run()
      return

    case 'DEVICE_JOINED':
      // Inserted here, not by the join action: `game_device` is part of the play half, and only
      // `lastSeenAt` is exempt from the log (§1, protocol §4.8). The D20 cap is enforced by the
      // action before the event is appended.
      tx.insert(gameDevice)
        .values({
          id: event.payload.deviceId,
          gameId,
          teamId: event.payload.teamId,
          deviceToken: event.payload.deviceToken,
          firstSeenAt: at,
          lastSeenAt: at,
        })
        .run()
      return

    case 'DEVICE_SWITCHED_TEAM':
      tx.update(gameDevice)
        .set({ teamId: event.payload.toTeamId })
        .where(eq(gameDevice.id, event.payload.deviceId))
        .run()
      return

    // ─── answers ───

    case 'ANSWER_SUBMITTED': {
      const p = event.payload
      const graded = autoGrade(tx, p.gameQuestionId, p.text, p.selectedOptionId)
      tx.insert(gameAnswer)
        .values({
          gameId,
          gameQuestionId: p.gameQuestionId,
          teamId: p.teamId,
          text: p.text ?? null,
          selectedOptionId: p.selectedOptionId ?? null,
          // D26: a submission committed from a stored draft at lock was never confirmed by
          // the team, and review says so.
          isDraft: p.fromDraft,
          submittedAt: at,
          enteredByMaster: p.enteredByMaster,
          verdict: graded.verdict,
          pointsAwarded: graded.pointsAwarded,
        })
        .onConflictDoUpdate({
          // The one legitimate overwrite is the master answering for a team (D47). It re-grades
          // from scratch, because the answer genuinely changed. First-write-wins for *players*
          // (D43) is enforced by the action, before any event is appended.
          target: [gameAnswer.gameId, gameAnswer.gameQuestionId, gameAnswer.teamId],
          set: {
            text: p.text ?? null,
            selectedOptionId: p.selectedOptionId ?? null,
            isDraft: p.fromDraft,
            submittedAt: at,
            enteredByMaster: p.enteredByMaster,
            verdict: graded.verdict,
            pointsAwarded: graded.pointsAwarded,
            validatedAt: null,
          },
        })
        .run()
      recomputeScore(tx, gameId, p.teamId)
      return
    }

    case 'ANSWER_VALIDATED': {
      const p = event.payload
      const points = questionPoints(tx, p.gameQuestionId)
      tx.update(gameAnswer)
        .set({
          verdict: p.accepted ? 'ACCEPTED' : 'DENIED',
          // I8: points only ever accompany an accepting verdict.
          pointsAwarded: p.accepted ? points : 0,
          validatedAt: at,
        })
        .where(
          and(
            eq(gameAnswer.gameQuestionId, p.gameQuestionId),
            eq(gameAnswer.teamId, p.teamId),
          ),
        )
        .run()
      recomputeScore(tx, gameId, p.teamId)
      return
    }

    case 'QUESTION_SKIPPED': {
      // I8, D46: "awards nothing to anyone" must be *enforced*, not assumed — a question
      // skipped from OPEN may already hold auto-graded answers carrying points. Verdicts are
      // deliberately retained for the record.
      tx.update(gameAnswer)
        .set({ pointsAwarded: 0 })
        .where(eq(gameAnswer.gameQuestionId, event.payload.gameQuestionId))
        .run()
      recomputeAllScores(tx, gameId)
      return
    }

    case 'DO_WINNERS_SET': {
      const p = event.payload
      const points = questionPoints(tx, p.gameQuestionId)
      const share =
        p.teamIds.length > 1 && p.tiePayout === 'SPLIT'
          ? Math.floor(points / p.teamIds.length) // integers only (D24)
          : points

      // `teamIds: []` is the explicit "nobody got it" (D23), which still resolves every team
      // to zero rather than leaving them pending.
      tx.update(gameAnswer)
        .set({ verdict: 'DENIED', pointsAwarded: 0, validatedAt: at })
        .where(eq(gameAnswer.gameQuestionId, p.gameQuestionId))
        .run()

      for (const teamId of p.teamIds) {
        upsertOutcome(tx, gameId, p.gameQuestionId, teamId, share, at)
      }
      recomputeAllScores(tx, gameId)
      return
    }

    case 'DO_SCORES_SET': {
      const p = event.payload
      const max = questionPoints(tx, p.gameQuestionId)
      for (const { teamId, score } of p.scores) {
        // Clamped to 0…points (D24). Clamping here as well as in the action means a payload
        // written by an older build cannot inflate a score on replay.
        upsertOutcome(
          tx,
          gameId,
          p.gameQuestionId,
          teamId,
          Math.min(Math.max(score, 0), max),
          at,
        )
      }
      recomputeAllScores(tx, gameId)
      return
    }

    // ─── buzzer ───

    case 'BUZZ_RECEIVED': {
      /*
       * **`AWAITING` unless one is already being adjudicated** — I10 allows only one `AWAITING` per
       * question, and a buzz arriving during adjudication is recorded as `NOT_FIRST` (protocol
       * §4.4).
       *
       * Derived here rather than taken from the payload, because `@kwiz/domain`'s reducer derives
       * exactly the same thing the same way. An earlier version of this wrote `AWAITING`
       * unconditionally and left the distinction to "the action", which no payload field could
       * carry — so the two halves disagreed about who was first the moment two teams buzzed
       * together.
       */
      const adjudicating = tx
        .select({ id: gameBuzz.id })
        .from(gameBuzz)
        .where(
          and(
            eq(gameBuzz.gameQuestionId, event.payload.gameQuestionId),
            eq(gameBuzz.outcome, 'AWAITING'),
          ),
        )
        .get()

      tx.insert(gameBuzz)
        .values({
          id: event.payload.buzzId,
          gameId,
          gameQuestionId: event.payload.gameQuestionId,
          teamId: event.payload.teamId,
          receivedAt: new Date(event.payload.receivedAt),
          offsetMs: event.payload.offsetMs,
          outcome: adjudicating ? 'NOT_FIRST' : 'AWAITING',
        })
        .run()
      return
    }

    case 'BUZZ_ADJUDICATED': {
      const buzz = tx
        .select({
          teamId: gameBuzz.teamId,
          gameQuestionId: gameBuzz.gameQuestionId,
        })
        .from(gameBuzz)
        .where(eq(gameBuzz.id, event.payload.buzzId))
        .get()

      tx.update(gameBuzz)
        .set({ outcome: event.payload.accepted ? 'ACCEPTED' : 'DENIED' })
        .where(eq(gameBuzz.id, event.payload.buzzId))
        .run()
      if (!buzz) return

      /*
       * **The adjudication is also the scoring** for a buzzer question and every Jeopardy tile
       * (PRD 1 §8.4, D34, D35): the master accepts or denies what was said out loud, and there is
       * no `ANSWER_SUBMITTED` to validate because nothing was typed. `@kwiz/domain`'s reducer
       * credits the team on this event, so this half must too — `projection-parity.test.ts` is
       * what proves they agree.
       */
      upsertOutcome(
        tx,
        gameId,
        buzz.gameQuestionId,
        buzz.teamId,
        event.payload.accepted ? questionPoints(tx, buzz.gameQuestionId) : 0,
        at,
        event.payload.accepted ? 'ACCEPTED' : 'DENIED',
      )
      recomputeScore(tx, gameId, buzz.teamId)
      return
    }

    // ─── finale keywords ───

    case 'KEYWORD_MARKED':
      /*
       * **Upsert, because a revoked row still holds the unique index.**
       *
       * `MARK_KEYWORD` deliberately allows re-marking a keyword whose mark was revoked (decide.ts):
       * the master pressed `Shift`+`n` and is now crediting the right team, which is PRD 3 §10.4's
       * ordinary correction rather than an edge case. The reducer overwrites its map entry; a plain
       * insert here threw `UNIQUE constraint failed` mid-finale instead — a projection that could
       * not represent a state the log can, which is the divergence I15 exists to forbid.
       *
       * `revokedAt: null` is the load-bearing half: the row has to come back to life, not merely
       * change hands, or the clock keeps ignoring a mark that is now real again.
       */
      tx.insert(gameKeywordMark)
        .values({
          gameId,
          gameQuestionId: keywordQuestion(tx, event.payload.gameKeywordId),
          gameKeywordId: event.payload.gameKeywordId,
          teamId: event.payload.teamId,
          markedAt: at,
        })
        .onConflictDoUpdate({
          target: gameKeywordMark.gameKeywordId,
          set: { teamId: event.payload.teamId, markedAt: at, revokedAt: null },
        })
        .run()
      return

    case 'KEYWORD_UNMARKED':
      // Revoked, never deleted (D41) — and here the revocation must also reverse the penalty
      // it charged every other team, which the derived clock handles by ignoring revoked marks.
      tx.update(gameKeywordMark)
        .set({ revokedAt: at })
        .where(eq(gameKeywordMark.gameKeywordId, event.payload.gameKeywordId))
        .run()
      return

    case 'KEYWORDS_REVEALED': {
      // A row per still-unmarked keyword with `teamId: null` (I21), so review can tell
      // "nobody got it" from "we never reached that question".
      const unmarked = tx
        .select({ id: gameQuestionKeyword.id })
        .from(gameQuestionKeyword)
        .where(eq(gameQuestionKeyword.gameQuestionId, event.payload.gameQuestionId))
        .all()
        .filter(
          ({ id }) =>
            !tx
              .select({ id: gameKeywordMark.id })
              .from(gameKeywordMark)
              .where(
                and(
                  eq(gameKeywordMark.gameKeywordId, id),
                  isNull(gameKeywordMark.revokedAt),
                ),
              )
              .get(),
        )

      for (const { id } of unmarked) {
        // Same upsert as `KEYWORD_MARKED`, and reachable by the same route: a keyword marked and
        // then un-marked has no *live* mark, so the reveal covers it — over a revoked row that is
        // still occupying the unique index.
        tx.insert(gameKeywordMark)
          .values({
            gameId,
            gameQuestionId: event.payload.gameQuestionId,
            gameKeywordId: id,
            teamId: null,
            markedAt: at,
          })
          .onConflictDoUpdate({
            target: gameKeywordMark.gameKeywordId,
            set: { teamId: null, markedAt: at, revokedAt: null },
          })
          .run()
      }
      return
    }

    // ─── score adjustments ───

    case 'SCORE_ADJUSTED':
      tx.insert(gameScoreAdjustment)
        .values({
          // From the payload, not the column default: a rebuild must reproduce this id or the
          // matching SCORE_ADJUSTMENT_REVOKED finds nothing (I15).
          id: event.payload.adjustmentId,
          gameId,
          teamId: event.payload.teamId,
          delta: event.payload.delta,
          reason: event.payload.reason ?? null,
          announced: event.payload.announced,
          // From the event, never `new Date()`: the column's default would stamp *now* on a
          // rebuild and rewrite when the adjustment happened (I15).
          createdAt: at,
        })
        .run()
      recomputeScore(tx, gameId, event.payload.teamId)
      return

    case 'SCORE_ADJUSTMENT_REVOKED': {
      // Re-revoking is a no-op: the filter on `revokedAt IS NULL` makes it one.
      tx.update(gameScoreAdjustment)
        .set({ revokedAt: at })
        .where(
          and(
            eq(gameScoreAdjustment.id, event.payload.adjustmentId),
            isNull(gameScoreAdjustment.revokedAt),
          ),
        )
        .run()
      recomputeAllScores(tx, gameId)
      return
    }

    default:
      // Everything else is live state, held only in memory (§1.1). Listing them would be a
      // second place to forget one; the exhaustive `GameEvent` union means an unhandled *new*
      // type still reaches here deliberately rather than by omission.
      return
  }
}

// ─── helpers ───

/**
 * The verdict and points a submission resolves to on its own, via `@kwiz/domain`'s matcher.
 *
 * A `FREE_TEXT` non-match lands on `PENDING`, **never** `AUTO_WRONG` (D22): the machine may only
 * ever be right, because a human is standing right there. `BUZZER` and `DO` are never auto-graded —
 * nothing was typed.
 */
function autoGrade(
  tx: KwizTx,
  gameQuestionId: string,
  text: string | undefined,
  selectedOptionId: string | undefined,
): { verdict: AnswerVerdict; pointsAwarded: number } {
  const question = tx
    .select({ answerMethod: gameQuestion.answerMethod, points: gameQuestion.points })
    .from(gameQuestion)
    .where(eq(gameQuestion.id, gameQuestionId))
    .get()
  if (!question) return { verdict: 'PENDING', pointsAwarded: 0 }

  let verdict: AnswerVerdict = 'PENDING'

  if (question.answerMethod === 'FREE_TEXT') {
    const accepted = tx
      .select({ text: gameAcceptedAnswer.text })
      .from(gameAcceptedAnswer)
      .where(eq(gameAcceptedAnswer.gameQuestionId, gameQuestionId))
      .all()
      .map((row) => row.text)
    verdict = gradeFreeText(text, accepted)
  } else if (question.answerMethod === 'MULTIPLE_CHOICE') {
    const correct = tx
      .select({ id: gameQuestionOption.id })
      .from(gameQuestionOption)
      .where(
        and(
          eq(gameQuestionOption.gameQuestionId, gameQuestionId),
          eq(gameQuestionOption.isCorrect, true),
        ),
      )
      .get()
    // A question with no correct option is a pre-flight failure (I4), not something to guess at.
    verdict = correct ? gradeMultipleChoice(selectedOptionId, correct.id) : 'PENDING'
  }

  return { verdict, pointsAwarded: verdictAwardsPoints(verdict) ? question.points : 0 }
}

function questionPoints(tx: KwizTx, gameQuestionId: string): number {
  const row = tx
    .select({ points: gameQuestion.points })
    .from(gameQuestion)
    .where(eq(gameQuestion.id, gameQuestionId))
    .get()
  return row?.points ?? 0
}

function keywordQuestion(tx: KwizTx, gameKeywordId: string): string {
  const row = tx
    .select({ gameQuestionId: gameQuestionKeyword.gameQuestionId })
    .from(gameQuestionKeyword)
    .where(eq(gameQuestionKeyword.id, gameKeywordId))
    .get()
  if (!row) throw new Error(`Unknown game_question_keyword ${gameKeywordId}`)
  return row.gameQuestionId
}

/**
 * `DO` questions reuse `game_answer` (§6.5): nothing is typed, but a team's *outcome* is still
 * per-question-per-team. A parallel table would duplicate scoring logic and every review query.
 */
function upsertOutcome(
  tx: KwizTx,
  gameId: string,
  gameQuestionId: string,
  teamId: string,
  pointsAwarded: number,
  at: Date,
  verdict: AnswerVerdict = 'ACCEPTED',
): void {
  tx.insert(gameAnswer)
    .values({
      gameId,
      gameQuestionId,
      teamId,
      isDraft: false,
      verdict,
      pointsAwarded,
      validatedAt: at,
    })
    .onConflictDoUpdate({
      target: [gameAnswer.gameId, gameAnswer.gameQuestionId, gameAnswer.teamId],
      set: { verdict, pointsAwarded, validatedAt: at, isDraft: false },
    })
    .run()
}

/**
 * I9: `score = sum(pointsAwarded) + sum(non-revoked adjustments)`, **always**.
 *
 * Recomputed from the projections rather than incremented, so the invariant cannot drift by a
 * missed delta. Both sums are indexed and a game is ~100–200 rows (PRD 1 §2.1), so the cost is
 * irrelevant at this scale and the correctness is free.
 */
export function recomputeScore(tx: KwizTx, gameId: string, teamId: string): void {
  const answers =
    tx
      .select({ total: sql<number>`coalesce(sum(${gameAnswer.pointsAwarded}), 0)` })
      .from(gameAnswer)
      .where(and(eq(gameAnswer.gameId, gameId), eq(gameAnswer.teamId, teamId)))
      .get()?.total ?? 0

  const adjustments =
    tx
      .select({ total: sql<number>`coalesce(sum(${gameScoreAdjustment.delta}), 0)` })
      .from(gameScoreAdjustment)
      .where(
        and(
          eq(gameScoreAdjustment.gameId, gameId),
          eq(gameScoreAdjustment.teamId, teamId),
          isNull(gameScoreAdjustment.revokedAt),
        ),
      )
      .get()?.total ?? 0

  tx.update(gameTeam)
    .set({ score: answers + adjustments })
    .where(eq(gameTeam.id, teamId))
    .run()
}

function recomputeAllScores(tx: KwizTx, gameId: string): void {
  for (const { id } of tx
    .select({ id: gameTeam.id })
    .from(gameTeam)
    .where(eq(gameTeam.gameId, gameId))
    .all()) {
    recomputeScore(tx, gameId, id)
  }
}
