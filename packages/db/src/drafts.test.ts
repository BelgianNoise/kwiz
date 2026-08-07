import { beforeEach, describe, expect, it } from 'vitest'

import type { KwizDatabase } from './client'
import { deleteDraft, questionDrafts, saveDraft, teamDrafts } from './drafts'
import { freshTestDatabase, seedGame, type SeededGame } from './test-support'

/**
 * `game_answer_draft` — the D8 safety net and the second event-sourcing exemption (protocol §4.8).
 *
 * What matters here is the shape D45 needs: one draft per `(question, team)`, shared across every one
 * of that team's devices, and gone the moment the team submits so a stale draft cannot resurface at
 * lock.
 */

let database: KwizDatabase
let seed: SeededGame

beforeEach(() => {
  database = freshTestDatabase()
  seed = seedGame(database)
})

const at = new Date(1_000)

describe('drafts', () => {
  it('keeps one per team per question, upserted rather than appended', () => {
    saveDraft(
      database,
      {
        gameId: seed.gameId,
        gameQuestionId: seed.questionId,
        teamId: seed.teamA,
        text: 'par',
        selectedOptionId: null,
      },
      at,
    )
    saveDraft(
      database,
      {
        gameId: seed.gameId,
        gameQuestionId: seed.questionId,
        teamId: seed.teamA,
        text: 'paris',
        selectedOptionId: null,
      },
      new Date(2_000),
    )

    // The composite primary key is what makes this one row rather than two, with no extra constraint.
    expect(questionDrafts(database, seed.questionId)).toEqual([
      { teamId: seed.teamA, text: 'paris', selectedOptionId: null },
    ])
  })

  it('reads back keyed by question — the shape toPlayerView takes', () => {
    saveDraft(
      database,
      {
        gameId: seed.gameId,
        gameQuestionId: seed.questionId,
        teamId: seed.teamA,
        text: 'paris',
        selectedOptionId: null,
      },
      at,
    )

    // Every device on team A gets this, which is the whole of D45.
    expect(teamDrafts(database, seed.gameId, seed.teamA)).toEqual(
      new Map([[seed.questionId, { text: 'paris', optionId: null }]]),
    )
    // And nothing of team B's — a draft belongs to `(question, team)`.
    expect(teamDrafts(database, seed.gameId, seed.teamB).size).toBe(0)
  })

  it('is deleted on submission, so lock cannot commit a stale one', () => {
    for (const teamId of [seed.teamA, seed.teamB]) {
      saveDraft(
        database,
        {
          gameId: seed.gameId,
          gameQuestionId: seed.questionId,
          teamId,
          text: 'typing',
          selectedOptionId: null,
        },
        at,
      )
    }

    deleteDraft(database, seed.questionId, seed.teamA)

    expect(questionDrafts(database, seed.questionId)).toEqual([
      { teamId: seed.teamB, text: 'typing', selectedOptionId: null },
    ])
  })
})
