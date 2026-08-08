'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * PRD 2 §15.1 — **autosave on a ~600 ms debounce, with a quiet indicator.** No save buttons, no
 * unsaved-changes dialogs.
 *
 * The debounce is the whole design: a master types a prompt and it is saved, so there is no state
 * where closing a sheet loses work and no dialog asking about it. What the trade costs is covered
 * elsewhere — structural deletes are confirmed (§15.1), and readiness markers make a half-typed
 * question visibly incomplete rather than "done".
 *
 * `status` drives the `Saved · 19:04` line. It returns to idle rather than staying on "saved" for
 * ever, because a permanent tick stops meaning anything.
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

const DEBOUNCE_MS = 600

export function useAutosave<T>(save: (value: T) => Promise<{ ok: boolean }>): {
  status: SaveStatus
  savedAt: Date | undefined
  push: (value: T) => void
} {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<Date | undefined>()

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef<T | undefined>(undefined)
  const saveRef = useRef(save)
  saveRef.current = save

  // A pending save must not fire into an unmounted component, and a master navigating away
  // mid-keystroke is the ordinary case rather than the exotic one.
  useEffect(() => () => clearTimeout(timer.current), [])

  const push = useCallback((value: T) => {
    latest.current = value
    setStatus('saving')
    clearTimeout(timer.current)

    timer.current = setTimeout(() => {
      const pending = latest.current
      if (pending === undefined) return
      void saveRef.current(pending).then((result) => {
        setStatus(result.ok ? 'saved' : 'failed')
        if (result.ok) setSavedAt(new Date())
      })
    }, DEBOUNCE_MS)
  }, [])

  return { status, savedAt, push }
}
