'use client'

import { ERROR_CODES, SSE_RETRY_HINT_MS, type ErrorCode, type Notice } from '@kwiz/domain'
import { useEffect, useRef, useState } from 'react'

/**
 * protocol §3 — **the client half of the stream**, and the first consumer of the three routes slice 3
 * built.
 *
 * The whole of it is: open an `EventSource`, replace the view on every `state` frame, hand every
 * `notice` to a callback. There is no merging, no delta application and no replay machinery, because
 * D38 pushes **whole audience-filtered views** — reconnection is "send the current view" and a
 * client that holds no game logic has nothing to reconcile.
 *
 * `Last-Event-ID` is not our business either: the browser echoes it automatically, and the server
 * consults it once (§3.2). Nothing here reads or stores a `seq`.
 */

export type LiveStatus =
  /** Never connected yet — no view to show. */
  | 'CONNECTING'
  /** A view is current. */
  | 'LIVE'
  /** The socket dropped and the browser is retrying. **The last view stays on screen.** */
  | 'RECONNECTING'
  /** The server refused (§3.4). Retrying will not help, and `error` says why. */
  | 'FAILED'

export interface LiveView<V> {
  view: V | null
  status: LiveStatus
  error: ErrorCode | null
}

export function useLiveView<V>(
  path: string,
  onNotice?: (notice: Notice) => void,
): LiveView<V> {
  const [live, setLive] = useState<LiveView<V>>({
    view: null,
    status: 'CONNECTING',
    error: null,
  })
  /** Bumped to re-open a closed stream: `EventSource` will not reopen one itself. */
  const [attempt, setAttempt] = useState(0)

  // Through a ref so a caller can pass an inline handler without tearing the stream down and
  // re-opening it on every render — which would also make PRD 3 §12's screen count flicker.
  const notice = useRef(onNotice)
  notice.current = onNotice

  useEffect(() => {
    /*
     * **An empty path means "do not stream", not "stream from here".** `new EventSource('')` resolves
     * against the current document and opens a stream on the page itself — so both callers that pass
     * `''` (a token still being read, and a game that has ended) were quietly opening a connection
     * that could never carry a view.
     *
     * The second one is why this matters beyond tidiness: ending a game closes every stream
     * (protocol §3.4), and without this the retry loop below kept reopening against nothing, on a
     * phone showing a screen that was already final. §12's battery row asks for one connection and no
     * polling; this is what makes the *no* half true.
     *
     * The last view stays on screen — it is still the truth, and it is the whole point of stopping.
     */
    if (!path) return undefined

    const source = new EventSource(path)
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined

    source.addEventListener('state', (event: MessageEvent<string>) => {
      // Not re-validated: this is our own server's own serialiser, and conventions §10.2 puts
      // outbound SSE payloads outside zod's remit for exactly that reason.
      setLive({ view: decode<V>(event.data), status: 'LIVE', error: null })
    })

    source.addEventListener('notice', (event: MessageEvent<string>) => {
      // Transient and explicitly lossy (§2.3): missing one costs a banner, never a fact.
      notice.current?.(decode<Notice>(event.data))
    })

    source.onerror = () => {
      if (disposed) return

      /*
       * A non-200 response is **fatal**: the browser closes the stream and never retries it. That
       * is the 404, the 401 and D14's 503 (§3.4) — and the typed body explaining which is the one
       * thing `EventSource` cannot hand us, so it is fetched once, deliberately, rather than shown
       * to a master as a bare "disconnected".
       */
      if (source.readyState === EventSource.CLOSED) {
        setLive((previous) => ({ ...previous, status: 'RECONNECTING' }))
        void diagnose(path).then((error) => {
          if (disposed) return
          if (error) {
            setLive((previous) => ({ ...previous, status: 'FAILED', error }))
            return
          }
          // Serving again — the drop was the server restarting, which is the case D4 exists for.
          // Reopen on the same cadence the server asks clients to retry on (protocol §2.2).
          retry = setTimeout(() => setAttempt((n) => n + 1), SSE_RETRY_HINT_MS)
        })
        return
      }

      // Otherwise the laptop slept or the wifi blinked. The last view stays on screen: it is still
      // the truth as of the last frame, and blanking the desk mid-question would be worse.
      setLive((previous) => ({ ...previous, status: 'RECONNECTING' }))
    }

    return () => {
      disposed = true
      if (retry) clearTimeout(retry)
      source.close()
    }
  }, [path, attempt])

  return live
}

/**
 * One frame's `data:`, as the view or notice the caller expects.
 *
 * **The two suppressions are the boundary itself.** `JSON.parse` returns `any`, and no guard can
 * prove a parsed object is a `MasterControlView` without restating the whole shape as a schema —
 * which conventions §10.2 explicitly does not want for a payload our own server serialised from
 * typed state. Confined to this one function, so nothing downstream is typed by assertion.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
function decode<T>(data: string): T {
  const parsed: unknown = JSON.parse(data)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parsed as T
}

/** Why the server refused the stream. `null` when the second look succeeds after all. */
async function diagnose(path: string): Promise<ErrorCode | null> {
  try {
    const response = await fetch(path)
    if (response.ok) {
      // It is serving again. Release the body rather than leaving a second stream open.
      await response.body?.cancel()
      return null
    }
    const parsed: unknown = await response.json()
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const code = ERROR_CODES.find((candidate) => candidate === parsed.error)
      // A refusal we cannot name is still a refusal, and retrying it would not help.
      return code ?? 'VALIDATION_ERROR'
    }
    return 'VALIDATION_ERROR'
  } catch {
    // The machine is unreachable, which is not a refusal — the browser will keep trying.
    return null
  }
}
