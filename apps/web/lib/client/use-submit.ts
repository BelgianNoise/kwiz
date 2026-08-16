'use client'

import type { ActionResult, ErrorCode } from '@kwiz/domain'
import { SUBMIT_RETRY_BASE_MS } from '@kwiz/domain'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * PRD 5 §5.4 and §12 — **submitting, and not losing it.**
 *
 * Two rules meet here, and both come straight from §1.1's phone:
 *
 * - *"At zero the client submits whatever is currently entered (D8), **flushing any pending debounce**
 *   rather than waiting for it — a pending debounce at zero would race the submit."*
 * - *"The submit **retries with backoff until acknowledged**. There is no server-side deadline to
 *   commit the draft on the team's behalf, so this retry **is** the safety net."*
 *
 * The second sentence is the load-bearing one. D8 makes the deadline advisory and only the master
 * locking a question stops submissions, so a phone that was offline at zero is *expected* to arrive
 * late and be accepted. Giving up after one failed POST would quietly cost a team the question they
 * had already typed.
 */

/** Backoff caps here: §5.4 says it retries *while the question is open*, not forever, and not slowly. */
const RETRY_CAP_MS = 5_000

export type SubmitState = 'IDLE' | 'SENDING' | 'DONE'

/**
 * Whether the button should read *sending*.
 *
 * **A queued retry counts.** §12 says *"the button shows a sending state rather than success"*, and
 * between a failed attempt and the next backoff tick the internal state is briefly `IDLE` — so the
 * button flickered back to *Submit* while the phone was, in fact, still trying. Nothing was broken by
 * it, but a team watching a submit button flicker on a dying connection reads it as *it did not go*,
 * which is the exact belief §12 spends its whole table avoiding.
 */
const isSending = (state: SubmitState, retrying: boolean): boolean =>
  state === 'SENDING' || (state === 'IDLE' && retrying)

export interface Submitter {
  state: SubmitState
  /** `state === 'SENDING'` **or** waiting out a backoff — what the button should actually read. */
  sending: boolean
  /** A typed refusal that is **not** worth retrying — `ALREADY_SUBMITTED` above all (D43). */
  refusal: ErrorCode | null
  submit: () => void
}

/**
 * `send` is called until it resolves `ok`, or until it is refused for a reason retrying cannot fix.
 *
 * `enabled` goes false when the question stops accepting answers, which is what stops the loop: a
 * locked question refuses with `QUESTION_LOCKED`, and retrying that forever would be a phone shouting
 * at a server about a question the room has moved past.
 */
export function useSubmit(
  send: () => Promise<ActionResult<unknown>>,
  enabled: boolean,
): Submitter {
  const [state, setState] = useState<SubmitState>('IDLE')
  const [refusal, setRefusal] = useState<ErrorCode | null>(null)

  const latest = useRef(send)
  latest.current = send
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempt = useRef(0)
  const running = useRef(false)

  // The timer is owned by a ref, not by an effect's cleanup: this component re-renders on every
  // pushed view, and a cleanup-owned retry would be cancelled by an unrelated frame arriving.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const attemptSend = useCallback(() => {
    void latest.current().then((result) => {
      if (result.ok) {
        running.current = false
        attempt.current = 0
        setState('DONE')
        return
      }

      /*
       * **`ALREADY_SUBMITTED` is a success, not a failure** (D43, protocol §7.3). It means the team's
       * answer is in — either this device's own earlier attempt landed and the acknowledgement was
       * lost, or the *other* device on the team got there first. Retrying would achieve nothing, and
       * showing it as an error would tell a team its answer vanished when it did not.
       */
      running.current = false
      attempt.current += 1
      setRefusal(result.error)
      setState('IDLE')
    })
  }, [])

  /*
   * Retry only on the shapes that a later attempt could actually fix — a network failure, which
   * `api.ts` deliberately flattens into `VALIDATION_ERROR` so a component never has to catch. Every
   * typed refusal is the server having decided something, and deciding it again gives the same answer.
   */
  useEffect(() => {
    if (!enabled || refusal !== 'VALIDATION_ERROR' || state !== 'IDLE') return undefined

    const delay = Math.min(
      RETRY_CAP_MS,
      SUBMIT_RETRY_BASE_MS * 2 ** (attempt.current - 1),
    )
    timer.current = setTimeout(() => {
      setRefusal(null)
      setState('SENDING')
      running.current = true
      attemptSend()
    }, delay)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [refusal, state, enabled, attemptSend])

  const submit = useCallback(() => {
    if (running.current || state === 'DONE') return
    running.current = true
    attempt.current = 0
    setRefusal(null)
    setState('SENDING')
    attemptSend()
  }, [state, attemptSend])

  // The same condition the retry effect above arms on, so the two cannot disagree about whether a
  // retry is pending.
  const retrying = enabled && refusal === 'VALIDATION_ERROR'

  return { state, sending: isSending(state, retrying), refusal, submit }
}
