import type { MainScreenQuestion } from '@kwiz/domain'
import { describe, expect, it } from 'vitest'

import { resolveLayout } from './layout'

/**
 * PRD 4 §6's layout resolver. Worth testing where the rest of this component is not: it is a **rule**,
 * not presentation, and it is the rule a master authors against — *"resolution is by attachment kind
 * and count only, never by prompt length. A layout that changes because someone edited a word is
 * unpredictable to author against."*
 */
const media = (
  kind: MainScreenQuestion['media'][number]['kind'],
  n = 1,
): MainScreenQuestion['media'] =>
  Array.from({ length: n }, (_, index) => ({
    id: `${kind}-${index}`,
    kind,
    url: `/api/attachment/${kind}-${index}`,
    durationMs: null,
  }))

describe('resolving the question layout', () => {
  it('is TEXT with nothing to show', () => {
    expect(resolveLayout([])).toBe('TEXT')
  })

  it('is HERO for exactly one visual, image or video', () => {
    expect(resolveLayout(media('IMAGE'))).toBe('HERO')
    expect(resolveLayout(media('VIDEO'))).toBe('HERO')
  })

  it('is GRID for two to four images', () => {
    expect(resolveLayout(media('IMAGE', 2))).toBe('GRID')
    expect(resolveLayout(media('IMAGE', 4))).toBe('GRID')
  })

  /** §6.1 — a music round is a large slice of pub quizzes, and the screen has nothing else to show. */
  it('is AUDIO for audio alone', () => {
    expect(resolveLayout(media('AUDIO'))).toBe('AUDIO')
  })

  it('is SPLIT for audio alongside a visual, or more visuals than a grid designs for', () => {
    expect(resolveLayout([...media('AUDIO'), ...media('IMAGE')])).toBe('SPLIT')
    expect(resolveLayout(media('IMAGE', 5))).toBe('SPLIT')
  })

  /**
   * The property that makes the five layouts authorable: the *same attachments* always resolve the
   * same way. Prompt length is not an input, and neither is the order they were uploaded in.
   */
  it('depends on kind and count only — never on order', () => {
    const images = media('IMAGE', 3)
    expect(resolveLayout([...images].reverse())).toBe(resolveLayout(images))
    expect(resolveLayout([...media('IMAGE'), ...media('AUDIO')])).toBe(
      resolveLayout([...media('AUDIO'), ...media('IMAGE')]),
    )
  })
})
