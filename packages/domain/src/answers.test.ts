import { describe, expect, it } from 'vitest'

import {
  gradeFreeText,
  gradeMultipleChoice,
  matchesAcceptedAnswer,
  normaliseAnswer,
  verdictAwardsPoints,
} from './answers'

/**
 * D22. The shape a domain test should have: literal arrays, no mocks, no setup.
 *
 * The interesting cases here are all the ones normalisation deliberately does **not** handle — the
 * near-misses a human is supposed to judge.
 */
describe('normaliseAnswer', () => {
  it.each([
    ['Paris', 'paris'],
    ['  paris  ', 'paris'],
    ['PARIS', 'paris'],
    ['\tParis\n', 'paris'],
  ])('%o normalises to %o', (input, expected) => {
    expect(normaliseAnswer(input)).toBe(expected)
  })

  it('leaves inner whitespace alone — "radio head" is not "radiohead"', () => {
    expect(normaliseAnswer('Radio  Head')).toBe('radio  head')
  })

  it.each(['Beyoncé', 'BEYONCÉ'])('does not strip accents (%o)', (input) => {
    expect(normaliseAnswer(input)).toContain('é')
  })

  it('does not strip punctuation', () => {
    expect(normaliseAnswer("Don't Stop!")).toBe("don't stop!")
  })
})

describe('matchesAcceptedAnswer', () => {
  const accepted = ['John F. Kennedy', 'JFK']

  it.each(['JFK', 'jfk', '  jfk  ', 'john f. kennedy'])('accepts %o', (text) => {
    expect(matchesAcceptedAnswer(text, accepted)).toBe(true)
  })

  /** Each of these is a human's call, and the point of D22 is that the machine does not make it. */
  it.each(['Kennedy', 'John Kennedy', 'John F Kennedy', 'J.F.K.'])(
    'does not match %o',
    (text) => {
      expect(matchesAcceptedAnswer(text, accepted)).toBe(false)
    },
  )

  it('matches against any entry, not only the canonical first one (D33)', () => {
    expect(matchesAcceptedAnswer('jfk', accepted)).toBe(true)
  })

  it('matches nothing when no answers are accepted', () => {
    expect(matchesAcceptedAnswer('anything', [])).toBe(false)
  })
})

describe('gradeFreeText', () => {
  const accepted = ['Paris']

  it('auto-marks an exact normalised match correct', () => {
    expect(gradeFreeText('  PARIS ', accepted)).toBe('AUTO_CORRECT')
  })

  /**
   * **The most important assertion in this file.** A near-miss goes to the master, never to
   * `AUTO_WRONG` — the machine may only ever be right.
   */
  it('sends a non-match to the master as PENDING, never AUTO_WRONG', () => {
    expect(gradeFreeText('Lyon', accepted)).toBe('PENDING')
    expect(gradeFreeText('Pariss', accepted)).toBe('PENDING')
  })

  it.each([undefined, '', '   '])('treats %o as NO_ANSWER', (text) => {
    expect(gradeFreeText(text, accepted)).toBe('NO_ANSWER')
  })
})

describe('gradeMultipleChoice', () => {
  it('marks the correct option correct', () => {
    expect(gradeMultipleChoice('opt-b', 'opt-b')).toBe('AUTO_CORRECT')
  })

  /** The one place a machine may reject: correctness is unambiguous. */
  it('marks a wrong option AUTO_WRONG', () => {
    expect(gradeMultipleChoice('opt-a', 'opt-b')).toBe('AUTO_WRONG')
  })

  it('treats no selection as NO_ANSWER rather than wrong', () => {
    expect(gradeMultipleChoice(undefined, 'opt-b')).toBe('NO_ANSWER')
  })
})

describe('verdictAwardsPoints (I8)', () => {
  it.each(['AUTO_CORRECT', 'ACCEPTED'] as const)('%o awards points', (verdict) => {
    expect(verdictAwardsPoints(verdict)).toBe(true)
  })

  it.each(['PENDING', 'AUTO_WRONG', 'DENIED', 'NO_ANSWER'] as const)(
    '%o awards nothing',
    (verdict) => {
      expect(verdictAwardsPoints(verdict)).toBe(false)
    },
  )
})
