'use client'

import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * PRD 3 §13 — **the keyboard map, in one place.**
 *
 * The master has one hand free and is holding a microphone, so every high-frequency action is
 * reachable without the trackpad. The map is deliberately assembled here rather than by each
 * component binding its own listener: §13 also lists what must **never** be bound — ending the
 * game, abandoning it, skipping a question (D46), submitting on a team's behalf (D47) — and that
 * absence is only checkable if there is one list to read.
 *
 * A zone registers a handler and returns `true` when it consumed the key. The most recently mounted
 * zone is asked first, so the attention zone always wins over the frame around it.
 */

export type KeyHandler = (event: KeyboardEvent) => boolean

const RegisterKeys = createContext<(handler: KeyHandler) => () => void>(() => () => {})

/**
 * Typing must never be a command. `Y` in a score-adjustment reason is the letter Y, and a master
 * who has to think about where the focus is has lost the two seconds the map exists to save.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function ControlKeys({ children }: { children: ReactNode }) {
  const handlers = useRef<KeyHandler[]>([])

  const register = useCallback((handler: KeyHandler) => {
    handlers.current = [handler, ...handlers.current]
    return () => {
      handlers.current = handlers.current.filter((entry) => entry !== handler)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return
      // A modifier means the browser's own shortcut, except for the Shift the finale uses (§10.3).
      if (event.metaKey || event.ctrlKey || event.altKey) return

      for (const handler of handlers.current) {
        if (handler(event)) {
          event.preventDefault()
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return <RegisterKeys.Provider value={register}>{children}</RegisterKeys.Provider>
}

/**
 * Bind this component's keys for as long as it is mounted.
 *
 * The handler is held in a ref, so an inline closure over fresh props is fine and re-registering on
 * every render — which would reorder the stack — never happens.
 */
export function useControlKeys(handler: KeyHandler): void {
  const register = useContext(RegisterKeys)
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => register((event) => latest.current(event)), [register])
}

/**
 * `1`–`9` as a zero-based index, or `null`. Used by `DO` winners, tie-breaks and finale keywords.
 *
 * Read from `code`, not `key`, and that is load-bearing: §10.3 binds **`Shift`+`1`–`5`** to un-mark,
 * and with `Shift` held `key` is `!` on a US layout and something else again on a Belgian one. The
 * physical key is the thing the master presses.
 */
export function digitIndex(event: KeyboardEvent): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)
  return match?.[1] ? Number(match[1]) - 1 : null
}
