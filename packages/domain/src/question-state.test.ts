import { describe, expect, it } from 'vitest'

import type { GameEventType } from './events/payload'
import {
  QUESTION_STATES,
  acceptsSubmissions,
  canTransition,
  isTerminalQuestionState,
  nextQuestionState,
  revealsCorrectAnswer,
  type QuestionState,
} from './question-state'

/** PRD 1 §7.1. Every legal transition, and — more usefully — every illegal one. */
describe('legal transitions', () => {
  it.each([
    ['PENDING', 'QUESTION_OPENED', 'OPEN'],
    ['PENDING', 'QUESTION_SKIPPED', 'SKIPPED'],
    ['OPEN', 'QUESTION_LOCKED', 'LOCKED'],
    ['OPEN', 'QUESTION_SKIPPED', 'SKIPPED'],
    ['LOCKED', 'QUESTION_REVEALED', 'REVEALED'],
    ['REVEALED', 'QUESTION_SCORED', 'SCORED'],
  ] as [QuestionState, GameEventType, QuestionState][])(
    '%s + %s → %s',
    (from, event, to) => {
      expect(nextQuestionState(from, event)).toBe(to)
    },
  )

  /** `DO` questions skip `REVEALED` entirely — there is nothing hidden to reveal (PRD 1 §7.1). */
  it('allows LOCKED → SCORED, which is how DO is scored', () => {
    expect(nextQuestionState('LOCKED', 'QUESTION_SCORED')).toBe('SCORED')
  })
})

describe('illegal transitions', () => {
  /** A question cannot be revealed before it is locked — that is confidentiality invariant 1. */
  it('refuses to reveal from PENDING or OPEN', () => {
    expect(canTransition('PENDING', 'QUESTION_REVEALED')).toBe(false)
    expect(canTransition('OPEN', 'QUESTION_REVEALED')).toBe(false)
  })

  it('refuses to score before locking', () => {
    expect(canTransition('PENDING', 'QUESTION_SCORED')).toBe(false)
    expect(canTransition('OPEN', 'QUESTION_SCORED')).toBe(false)
  })

  it('refuses to reopen a locked question', () => {
    expect(canTransition('LOCKED', 'QUESTION_OPENED')).toBe(false)
  })

  /** D46: a question already resolved cannot be skipped — the skip would rewrite a score. */
  it.each(['LOCKED', 'REVEALED', 'SCORED'] as const)(
    'refuses to skip from %s',
    (from) => {
      expect(canTransition(from, 'QUESTION_SKIPPED')).toBe(false)
    },
  )

  it.each(['SCORED', 'SKIPPED'] as const)('lets nothing follow %s', (from) => {
    const anyEvent: GameEventType[] = [
      'QUESTION_OPENED',
      'QUESTION_LOCKED',
      'QUESTION_REVEALED',
      'QUESTION_SCORED',
      'QUESTION_SKIPPED',
    ]
    for (const event of anyEvent) {
      expect(canTransition(from, event)).toBe(false)
    }
  })

  /** A buzz is not a transition: the question stays OPEN while it is adjudicated (D35). */
  it.each([
    'BUZZ_RECEIVED',
    'BUZZ_ADJUDICATED',
    'BUZZERS_FORCE_REOPENED',
  ] as GameEventType[])('%s does not move an OPEN question', (event) => {
    expect(nextQuestionState('OPEN', event)).toBeUndefined()
  })

  it('ignores events from elsewhere in the game', () => {
    expect(nextQuestionState('OPEN', 'SCORE_ADJUSTED')).toBeUndefined()
    expect(nextQuestionState('OPEN', 'BREAK_STARTED')).toBeUndefined()
  })
})

describe('derived properties', () => {
  /** D8: only the master locking a question stops submissions — never the deadline. */
  it('accepts submissions only while OPEN', () => {
    for (const state of QUESTION_STATES) {
      expect(acceptsSubmissions(state)).toBe(state === 'OPEN')
    }
  })

  /** Confidentiality invariant 1. */
  it('transmits the correct answer only from REVEALED onwards', () => {
    expect(QUESTION_STATES.filter(revealsCorrectAnswer)).toEqual(['REVEALED', 'SCORED'])
  })

  /**
   * `SKIPPED` is excluded deliberately: a question the room never saw resolved should not have its
   * answer pushed out by a state change nobody asked for.
   */
  it('does not transmit the correct answer for a skipped question', () => {
    expect(revealsCorrectAnswer('SKIPPED')).toBe(false)
  })

  it('treats SCORED and SKIPPED as terminal, and nothing else', () => {
    expect(QUESTION_STATES.filter(isTerminalQuestionState)).toEqual(['SCORED', 'SKIPPED'])
  })
})

describe('the state list itself', () => {
  /** protocol §5.5 is the canonical type; `BUZZED` is not a member of it. */
  it('has exactly the six states the protocol declares', () => {
    expect([...QUESTION_STATES]).toEqual([
      'PENDING',
      'OPEN',
      'LOCKED',
      'REVEALED',
      'SCORED',
      'SKIPPED',
    ])
  })

  it('reaches every state from PENDING', () => {
    const reached = new Set<QuestionState>(['PENDING'])
    let grew = true
    while (grew) {
      grew = false
      for (const from of [...reached]) {
        for (const event of [
          'QUESTION_OPENED',
          'QUESTION_LOCKED',
          'QUESTION_REVEALED',
          'QUESTION_SCORED',
          'QUESTION_SKIPPED',
        ] as GameEventType[]) {
          const to = nextQuestionState(from, event)
          if (to && !reached.has(to)) {
            reached.add(to)
            grew = true
          }
        }
      }
    }
    expect(reached.size).toBe(QUESTION_STATES.length)
  })
})
