'use client'

import { useRef, useState } from 'react'

/**
 * PRD 2 §15.2's drag half — *"drag via `⠿`, plus `Alt+↑/↓` on a focused row"*.
 *
 * Both routes are required and **both must refuse identically**: §6.1 pins the finale last, and a
 * keyboard path that ignores the rule is a way around it. So this hook takes the same `canDrop`
 * predicate the `↑`/`↓` buttons use for their `disabled` state, rather than reimplementing the
 * constraint — one rule, asked twice.
 *
 * Native HTML5 drag rather than a library. A single-column list of a dozen rows is the case the
 * platform handles well, and the alternative is a dependency plus a sensor abstraction for behaviour
 * that is four event handlers (CLAUDE.md §9 — abstracting before the second use case).
 *
 * **Reordering is expressed as repeated single steps**, not as an index write. `moveRound` and
 * `moveQuestion` are the only reorder actions the server has (protocol §7.1), they take a direction,
 * and they already renumber `position` explicitly (§2.7 — ordering is never insertion order). Adding
 * a "move to index" endpoint to save a few round trips over a list this size would be a second way
 * to do one thing.
 */

/**
 * The keyboard route's decision, pulled out of the event handler so it is a plain function of
 * inputs — testable without a DOM, and the one place `Alt+↑/↓`'s refusal logic lives rather than
 * being re-derived at each call site.
 *
 * Returns the direction to move in, or `undefined` when the chord is not `Alt+↑/↓`, would walk off
 * either end of the list, or `canDrag`/`canDrop` refuse it — the three ways this must agree with the
 * drag route and the `↑`/`↓` buttons rather than becoming a fourth way to state the same rule.
 */
export function keyboardReorder(
  event: { altKey: boolean; key: string },
  index: number,
  length: number,
  canDrag: (index: number) => boolean,
  canDrop: (from: number, to: number) => boolean,
): 'UP' | 'DOWN' | undefined {
  if (!event.altKey) return undefined
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return undefined

  const direction = event.key === 'ArrowUp' ? 'UP' : 'DOWN'
  const to = direction === 'UP' ? index - 1 : index + 1
  if (to < 0 || to >= length || !canDrag(index) || !canDrop(index, to)) return undefined

  return direction
}

export interface Reorder {
  /** The row currently being dragged, so the list can dim it. */
  draggingId: string | undefined
  /** The row a drop would land on, so the list can show the indicator. */
  overId: string | undefined
  /** Spread onto each row. `id` is the row's id and `index` its current position. */
  rowProps: (
    id: string,
    index: number,
  ) => {
    draggable: boolean
    onDragStart: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: React.DragEvent) => void
    onDragEnd: () => void
    /** §15.2's keyboard route — a row must be reachable by `Tab` for `Alt+↑/↓` to land on it. */
    tabIndex: number
    onKeyDown: (event: React.KeyboardEvent) => void
  }
}

export function useReorder({
  length,
  canDrag,
  canDrop,
  onMove,
}: {
  /** The list's current row count — the bound neither `canDrag` nor `canDrop` is asked about. */
  length: number
  /** False for a pinned row — the finale has one legal position (§6.1). */
  canDrag: (index: number) => boolean
  /** False where the drop indicator must not appear, e.g. past the pinned finale. */
  canDrop: (from: number, to: number) => boolean
  /** Called once per step, in order, so the server sees the same moves the buttons would send. */
  onMove: (id: string, direction: 'UP' | 'DOWN', steps: number) => void
}): Reorder {
  /**
   * The dragged row lives in a **ref**, not in state.
   *
   * `dragstart` and `dragover` are separate events, and a handler that reads state sees whatever the
   * last committed render closed over — so if `dragover` arrives before React has re-rendered, the
   * drag looks like it never started and every drop is refused. In a real drag there are frames in
   * between and it happens to work; depending on that is the kind of thing that breaks under load
   * on the laptop running a quiz. A ref is set synchronously, so the decision is never racing.
   *
   * State is still what drives the *visuals* — dimming the source row and drawing the drop indicator
   * are renders, and there a frame of latency is invisible.
   */
  const source = useRef<{ id: string; index: number } | undefined>(undefined)
  const [draggingId, setDraggingId] = useState<string | undefined>()
  const [overId, setOverId] = useState<string | undefined>()

  return {
    draggingId,
    overId,
    rowProps: (id, index) => ({
      draggable: canDrag(index),
      onDragStart: (event) => {
        source.current = { id, index }
        setDraggingId(id)
        /*
         * Firefox refuses to start a drag without data on the transfer, and `move` is what makes the
         * cursor say "move" rather than "copy". The payload itself is never read — the dragged row is
         * held in the ref above, because a drag between two windows is not a thing this list means.
         */
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', id)
      },
      onDragOver: (event) => {
        const from = source.current
        if (!from || from.id === id || !canDrop(from.index, index)) return
        // Preventing the default is what marks this a valid drop target; without it, no drop fires.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOverId(id)
      },
      onDragLeave: () => setOverId((current) => (current === id ? undefined : current)),
      onDrop: (event) => {
        event.preventDefault()
        setOverId(undefined)

        const from = source.current
        if (!from || from.id === id || !canDrop(from.index, index)) return

        onMove(from.id, index > from.index ? 'DOWN' : 'UP', Math.abs(index - from.index))
        source.current = undefined
        setDraggingId(undefined)
      },
      onDragEnd: () => {
        source.current = undefined
        setDraggingId(undefined)
        setOverId(undefined)
      },
      // §15.2 — "drag via `⠿`, plus `Alt+↑/↓` on a focused row".
      tabIndex: 0,
      onKeyDown: (event) => {
        const direction = keyboardReorder(event, index, length, canDrag, canDrop)
        if (!direction) return

        // Only once refusal is ruled out — an Alt+↑ that does nothing must not also eat the
        // browser's own handling of the chord.
        event.preventDefault()
        onMove(id, direction, 1)
      },
    }),
  }
}
