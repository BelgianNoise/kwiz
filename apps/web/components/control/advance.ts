'use client'

import type { MasterControlView } from '@kwiz/domain'

import type { Run } from '@/components/control/control-desk'
import type { ControlApi } from '@/lib/client/api'

/**
 * **The one place that decides what advancing does**, and the one place that knows which advance is
 * irreversible.
 *
 * It exists because the same decision was written four times — in the leaderboard, the question
 * desk, the finale desk and the timeline — each as `view.timeline.find(e => e.state === 'PENDING')`.
 * That is a search of the **current round**, and the four copies hid one bug between them: at a round
 * boundary, with a validation still deferred from an earlier round, every copy returned nothing and
 * the desk rendered with no primary action at all. §6.2 promises the opposite in as many words.
 *
 * The suggestion itself is the server's (`view.advance`, protocol §5.4) — the client renders it and
 * never derives it (§3). What lives here is only the mapping from a suggestion to a call.
 */

export interface AdvanceAction {
  /** Which message key under `control.question` names this action. */
  label: 'close' | 'reveal' | 'score' | 'next' | 'openNext' | 'nextRound' | 'finishGame'
  call: () => void
  /**
   * **`FINISH` and nothing else.**
   *
   * PRD 3 §1.1 exempts exactly two acts from the surface's no-dialogs rule — ending and abandoning —
   * because they are the only genuinely irreversible ones. §13 additionally forbids binding either to
   * a key. Before this flag, `FINISH` was rendered through the same generic path as every other
   * suggestion, so the advance button ended the game on one click and `Enter` ended it on one
   * keystroke — at precisely the moment the game legitimately ends, which is when the master's
   * advance reflex is strongest.
   */
  irreversible?: true
}

export function advanceAction(
  view: MasterControlView,
  api: ControlApi,
  run: Run,
): AdvanceAction | null {
  if (view.status !== 'LIVE') return null

  const questionId = view.question?.gameQuestionId
  const questionState = view.question?.state

  switch (view.advance) {
    case 'LOCK':
      return questionId
        ? { label: 'close', call: () => run(() => api.lockQuestion(questionId)) }
        : null

    case 'REVEAL':
      return questionId
        ? { label: 'reveal', call: () => run(() => api.revealQuestion(questionId)) }
        : null

    case 'NEXT_QUESTION': {
      /*
       * `SCORED` is the one state where the master's next act is on *this* question rather than the
       * next one: the reveal has happened and the points are not awarded yet. Everything else lands
       * on opening the next question in the round.
       */
      if (questionId && questionState === 'REVEALED') {
        return { label: 'score', call: () => run(() => api.scoreQuestion(questionId)) }
      }
      const next = nextPendingInRound(view)
      return next
        ? {
            label: questionState === 'SCORED' ? 'next' : 'openNext',
            call: () => run(() => api.openQuestion(next)),
          }
        : null
    }

    case 'NEXT_ROUND': {
      const next = view.nextRoundId
      if (!next) return null
      const current = view.round
      return {
        label: 'nextRound',
        /*
         * Close, then open. Both events matter: `ROUND_CLOSED` is what PRD 3 §6.2 hangs the sweep
         * on, and skipping it would leave a round played and never ended in the log. Chained rather
         * than fired together because the second is refused while the first has not landed — and
         * there is nothing to close on the very first round, which is where a game starts.
         */
        call: () =>
          run(async () => {
            if (!current) return api.openRound(next)
            const closed = await api.closeRound(current.id)
            return closed.ok ? api.openRound(next) : closed
          }),
      }
    }

    case 'FINISH':
      return {
        label: 'finishGame',
        irreversible: true,
        /*
         * Lock the last question first when one is still open — which is the finale's own case
         * (§10.6): the round ends on a clock, not on the master closing the question, so the log
         * would otherwise carry a question opened and never closed.
         */
        call: () =>
          run(async () => {
            if (questionId && questionState === 'OPEN') {
              const locked = await api.lockQuestion(questionId)
              if (!locked.ok) return locked
            }
            return api.finish()
          }),
      }

    default:
      return null
  }
}

/**
 * The next unplayed question **in the current round**, which is the only one that can be opened
 * directly: `OPEN_QUESTION` does not make a question's round current, so opening one from another
 * round would leave `currentRoundId` pointing at the round before it.
 *
 * Crossing a round boundary is therefore `NEXT_ROUND`'s job, not this function's — and that is
 * exactly the fallback whose absence dead-ended the sweep.
 */
export function nextPendingInRound(view: MasterControlView): string | null {
  return view.timeline.find((entry) => entry.state === 'PENDING')?.gameQuestionId ?? null
}
