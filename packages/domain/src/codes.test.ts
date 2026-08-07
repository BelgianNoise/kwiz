import { describe, expect, it } from 'vitest'

import { CODE_ALPHABET, codeFromBytes, isValidCode, normaliseCode } from './codes'

describe('the code alphabet', () => {
  it('is Crockford Base32 — 32 characters with the four confusable ones gone', () => {
    expect(CODE_ALPHABET).toHaveLength(32)
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(CODE_ALPHABET).not.toContain(excluded)
    }
    // The count is what makes 32^6 ≈ 1.07 billion codes, so a missing character is not cosmetic.
    expect(new Set(CODE_ALPHABET).size).toBe(32)
  })
})

describe('normalising a typed code', () => {
  it('applies conventions §2 in order: strip, uppercase, then map the lookalikes', () => {
    // A player reading `KW1Z0A` off a projector may well type it with an l, an o and a hyphen.
    expect(normaliseCode(' kw-lz oa ')).toBe('KW1Z0A')
    expect(normaliseCode('IIll00')).toBe('111100')
  })

  it('keeps a character outside the alphabet so it can be rejected rather than dropped', () => {
    // Silently discarding it could turn a typo into a *different valid code*, which would put a
    // player in someone else's game.
    expect(isValidCode('KW1Z0!')).toBe(false)
    expect(isValidCode('KW1Z0')).toBe(false)
    expect(isValidCode('kw-lz oa')).toBe(true)
  })
})

describe('generating a code', () => {
  it('maps one byte per character, with no modulo bias', () => {
    // 256 % 32 === 0, so every byte value maps onto exactly one character and no rejection loop is
    // needed. Byte 0 → '0', byte 32 → '0' again, byte 31 → the last character.
    expect(codeFromBytes(new Uint8Array([0, 1, 31, 32, 33, 255]))).toBe('01Z01Z')
    expect(isValidCode(codeFromBytes(new Uint8Array([7, 200, 3, 91, 128, 44])))).toBe(
      true,
    )
  })

  it('refuses to invent entropy it was not given', () => {
    expect(() => codeFromBytes(new Uint8Array([1, 2, 3]))).toThrow(/at least 6 bytes/)
  })
})
