import { doConfigSchema, dsmtwFinaleRoundConfigSchema } from './content-config'
import { suggestFinaleQuestions } from './derive'
import { quizPoints, secondsForScore, type QuizContent } from './quiz'
import type { QuestionContent, RoundContent } from './state'

/**
 * PRD 2 §10 — the check run when `[Play]` is pressed.
 *
 * It exists because of PRD 2 §1.1: the master is fifteen minutes from doors open, and **the moment
 * to discover a missing correct answer is now, not in front of a room.**
 *
 * Pure, so every rule is testable from a literal tree. The one check that cannot be pure — does the
 * attachment's file still exist on disk, and does it still hash to the same thing (data model §8) —
 * is passed **in**, computed by the caller that owns the filesystem. That keeps this layer honest
 * about what it can prove and makes the expensive check optional at authoring time.
 *
 * **Findings carry a code, never a sentence.** Copy lives in the messages module keyed by that code
 * (D11), which is also what lets a test assert on the rule rather than on its wording.
 */
export type PreflightSeverity = 'ERROR' | 'WARNING'

export const PREFLIGHT_CODES = [
  // ─── errors: the data model's invariants ───
  'EMPTY_PROMPT',
  /** I5 — a free-text question nothing can ever match. */
  'NO_ACCEPTED_ANSWER',
  /** I4 — 2–4 options with exactly one correct. */
  'MC_NEEDS_ONE_CORRECT',
  'DO_NO_SCORING_MODE',
  /** data model §8 — the file is gone, or no longer hashes to its checksum. */
  'ATTACHMENT_MISSING',
  // ─── errors: DSMTW_FINALE (D50) ───
  /** I17 — a four-keyword question silently changes the round's arithmetic. */
  'FINALE_KEYWORD_COUNT',
  /** I20 — two finales is undefined; points can only be spent once. */
  'MULTIPLE_FINALES',
  /** I20 — anything after a finale has nothing to score. */
  'FINALE_NOT_LAST',
  /** A zero rate gives every team zero seconds and ends the round instantly. */
  'FINALE_RATE_MISSING',
  /** I18 — `KEYWORDS` is illegal outside a finale, and required inside one. */
  'KEYWORDS_OUTSIDE_FINALE',
  'FINALE_QUESTION_NOT_KEYWORDS',
  // ─── warnings: judgement calls ───
  'ROUND_EMPTY',
  'SINGLE_ACCEPTED_ANSWER',
  'SHORT_TIMER',
  'JEOPARDY_UNEVEN_COLUMNS',
  'JEOPARDY_EMPTY_TILES',
  /** Under a minute for the top team almost certainly means the rate is inverted. */
  'FINALE_RATE_SUSPICIOUS',
  'FINALE_TOO_FEW_QUESTIONS',
] as const

export type PreflightCode = (typeof PREFLIGHT_CODES)[number]

export interface PreflightFinding {
  severity: PreflightSeverity
  code: PreflightCode
  roundId?: string
  questionId?: string
  /** Numbers the copy interpolates — never a pre-built sentence. */
  detail?: Record<string, number | string>
}

export interface PreflightReport {
  findings: PreflightFinding[]
  errors: PreflightFinding[]
  warnings: PreflightFinding[]
  /** The counts §10 shows on the healthy line: *"84 questions · 12 attachments · 5 rounds"*. */
  counts: { rounds: number; questions: number; attachments: number }
  /** Never blocks. `[Play anyway]` is deliberately available even with errors (PRD 2 §10). */
  ready: boolean
}

export interface PreflightOptions {
  /**
   * Attachment ids whose file is missing or no longer matches its checksum. Computed by the caller,
   * because re-hashing is filesystem work — and worth doing, since it catches the failure that is
   * otherwise discovered live with the room waiting for a song that will not play.
   */
  brokenAttachmentIds?: readonly string[]
  /** Teams are assumed while authoring and exact at game setup (D58, PRD 2 §9, §11.1). */
  assumedTeams?: number
  /** The live `FINALE_CONFIGURED` values once a game exists; the round's authored config otherwise. */
  finale?: { secondsPerPoint: number; penaltySeconds: number }
}

const TIMER_FLOOR_SECONDS = 5
/** Below this for the strongest team and the rate is almost certainly the wrong way up. */
const SUSPICIOUS_TOP_SECONDS = 60

export function preflight(
  quiz: QuizContent,
  options: PreflightOptions = {},
): PreflightReport {
  const findings: PreflightFinding[] = []
  const broken = new Set(options.brokenAttachmentIds ?? [])

  const error = (code: PreflightCode, where: Partial<PreflightFinding> = {}): void => {
    findings.push({ severity: 'ERROR', code, ...where })
  }
  const warn = (code: PreflightCode, where: Partial<PreflightFinding> = {}): void => {
    findings.push({ severity: 'WARNING', code, ...where })
  }

  const finales = quiz.rounds.filter((round) => round.type === 'DSMTW_FINALE')
  const finale = finales[0]

  for (const round of quiz.rounds) {
    if (round.questions.length === 0) warn('ROUND_EMPTY', { roundId: round.id })
    if (round.type === 'JEOPARDY') checkBoard(round, warn)

    for (const question of round.questions) {
      findings.push(...questionFindings(question, round, broken))
    }
  }

  // ─── the finale's own four (PRD 2 §10) ───
  if (finales.length > 1) {
    for (const extra of finales.slice(1)) error('MULTIPLE_FINALES', { roundId: extra.id })
  }
  if (finale && quiz.rounds.at(-1)?.id !== finale.id) {
    error('FINALE_NOT_LAST', { roundId: finale.id })
  }
  if (finale) checkFinaleRate(quiz, finale, options, { error, warn })

  const errors = findings.filter((finding) => finding.severity === 'ERROR')
  return {
    findings,
    errors,
    warnings: findings.filter((finding) => finding.severity === 'WARNING'),
    counts: {
      rounds: quiz.rounds.length,
      questions: quiz.rounds.reduce((total, round) => total + round.questions.length, 0),
      attachments: quiz.rounds.reduce(
        (total, round) =>
          total + round.questions.reduce((sum, q) => sum + q.media.length, 0),
        0,
      ),
    },
    ready: errors.length === 0,
  }
}

interface Reporters {
  error: (code: PreflightCode, where?: Partial<PreflightFinding>) => void
  warn: (code: PreflightCode, where?: Partial<PreflightFinding>) => void
}

/**
 * Everything wrong with **one** question — which is both a part of `preflight` and the whole of the
 * `✓`/`⚠` readiness marker PRD 2 §7 puts on every row.
 *
 * Exported for exactly that reason: the marker and pre-flight must never disagree. A master who sees
 * a tick and then a pre-flight error on the same question has been told two different things by the
 * same program, and will stop trusting the cheaper one.
 */
export function questionFindings(
  question: QuestionContent,
  round: RoundContent,
  broken: ReadonlySet<string> = new Set(),
): PreflightFinding[] {
  const findings: PreflightFinding[] = []
  const error = (code: PreflightCode, where: Partial<PreflightFinding> = {}): void => {
    findings.push({ severity: 'ERROR', code, ...where })
  }
  const warn = (code: PreflightCode, where: Partial<PreflightFinding> = {}): void => {
    findings.push({ severity: 'WARNING', code, ...where })
  }

  checkQuestion(question, round, { error, warn }, broken)
  return findings
}

/** True when a question has nothing that would block play — the `✓` on its row. */
export function isQuestionReady(question: QuestionContent, round: RoundContent): boolean {
  return questionFindings(question, round).every(
    (finding) => finding.severity !== 'ERROR',
  )
}

function checkQuestion(
  question: QuestionContent,
  round: RoundContent,
  { error, warn }: Reporters,
  broken: ReadonlySet<string>,
): void {
  const where = { roundId: round.id, questionId: question.id }
  const isFinale = round.type === 'DSMTW_FINALE'

  if (question.prompt.trim() === '') error('EMPTY_PROMPT', where)

  for (const media of question.media) {
    if (broken.has(media.id)) error('ATTACHMENT_MISSING', { ...where })
  }

  // I18 — `KEYWORDS` exists solely for a finale and is illegal anywhere else, in both directions.
  if (question.answerMethod === 'KEYWORDS' && !isFinale) {
    error('KEYWORDS_OUTSIDE_FINALE', where)
  }
  if (isFinale && question.answerMethod !== 'KEYWORDS') {
    error('FINALE_QUESTION_NOT_KEYWORDS', where)
  }

  if (isFinale) {
    // I17 — exactly five, always. Four silently changes the round's arithmetic.
    if (question.keywords.length !== 5) {
      error('FINALE_KEYWORD_COUNT', {
        ...where,
        detail: { count: question.keywords.length },
      })
    }
    if (question.keywords.some((keyword) => keyword.text.trim() === '')) {
      error('FINALE_KEYWORD_COUNT', {
        ...where,
        detail: { count: question.keywords.filter((k) => k.text.trim() !== '').length },
      })
    }
    // A finale question has no timer and no points, so nothing below applies to it.
    return
  }

  switch (question.answerMethod) {
    case 'FREE_TEXT':
      if (
        question.acceptedAnswers.filter((answer) => answer.trim() !== '').length === 0
      ) {
        error('NO_ACCEPTED_ANSWER', where)
      } else if (question.acceptedAnswers.length === 1) {
        // D22 matches on lowercase and trim only, so one spelling means hand-validating the rest.
        warn('SINGLE_ACCEPTED_ANSWER', where)
      }
      break

    case 'MULTIPLE_CHOICE': {
      const correct = question.options.filter((option) => option.isCorrect).length
      if (correct !== 1 || question.options.length < 2 || question.options.length > 4) {
        error('MC_NEEDS_ONE_CORRECT', {
          ...where,
          detail: { options: question.options.length, correct },
        })
      }
      break
    }

    case 'DO':
      // The mode decides how the master scores it, and there is no sane default to fall back on.
      if (!doConfigSchema.safeParse(question.config).success) {
        error('DO_NO_SCORING_MODE', where)
      }
      break

    default:
      // `BUZZER` needs nothing: the master judges it aloud, and its accepted answer is reference
      // only (data model §4.5).
      break
  }

  const timerMs = question.timerMs ?? round.defaultTimerMs
  if (timerMs !== null && timerMs > 0 && timerMs < TIMER_FLOOR_SECONDS * 1000) {
    warn('SHORT_TIMER', { ...where, detail: { seconds: Math.round(timerMs / 1000) } })
  }
}

/**
 * PRD 2 §8 — uneven columns are **allowed** (data model §4.3) and flagged.
 *
 * A master building incrementally has legitimately unfinished columns; a master who thinks they are
 * done has a mistake. Same warning for both, and pre-flight is where it becomes a decision.
 */
function checkBoard(round: RoundContent, warn: Reporters['warn']): void {
  if (round.categories.length === 0) return

  const perCategory = round.categories.map(
    (category) =>
      round.questions.filter((question) => question.categoryId === category.id).length,
  )
  const tallest = Math.max(...perCategory)
  if (tallest === 0) return

  if (perCategory.some((height) => height !== tallest)) {
    warn('JEOPARDY_UNEVEN_COLUMNS', { roundId: round.id, detail: { tallest } })
  }

  const empty = perCategory.reduce((total, height) => total + (tallest - height), 0)
  if (empty > 0) warn('JEOPARDY_EMPTY_TILES', { roundId: round.id, detail: { empty } })
}

function checkFinaleRate(
  quiz: QuizContent,
  finale: RoundContent,
  options: PreflightOptions,
  { error, warn }: Pick<Reporters, 'error' | 'warn'>,
): void {
  const configured = options.finale ?? readFinaleConfig(finale)
  if (!configured || configured.secondsPerPoint <= 0) {
    error('FINALE_RATE_MISSING', { roundId: finale.id })
    return
  }

  // The strongest possible team is the whole quiz — which is also the most generous reading, so a
  // warning here means every real team is worse off than the number shown.
  const topSeconds = secondsForScore(quizPoints(quiz), configured.secondsPerPoint)
  if (topSeconds < SUSPICIOUS_TOP_SECONDS) {
    warn('FINALE_RATE_SUSPICIOUS', {
      roundId: finale.id,
      detail: { seconds: topSeconds },
    })
  }

  const teams = options.assumedTeams ?? 4
  // D58 — a shortfall is a **warning, never a block**: over-supplying questions is free, since the
  // round ends at one survivor whatever is left over.
  const suggested = suggestFinaleQuestions(
    Array.from({ length: teams }, () => topSeconds),
    configured.penaltySeconds,
  )
  if (finale.questions.length < suggested) {
    warn('FINALE_TOO_FEW_QUESTIONS', {
      roundId: finale.id,
      detail: { have: finale.questions.length, suggested, teams },
    })
  }
}

/**
 * The authored defaults, until `FINALE_CONFIGURED` overrides them at setup (D54).
 *
 * Read through the column's own validator rather than by poking at fields: `round.config` is a JSON
 * column, and data model §2 is explicit that a JSON column without a validator is a bug.
 */
function readFinaleConfig(
  round: RoundContent,
): { secondsPerPoint: number; penaltySeconds: number } | undefined {
  const parsed = dsmtwFinaleRoundConfigSchema.safeParse(round.config)
  return parsed.success ? parsed.data : undefined
}
