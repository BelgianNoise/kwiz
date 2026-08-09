import { describe, expect, it } from 'vitest'

import { keyboardReorder } from './use-reorder'

/**
 * P1.7 — PRD 2 §15.2's keyboard route: `Alt+↑/↓` on a focused row, refused identically to the drag
 * route (§6.1's pinned finale is the case that matters). No DOM or React is exercised here — this
 * repo has no component-test harness, and the decision is a plain function of its inputs, so that
 * is exactly what is tested rather than the event wiring around it (verified in the browser).
 */
describe('keyboardReorder', () => {
  const allow = () => true
  const deny = () => false

  it('moves up on Alt+ArrowUp when nothing refuses it', () => {
    expect(keyboardReorder({ altKey: true, key: 'ArrowUp' }, 1, 3, allow, allow)).toBe(
      'UP',
    )
  })

  it('moves down on Alt+ArrowDown when nothing refuses it', () => {
    expect(keyboardReorder({ altKey: true, key: 'ArrowDown' }, 1, 3, allow, allow)).toBe(
      'DOWN',
    )
  })

  it('does nothing without Alt held', () => {
    expect(
      keyboardReorder({ altKey: false, key: 'ArrowUp' }, 1, 3, allow, allow),
    ).toBeUndefined()
  })

  it('does nothing for a key that is not an arrow', () => {
    expect(
      keyboardReorder({ altKey: true, key: 'a' }, 1, 3, allow, allow),
    ).toBeUndefined()
  })

  it('refuses to walk above the first row', () => {
    expect(
      keyboardReorder({ altKey: true, key: 'ArrowUp' }, 0, 3, allow, allow),
    ).toBeUndefined()
  })

  it('refuses to walk below the last row', () => {
    expect(
      keyboardReorder({ altKey: true, key: 'ArrowDown' }, 2, 3, allow, allow),
    ).toBeUndefined()
  })

  it('defers to canDrag, e.g. a pinned row', () => {
    expect(
      keyboardReorder({ altKey: true, key: 'ArrowDown' }, 1, 3, deny, allow),
    ).toBeUndefined()
  })

  /**
   * The rule this whole feature exists to not let the keyboard walk around (§6.1): the row above a
   * pinned finale must refuse `Alt+↓` exactly as the drag route's `canDrop` already does.
   */
  it('defers to canDrop, e.g. the row above a pinned finale', () => {
    const canDropAboveFinale = (_from: number, to: number) => to < 2
    expect(
      keyboardReorder(
        { altKey: true, key: 'ArrowDown' },
        1,
        3,
        allow,
        canDropAboveFinale,
      ),
    ).toBeUndefined()
    expect(
      keyboardReorder({ altKey: true, key: 'ArrowUp' }, 1, 3, allow, canDropAboveFinale),
    ).toBe('UP')
  })
})
