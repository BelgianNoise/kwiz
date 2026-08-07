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

/**
 * Narrows to the payload, so a test reads `.quizId` without three lines of ceremony.
 *
 * The ids come back as `unknown` because `runAuthoring` is deliberately untyped per action — the
 * dispatch table returns whatever its repository returns. Reading the one field each test needs off
 * a record is honest about that, and fails loudly if the shape is not what the test assumed.
 */
function idFrom(result: ReturnType<typeof run>, key: string): string {
  if (!result.ok || result.data === undefined) {
    throw new Error(`expected data, got ${JSON.stringify(result)}`)
  }
  const record: Record<string, unknown> = { ...result.data }
  const value = record[key]
  if (typeof value !== 'string') {
    throw new Error(`expected ${key} on ${JSON.stringify(result.data)}`)
  }
  return value
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
    const quizId = idFrom(run('quizzes', { name: 'Pub Quiz #4' }), 'quizId')
    const roundId = idFrom(
      run(`quizzes/${quizId}/rounds`, { type: 'QUESTION_SET', title: 'Warm-up' }),
      'roundId',
    )
    const questionId = idFrom(run(`rounds/${roundId}/questions`), 'questionId')
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
    const quizId = idFrom(run('quizzes', { name: 'Q' }), 'quizId')
    const roundId = idFrom(
      run(`quizzes/${quizId}/rounds`, { type: 'JEOPARDY', title: 'Board' }),
      'roundId',
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
    const quizId = idFrom(run('quizzes', { name: 'Q' }), 'quizId')
    run(`quizzes/${quizId}/rounds`, { type: 'DSMTW_FINALE', title: 'Finale' })

    // The repository owns §6.1; this only checks the refusal reaches the caller intact.
    expect(
      run(`quizzes/${quizId}/rounds`, { type: 'DSMTW_FINALE', title: 'Another' }),
    ).toMatchObject({ ok: false, error: 'VALIDATION_ERROR' })
  })

  it('insists on exactly five keywords at the boundary (I17)', () => {
    const quizId = idFrom(run('quizzes', { name: 'Q' }), 'quizId')
    const roundId = idFrom(
      run(`quizzes/${quizId}/rounds`, { type: 'DSMTW_FINALE', title: 'Finale' }),
      'roundId',
    )
    const questionId = idFrom(run(`rounds/${roundId}/questions`), 'questionId')
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
