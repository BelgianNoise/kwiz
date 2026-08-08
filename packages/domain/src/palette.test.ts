import { describe, expect, it } from 'vitest'

import {
  assignedColour,
  contrastOnStage,
  isColourTaken,
  isLegibleOnStage,
  MIN_TEAM_CONTRAST,
  normaliseHex,
  TEAM_PALETTE,
} from './palette'

describe('the curated palette', () => {
  /**
   * The palette's whole promise (PRD 1 §9.3) is readable contrast on the projected screen. This is
   * that promise as an assertion, so a colour added later cannot quietly break it — and it is what
   * keeps `MIN_TEAM_CONTRAST` honest, since a threshold above the palette's own worst entry would
   * make the app warn about its own defaults.
   */
  it('every colour clears the floor a custom colour is held to', () => {
    for (const entry of TEAM_PALETTE) {
      expect(contrastOnStage(entry.hex)).toBeGreaterThanOrEqual(MIN_TEAM_CONTRAST)
    }
  })

  it('rejects the kind of colour free choice actually produces', () => {
    // Dark navy on a near-black stage: invisible from three metres, let alone ten.
    expect(isLegibleOnStage('#1E3A8A')).toBe(false)
    expect(isLegibleOnStage('#000000')).toBe(false)
    expect(isLegibleOnStage('#FBBF24')).toBe(true)
  })

  /** The first few teams must be mutually unmistakable, which is why this is not array order. */
  it('assigns around the hue wheel and wraps past the end', () => {
    const first = [0, 1, 2, 3].map(assignedColour)
    expect(new Set(first).size).toBe(4)
    expect(assignedColour(TEAM_PALETTE.length)).toBe(assignedColour(0))
  })

  it('compares taken colours without caring about case', () => {
    expect(isColourTaken('#ef4444', ['#EF4444'])).toBe(true)
    expect(isColourTaken('#EF4444', ['#22D3EE'])).toBe(false)
  })

  it('resolves both hex shapes a colour input can produce, and refuses anything else', () => {
    expect(normaliseHex('#abc')).toBe('#AABBCC')
    expect(normaliseHex('#a3e635')).toBe('#A3E635')
    expect(normaliseHex('red')).toBeUndefined()
    expect(normaliseHex('#12345')).toBeUndefined()
  })
})
