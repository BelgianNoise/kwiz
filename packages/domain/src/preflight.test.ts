import { describe, expect, it } from 'vitest'

import {
  assignedColour,
  isColourTaken,
  PALETTE_BY_ASSIGNMENT,
  TEAM_PALETTE,
} from './palette'
import { preflight, type PreflightCode } from './preflight'
import { estimatedMinutes, pointsPerSecond, quizPoints, roundPoints } from './quiz'
import type { QuizContent } from './quiz'
import type { RoundContent } from './state'

/**
 * PRD 2 §10 — the check that decides whether a master finds a broken question now or in front of a
 * room. Every rule from a literal tree: no database, no filesystem, no mocks.
 */

const q = (over: Partial<RoundContent['questions'][0]> = {}) => ({
  id: 'q1',
  roundId: 'r1',
  categoryId: null,
  position: 0,
  prompt: 'Capital of France?',
  answerMethod: 'FREE_TEXT' as const,
  points: 10,
  timerMs: null,
  masterNotes: null,
  config: {},
  acceptedAnswers: ['Paris', 'Paris, France'],
  options: [],
  keywords: [],
  media: [],
  ...over,
})

const round = (over: Partial<RoundContent> = {}): RoundContent => ({
  id: 'r1',
  position: 0,
  type: 'QUESTION_SET',
  title: 'Round one',
  defaultPoints: 10,
  defaultTimerMs: 30_000,
  config: {},
  categories: [],
  questions: [q()],
  ...over,
})

const quiz = (rounds: RoundContent[]): QuizContent => ({
  id: 'quiz',
  name: 'Pub Quiz #4',
  description: null,
  revision: 1,
  updatedAt: 0,
  mainScreenColourScheme: 'BROADCAST',
  mainScreenTypography: 'IMPACT',
  rounds,
})

/** The codes reported, so a test names the rule rather than its wording. */
const codes = (report: ReturnType<typeof preflight>): PreflightCode[] =>
  report.findings.map((finding) => finding.code)

const keyword = (index: number, text = `kw ${index}`) => ({
  id: `kw-${index}`,
  position: index,
  text,
  wordLengths: [2, 1],
})

const finaleRound = (over: Partial<RoundContent> = {}): RoundContent => ({
  id: 'fin',
  position: 1,
  type: 'DSMTW_FINALE',
  title: 'Finale',
  defaultPoints: 0,
  defaultTimerMs: null,
  config: { secondsPerPoint: 0.5, penaltySeconds: 20 },
  categories: [],
  questions: [
    q({
      id: 'fq1',
      roundId: 'fin',
      answerMethod: 'KEYWORDS',
      acceptedAnswers: [],
      keywords: [0, 1, 2, 3, 4].map((n) => keyword(n)),
    }),
  ],
  ...over,
})

describe('a healthy quiz', () => {
  it('passes, and counts what it checked', () => {
    const report = preflight(quiz([round()]))

    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
    expect(report.ready).toBe(true)
    expect(report.counts).toEqual({ rounds: 1, questions: 1, attachments: 0 })
  })
})

describe('errors — the data model invariants', () => {
  it('catches a free-text question nothing can match (I5)', () => {
    expect(
      codes(preflight(quiz([round({ questions: [q({ acceptedAnswers: [] })] })]))),
    ).toContain('NO_ACCEPTED_ANSWER')
    // Whitespace is not an answer.
    expect(
      codes(preflight(quiz([round({ questions: [q({ acceptedAnswers: ['  '] })] })]))),
    ).toContain('NO_ACCEPTED_ANSWER')
  })

  it('catches multiple choice without exactly one correct option (I4)', () => {
    const options = (correct: number[], count = 3) =>
      Array.from({ length: count }, (_, index) => ({
        id: `o${index}`,
        position: index,
        text: `Option ${index}`,
        isCorrect: correct.includes(index),
      }))

    const check = (correct: number[], count?: number) =>
      codes(
        preflight(
          quiz([
            round({
              questions: [
                q({ answerMethod: 'MULTIPLE_CHOICE', options: options(correct, count) }),
              ],
            }),
          ]),
        ),
      )

    expect(check([])).toContain('MC_NEEDS_ONE_CORRECT')
    expect(check([0, 1])).toContain('MC_NEEDS_ONE_CORRECT')
    // One option is not a choice; five is more than the schema allows.
    expect(check([0], 1)).toContain('MC_NEEDS_ONE_CORRECT')
    expect(check([0], 5)).toContain('MC_NEEDS_ONE_CORRECT')
    expect(check([0])).not.toContain('MC_NEEDS_ONE_CORRECT')
  })

  it('catches a DO question with no scoring mode', () => {
    expect(
      codes(
        preflight(quiz([round({ questions: [q({ answerMethod: 'DO', config: {} })] })])),
      ),
    ).toContain('DO_NO_SCORING_MODE')

    expect(
      codes(
        preflight(
          quiz([
            round({
              questions: [
                q({
                  answerMethod: 'DO',
                  config: { scoringMode: 'WINNER_TAKES_ALL', tiePayout: 'FULL' },
                }),
              ],
            }),
          ]),
        ),
      ),
    ).not.toContain('DO_NO_SCORING_MODE')
  })

  it('catches an empty prompt and a missing attachment file', () => {
    const withMedia = q({
      prompt: '   ',
      media: [
        {
          id: 'att-1',
          kind: 'AUDIO' as const,
          position: 0,
          durationMs: null,
          showOnPlayerDevices: false,
          originalName: 'kid-a.mp3',
          sizeBytes: 4_211_233,
        },
      ],
    })
    const report = preflight(quiz([round({ questions: [withMedia] })]), {
      // Computed by the caller: re-hashing is filesystem work, and this layer cannot do it.
      brokenAttachmentIds: ['att-1'],
    })

    expect(codes(report)).toContain('EMPTY_PROMPT')
    expect(codes(report)).toContain('ATTACHMENT_MISSING')
    expect(report.ready).toBe(false)
  })
})

describe('errors — the finale', () => {
  it('needs exactly five keywords (I17)', () => {
    const four = finaleRound({
      questions: [
        q({
          id: 'fq1',
          answerMethod: 'KEYWORDS',
          acceptedAnswers: [],
          keywords: [0, 1, 2, 3].map((n) => keyword(n)),
        }),
      ],
    })
    expect(codes(preflight(quiz([round(), four])))).toContain('FINALE_KEYWORD_COUNT')
  })

  /**
   * P2 #15 — a distinct code from the row-count check above: five slots exist, but one carries no
   * text, which silently changes the round's arithmetic the same way a missing row would. A
   * master shown `FINALE_KEYWORD_COUNT`'s "found 4, need 5" here would be looking for a missing
   * row that doesn't exist.
   */
  it('needs every one of the five keywords to actually have text', () => {
    const blank = finaleRound({
      questions: [
        q({
          id: 'fq1',
          answerMethod: 'KEYWORDS',
          acceptedAnswers: [],
          keywords: [keyword(0), keyword(1), keyword(2), keyword(3), keyword(4, '  ')],
        }),
      ],
    })
    const report = preflight(quiz([round(), blank]))
    expect(codes(report)).toContain('FINALE_KEYWORD_BLANK')
    expect(codes(report)).not.toContain('FINALE_KEYWORD_COUNT')
  })

  it('must be last, and there can be only one (I20)', () => {
    const notLast = quiz([finaleRound({ position: 0 }), round({ position: 1 })])
    expect(codes(preflight(notLast))).toContain('FINALE_NOT_LAST')

    const two = quiz([
      round(),
      finaleRound({ id: 'fin-a' }),
      finaleRound({ id: 'fin-b', position: 2 }),
    ])
    expect(codes(preflight(two))).toContain('MULTIPLE_FINALES')
  })

  it('needs a conversion rate above zero', () => {
    const noRate = finaleRound({ config: {} })
    expect(codes(preflight(quiz([round(), noRate])))).toContain('FINALE_RATE_MISSING')

    const zero = finaleRound({ config: { secondsPerPoint: 0, penaltySeconds: 20 } })
    expect(codes(preflight(quiz([round(), zero])))).toContain('FINALE_RATE_MISSING')
  })

  it('keeps KEYWORDS inside a finale and out of everything else (I18)', () => {
    const stray = round({ questions: [q({ answerMethod: 'KEYWORDS' })] })
    expect(codes(preflight(quiz([stray])))).toContain('KEYWORDS_OUTSIDE_FINALE')

    const wrongMethod = finaleRound({
      questions: [q({ id: 'fq1', answerMethod: 'FREE_TEXT', keywords: [] })],
    })
    expect(codes(preflight(quiz([round(), wrongMethod])))).toContain(
      'FINALE_QUESTION_NOT_KEYWORDS',
    )
  })
})

describe('warnings — judgement calls, never blocks', () => {
  it('flags a single accepted answer, because matching is exact (D22)', () => {
    const report = preflight(
      quiz([round({ questions: [q({ acceptedAnswers: ['Paris'] })] })]),
    )
    expect(codes(report)).toContain('SINGLE_ACCEPTED_ANSWER')
    // A warning does not stop the master playing.
    expect(report.ready).toBe(true)
  })

  it('flags an empty round and a timer nobody can answer within', () => {
    expect(codes(preflight(quiz([round({ questions: [] })])))).toContain('ROUND_EMPTY')
    expect(
      codes(preflight(quiz([round({ questions: [q({ timerMs: 3_000 })] })]))),
    ).toContain('SHORT_TIMER')
  })

  it('flags uneven Jeopardy columns and the empty tiles in them', () => {
    const tile = (id: string, categoryId: string) =>
      q({ id, categoryId, answerMethod: 'BUZZER', acceptedAnswers: ['x'] })

    const board = round({
      type: 'JEOPARDY',
      config: { valueLadder: [100, 200] },
      categories: [
        { id: 'c1', position: 0, name: 'Film' },
        { id: 'c2', position: 1, name: 'Music' },
      ],
      questions: [tile('t1', 'c1'), tile('t2', 'c1'), tile('t3', 'c2')],
    })

    const report = preflight(quiz([board]))
    expect(codes(report)).toContain('JEOPARDY_UNEVEN_COLUMNS')
    // One tile short of the tallest column.
    expect(
      report.findings.find((f) => f.code === 'JEOPARDY_EMPTY_TILES')?.detail,
    ).toEqual({
      empty: 1,
    })
  })

  /**
   * PRD 4 §9 — *"category names must fit without truncation… PRD 2 §10's pre-flight warns on category
   * names that will not fit here."* The clause existed and the check did not, until slice 6's review
   * round: the board clipped an over-long name and justified it by a safety net nobody had built.
   */
  it('flags a category name too long for a board column, scaled by the column count', () => {
    const tile = (id: string, categoryId: string) =>
      q({ id, categoryId, answerMethod: 'BUZZER', acceptedAnswers: ['x'] })
    // 30 characters. Comfortable across two columns; far too long once there are five, which is
    // §9's own worked example — *"at 5 categories each column is ~18% of width."*
    const name = 'Geography of the Low Countries'

    const two = round({
      type: 'JEOPARDY',
      config: { valueLadder: [100] },
      categories: [
        { id: 'c0', position: 0, name },
        { id: 'c1', position: 1, name: 'Film' },
      ],
      questions: [tile('t0', 'c0'), tile('t1', 'c1')],
    })
    expect(codes(preflight(quiz([two])))).not.toContain('CATEGORY_NAME_TOO_LONG')

    const five = round({
      type: 'JEOPARDY',
      config: { valueLadder: [100] },
      categories: [0, 1, 2, 3, 4].map((i) => ({
        id: `c${i}`,
        position: i,
        name: i === 0 ? name : 'Film',
      })),
      questions: [0, 1, 2, 3, 4].map((i) => tile(`t${i}`, `c${i}`)),
    })

    const report = preflight(quiz([five]))
    expect(codes(report)).toContain('CATEGORY_NAME_TOO_LONG')
    // Five columns share the row's character budget, so each gets a fifth of it.
    expect(
      report.findings.find((f) => f.code === 'CATEGORY_NAME_TOO_LONG')?.detail,
    ).toEqual({ name, max: 28 })
  })

  /**
   * PRD 4 §2.4 — a prompt that would need to go below the `4vh` floor *"does not get smaller"*; it
   * overflows, on the stated understanding that pre-flight objected at authoring time. It had not.
   */
  it('flags a prompt too long to be fitted on the projected screen', () => {
    const wordy = round({ questions: [q({ prompt: 'A very long prompt. '.repeat(20) })] })
    expect(codes(preflight(quiz([wordy])))).toContain('PROMPT_TOO_LONG')

    const ordinary = round({
      questions: [q({ prompt: 'Who released "Kid A" in 2000?' })],
    })
    expect(codes(preflight(quiz([ordinary])))).not.toContain('PROMPT_TOO_LONG')
  })

  it('flags a rate that is almost certainly inverted', () => {
    // 10 points at 0.5 s/pt is five seconds for a team that answered everything correctly.
    const report = preflight(quiz([round(), finaleRound()]))
    expect(codes(report)).toContain('FINALE_RATE_SUSPICIOUS')
  })

  it('flags a finale with fewer questions than the round plausibly needs (D58)', () => {
    // A big quiz, so the banks are real and the suggestion is meaningful.
    const big = round({
      questions: Array.from({ length: 40 }, (_, index) =>
        q({ id: `q${index}`, position: index, points: 10 }),
      ),
    })
    const report = preflight(quiz([big, finaleRound()]), { assumedTeams: 4 })

    const finding = report.findings.find((f) => f.code === 'FINALE_TOO_FEW_QUESTIONS')
    expect(finding?.detail).toMatchObject({ have: 1, teams: 4 })
    expect(Number(finding?.detail?.suggested)).toBeGreaterThan(1)
    // Still playable: over-supplying questions is free, so a shortfall can only ever be advice.
    expect(report.ready).toBe(true)
  })
})

describe('the numbers the editor shows', () => {
  it('totals points per round and per quiz, and never for a finale', () => {
    const scoring = round({
      questions: [q({ points: 10 }), q({ id: 'q2', points: 20 })],
    })
    expect(roundPoints(scoring)).toBe(30)
    // A finale awards seconds, not points (D51) — `0 pts` would read as a mistake.
    expect(roundPoints(finaleRound())).toBeNull()
    expect(quizPoints(quiz([scoring, finaleRound()]))).toBe(30)
  })

  it('estimates a runtime from timers and question counts', () => {
    const ten = round({
      defaultTimerMs: 30_000,
      questions: Array.from({ length: 10 }, (_, index) => q({ id: `q${index}` })),
    })
    // Ten questions at 30 s plus overhead, and a minute for the round itself: minutes, not seconds.
    expect(estimatedMinutes(quiz([ten]))).toBe(14)
    expect(estimatedMinutes(quiz([]))).toBe(0)
  })

  it('inverts the finale rate the way the editor asks for it', () => {
    // PRD 2 §9 asks "[2] points = 1 second"; the event carries 0.5 seconds per point.
    expect(pointsPerSecond(0.5)).toBe(2)
    expect(pointsPerSecond(0)).toBe(0)
  })
})

describe('the team palette', () => {
  it('is conventions §3 in both orders, with nothing lost between them', () => {
    expect(TEAM_PALETTE).toHaveLength(12)
    expect(PALETTE_BY_ASSIGNMENT).toHaveLength(12)
    expect([...PALETTE_BY_ASSIGNMENT].map((c) => c.hex).sort()).toEqual(
      [...TEAM_PALETTE].map((c) => c.hex).sort(),
    )
  })

  it('walks the hue wheel, so four teams are unmistakable from across a room', () => {
    // Red, cyan, amber, violet — not red, orange, amber, lime, which is what the list order gives.
    expect([0, 1, 2, 3].map(assignedColour)).toEqual([
      '#EF4444',
      '#22D3EE',
      '#FBBF24',
      '#A78BFA',
    ])
  })

  it('wraps above twelve rather than running out', () => {
    // Colour is never the sole identifier (conventions §3.2), so a repeat is an annoyance, not an
    // ambiguity — and running out would be worse.
    expect(assignedColour(12)).toBe(assignedColour(0))
    expect(assignedColour(25)).toBe(assignedColour(1))
  })

  it('marks a taken colour case-insensitively', () => {
    expect(isColourTaken('#ef4444', ['#EF4444'])).toBe(true)
    expect(isColourTaken('#22D3EE', ['#EF4444'])).toBe(false)
  })
})
