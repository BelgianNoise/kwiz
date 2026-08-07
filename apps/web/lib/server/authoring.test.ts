import { loadQuizTree } from '@kwiz/db'
import { beforeEach, describe, expect, it } from 'vitest'

import { AUTHORING_ROUTES, matchAuthoringRoute, runAuthoring } from './authoring'
import { createTestRuntime, type TestRuntime } from './test-runtime'

/**
 * The authoring boundary: does the path reach the right repository, and does a malformed body stop
 * before it gets there.
 *
 * The rules themselves are tested in `@kwiz/db`, against a database and without HTTP. What is only
 * testable here is the wiring — a route that matches nothing, a schema that lets something through,
 * a mutation that lands on the wrong id.
 */

let runtime: TestRuntime

const run = (path: string, body: unknown = {}) =>
  runAuthoring({ runtime, segments: path.split('/'), body, now: new Date() })

/** Narrows to the payload, so a test reads `.quizId` without three lines of ceremony. */
function data<T>(result: ReturnType<typeof run>): T {
  if (!result.ok || result.data === undefined) {
    throw new Error(`expected data, got ${JSON.stringify(result)}`)
  }
  return result.data as T
}

beforeEach(() => {
  runtime = createTestRuntime()
})

describe('the authoring catalogue', () => {
  it('has a unique path per action, and every one names its parameters', () => {
    const paths = AUTHORING_ROUTES.map((route) => route.pattern.join('/'))
    expect(new Set(paths).size).toBe(paths.length)

    for (const route of AUTHORING_ROUTES) {
      for (const segment of route.pattern) {
        // A parameter is `:name`; anything else is a literal. A typo like `:` alone would match
        // everything at that position and silently route the wrong request.
        if (segment.startsWith(':')) expect(segment.length).toBeGreaterThan(1)
      }
    }
  })

  it('matches by shape and extracts ids', () => {
    expect(matchAuthoringRoute(['questions', 'q-1', 'keywords'])).toMatchObject({
      route: { name: 'question-keywords' },
      params: { questionId: 'q-1' },
    })
    // `quizzes/:quizId` and `quizzes` differ only in length, as do the two round moves.
    expect(matchAuthoringRoute(['quizzes'])?.route.name).toBe('quiz-create')
    expect(matchAuthoringRoute(['quizzes', 'x'])?.route.name).toBe('quiz-update')
    expect(matchAuthoringRoute(['quizzes', 'x', 'nope'])).toBeUndefined()
  })
})

describe('running an action', () => {
  it('creates a quiz, a round and a question, and reads them back as a tree', () => {
    const { quizId } = data<{ quizId: string }>(run('quizzes', { name: 'Pub Quiz #4' }))
    const { roundId } = data<{ roundId: string }>(
      run(`quizzes/${quizId}/rounds`, { type: 'QUESTION_SET', title: 'Warm-up' }),
    )
    const { questionId } = data<{ questionId: string }>(
      run(`rounds/${roundId}/questions`),
    )

    run(`questions/${questionId}`, { prompt: 'Capital of France?', points: 20 })
    run(`questions/${questionId}/accepted-answers`, { answers: ['Paris'] })

    const tree = loadQuizTree(runtime.database, quizId)
    expect(tree?.rounds[0]?.questions[0]).toMatchObject({
      prompt: 'Capital of France?',
      points: 20,
      acceptedAnswers: ['Paris'],
    })
  })

  it('refuses an unknown path, and a body that does not match', () => {
    expect(run('quizzes/x/explode')).toMatchObject({
      ok: false,
      error: 'VALIDATION_ERROR',
    })
    // A quiz needs a name; an empty one is a refusal rather than an unnamed quiz.
    expect(run('quizzes', { name: '' })).toMatchObject({ ok: false })
    expect(run('quizzes', {})).toMatchObject({ ok: false })
  })

  it('checks a round config against that round’s own type (I6)', () => {
    const { quizId } = data<{ quizId: string }>(run('quizzes', { name: 'Q' }))
    const { roundId } = data<{ roundId: string }>(
      run(`quizzes/${quizId}/rounds`, { type: 'JEOPARDY', title: 'Board' }),
    )

    // A finale's config on a Jeopardy round: the shape is one of the three, so the boundary lets it
    // through — and the repository, which knows the round's type, does not.
    expect(
      run(`rounds/${roundId}`, { config: { secondsPerPoint: 0.5, penaltySeconds: 20 } }),
    ).toMatchObject({ ok: false, error: 'VALIDATION_ERROR' })

    expect(
      run(`rounds/${roundId}`, { config: { valueLadder: [100, 200] } }),
    ).toMatchObject({
      ok: true,
    })
  })

  it('sends the finale rules through, rather than restating them here', () => {
    const { quizId } = data<{ quizId: string }>(run('quizzes', { name: 'Q' }))
    run(`quizzes/${quizId}/rounds`, { type: 'DSMTW_FINALE', title: 'Finale' })

    // The repository owns §6.1; this only checks the refusal reaches the caller intact.
    expect(
      run(`quizzes/${quizId}/rounds`, { type: 'DSMTW_FINALE', title: 'Another' }),
    ).toMatchObject({ ok: false, error: 'VALIDATION_ERROR' })
  })

  it('insists on exactly five keywords at the boundary (I17)', () => {
    const { quizId } = data<{ quizId: string }>(run('quizzes', { name: 'Q' }))
    const { roundId } = data<{ roundId: string }>(
      run(`quizzes/${quizId}/rounds`, { type: 'DSMTW_FINALE', title: 'Finale' }),
    )
    const { questionId } = data<{ questionId: string }>(
      run(`rounds/${roundId}/questions`),
    )

    expect(
      run(`questions/${questionId}/keywords`, { keywords: ['a', 'b'] }),
    ).toMatchObject({
      ok: false,
    })
    expect(
      run(`questions/${questionId}/keywords`, {
        keywords: ['Thriller', 'Bad', 'Billie Jean', 'Moonwalk', ''],
      }),
    ).toMatchObject({ ok: true })

    // Stored on write (I19): the shape is what the room sees, and the filter must never load `text`.
    const keywords = loadQuizTree(runtime.database, quizId)?.rounds[0]?.questions[0]
      ?.keywords
    expect(keywords?.[2]?.wordLengths).toEqual([6, 4])
  })
})
