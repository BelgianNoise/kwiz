import type { Audience } from './vocabulary'

/**
 * protocol §2.3 — the transient half of the transport.
 *
 * `state` answers *"what is true now"*. Some things are **moments**, not states: the score
 * adjustment banner (D25), the buzz sound, "Quizzly Bears just joined". Sent as state they would be
 * indistinguishable from state that was already there, and would re-fire on every reconnect.
 *
 * Notices are therefore **fire-and-forget and explicitly lossy**. Missing one during a disconnect
 * costs a banner, never a fact — every fact a notice refers to is also in the next `state` frame,
 * which is what makes not replaying them safe.
 */
export type Notice =
  /** D25 — the announcement banner. `announced: false` suppresses it, so no notice is emitted. */
  | { kind: 'SCORE_ADJUSTED'; teamId: string; delta: number; reason: string | null }
  /** The buzz sound. **`MAIN_SCREEN` only** (protocol §9 P3): the room's sound comes from the
   * room's speakers, and twenty phones buzzing a fraction of a second apart is the same failure
   * D27 avoids for music. */
  | { kind: 'BUZZ'; teamId: string }
  | { kind: 'TEAM_JOINED'; teamId: string }

export type NoticeKind = Notice['kind']

/**
 * Who hears each notice. A table rather than a per-call decision: an audience chosen at the call
 * site is a leak waiting to happen, and P3's "main screen only" is a product decision that should
 * live in one greppable place.
 */
export const NOTICE_AUDIENCES: Record<NoticeKind, readonly Audience[]> = {
  SCORE_ADJUSTED: ['MAIN_SCREEN', 'MASTER_CONTROL'],
  BUZZ: ['MAIN_SCREEN'],
  TEAM_JOINED: ['MAIN_SCREEN', 'MASTER_CONTROL'],
}

export function noticeReaches(notice: Notice, audience: Audience): boolean {
  return NOTICE_AUDIENCES[notice.kind].includes(audience)
}
