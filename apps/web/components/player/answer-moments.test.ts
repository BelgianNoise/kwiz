import { describe, expect, it } from 'vitest'

import { autoSubmitAt } from '@/components/player/answer-moments'

const at = (over: Partial<Parameters<typeof autoSubmitAt>[0]> = {}) =>
  autoSubmitAt({
    expired: true,
    submitted: false,
    fired: false,
    entered: 'radiohead',
    ...over,
  })

describe('§5.4 auto-submit at zero', () => {
  it('sends what was entered when the timer runs out', () => {
    expect(at()).toBe('SUBMIT')
  })

  it('waits while the timer is still running', () => {
    expect(at({ expired: false })).toBe('WAIT')
  })

  it('waits once the team has answered — D43 makes the first submission final', () => {
    expect(at({ submitted: true })).toBe('WAIT')
  })

  it('sends a selected option the same way as text (O6)', () => {
    expect(at({ entered: '019f-option-id' })).toBe('SUBMIT')
  })

  /*
   * The two that matter, and both were live bugs. Neither is visible from reading §5.4's *"at zero
   * the client submits whatever is currently entered"* — it takes O6's *"if the timer expires with a
   * selection but no Submit"* to see that the mechanism exists to rescue an answer that was entered.
   */
  it('sends nothing when the timer runs out with an empty field', () => {
    expect(at({ entered: '' })).toBe('DISARM')
    expect(at({ entered: null })).toBe('DISARM')
  })

  it('does not re-arm, so text typed after zero is not submitted a character at a time', () => {
    // The sequence: expiry with nothing entered disarms, then the team starts typing.
    expect(at({ entered: '' })).toBe('DISARM')
    expect(at({ fired: true, entered: 'R' })).toBe('WAIT')
    expect(at({ fired: true, entered: 'Radiohead' })).toBe('WAIT')
  })

  it('does not fire twice for one question', () => {
    expect(at()).toBe('SUBMIT')
    expect(at({ fired: true })).toBe('WAIT')
  })
})
