'use client'

import type { ActionResult, ErrorCode, MasterControlView, Notice } from '@kwiz/domain'
import { SCORE_BANNER_MS } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { nextPendingInRound } from '@/components/control/advance'
import { BoardDesk } from '@/components/control/board-desk'
import { BreakDesk } from '@/components/control/break-desk'
import { BuzzDesk } from '@/components/control/buzz-desk'
import { DoDesk } from '@/components/control/do-desk'
import {
  FinaleDesk,
  FinaleRanking,
  FinalistPicker,
} from '@/components/control/finale-desk'
import { ControlHeader } from '@/components/control/header'
import { ControlKeys, useControlKeys } from '@/components/control/keys'
import { Leaderboard } from '@/components/control/leaderboard'
import { QuestionDesk } from '@/components/control/question-desk'
import { RightRail } from '@/components/control/right-rail'
import { SetupDesk } from '@/components/control/setup-desk'
import { Timeline } from '@/components/control/timeline'
import { control, type ControlApi } from '@/lib/client/api'
import { useLiveView } from '@/lib/client/use-live-view'

/**
 * PRD 3 — the desk.
 *
 * **One frame, four regions, stable for the whole game** (§2). Only the attention zone's contents
 * change; the header, the right rail and the timeline never move. A layout that reflows as the game
 * progresses makes the master re-locate the button they need, every single time.
 *
 * The client renders `attention` and **never derives it** (§3). Every branch below is a `kind` the
 * server chose, in the priority order PRD 3 §3.1 sets out — so "what needs me now?" is answered
 * before the view is even sent, which is the whole of PRD 1 G4.
 */
export function ControlDesk({ gameId, quizName }: { gameId: string; quizName: string }) {
  const t = useTranslations('control')
  // conventions §6.1 — `errors.<CODE>` is the one place a typed refusal becomes copy (D11).
  const tError = useTranslations('errors')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [refusal, setRefusal] = useState<ErrorCode | null>(null)

  const onNotice = useCallback((next: Notice) => setNotice(next), [])
  const { view, status, error } = useLiveView<MasterControlView>(
    `/api/live/${gameId}/control`,
    onNotice,
  )

  const api = useMemo(() => control(gameId), [gameId])

  /**
   * Every action goes through here, so a typed refusal has exactly one place to land. Actions are
   * fire-and-forget by design: the resulting view arrives on the stream, never as a response
   * (protocol §7), so awaiting one of these is only ever waiting for the *no*.
   */
  const run = useCallback<Run>((call) => {
    void call().then((result) => setRefusal(result.ok ? null : result.error))
  }, [])

  // A notice is a moment, not a state (§2.3) — it fades rather than accumulating.
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(null), SCORE_BANNER_MS)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!refusal) return undefined
    const timer = setTimeout(() => setRefusal(null), SCORE_BANNER_MS)
    return () => clearTimeout(timer)
  }, [refusal])

  if (status === 'FAILED') {
    return (
      <main className="grid min-h-dvh place-items-center p-8">
        <p className="text-destructive max-w-prose text-center text-lg">
          {error ? tError(error) : t('frame.reconnecting')}
        </p>
      </main>
    )
  }

  if (!view) {
    return (
      <main className="text-muted-foreground grid min-h-dvh place-items-center p-8">
        {t('frame.connecting')}
      </main>
    )
  }

  return (
    <ControlKeys>
      <div className="grid h-dvh grid-cols-[minmax(0,1fr)_20rem] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <ControlHeader
          view={view}
          quizName={quizName}
          gameId={gameId}
          api={api}
          run={run}
          reconnecting={status === 'RECONNECTING'}
        />

        {/* The one region that changes. Everything else is fixed for the whole game (§2). */}
        <main className="col-start-1 row-start-2 min-h-0 overflow-y-auto p-6">
          <AttentionZone view={view} api={api} run={run} gameId={gameId} />
        </main>

        <div className="col-start-1 row-start-3 border-t">
          <Timeline view={view} api={api} run={run} gameId={gameId} />
        </div>

        <div className="col-start-2 row-span-3 row-start-1 border-l">
          <RightRail
            view={view}
            api={api}
            run={run}
            gameId={gameId}
            notice={notice}
            refusal={refusal}
          />
        </div>
      </div>
    </ControlKeys>
  )
}

/** What every zone needs: the typed client, and the one place a refusal lands. */
export type Run = (call: () => Promise<ActionResult>) => void

export interface ZoneProps {
  view: MasterControlView
  api: ControlApi
  run: Run
  /**
   * D21 — carried explicitly, never resolved implicitly. The typed client is already bound to it;
   * this is for the two places that need the id itself rather than a call (the main-screen link,
   * and PRD 2's add-team dialog, which is shared with the config surface and takes one).
   */
  gameId: string
}

/**
 * §3.1's priority order, rendered.
 *
 * The order of these branches is not free: it **is** the priority table, and the server has already
 * chosen exactly one `kind`. The two checks above the switch are states the union cannot express —
 * a game that has not started, and one that is over.
 */
function AttentionZone({ view, api, run, gameId }: ZoneProps) {
  if (view.status === 'SETUP')
    return <SetupDesk view={view} api={api} run={run} gameId={gameId} />
  if (view.status === 'FINISHED' || view.status === 'ABANDONED') {
    return <FinaleRanking view={view} api={api} run={run} gameId={gameId} finished />
  }
  // §11.2 — a break holds the desk, and `attention` is `NONE` throughout it.
  if (view.break) return <BreakDesk view={view} api={api} run={run} gameId={gameId} />

  switch (view.attention.kind) {
    case 'ADJUDICATE_BUZZ':
      return (
        <BuzzDesk view={view} api={api} run={run} gameId={gameId} buzz={view.attention} />
      )
    case 'FINALE_TURN':
      return (
        <FinaleDesk
          view={view}
          api={api}
          run={run}
          gameId={gameId}
          turn={view.attention}
        />
      )
    case 'SCORE_DO':
      return (
        <DoDesk
          view={view}
          api={api}
          run={run}
          gameId={gameId}
          scoring={view.attention}
        />
      )
    case 'BREAK_TIE_FOR_PICK':
      return (
        <BoardDesk
          view={view}
          api={api}
          run={run}
          gameId={gameId}
          tiedTeamIds={view.attention.tiedTeamIds}
        />
      )
    case 'PICK_FINALISTS':
      return (
        <FinalistPicker
          view={view}
          api={api}
          run={run}
          gameId={gameId}
          picking={view.attention}
        />
      )
    case 'VALIDATE_QUESTION':
      return (
        <QuestionDesk
          view={view}
          api={api}
          run={run}
          gameId={gameId}
          validating={view.attention}
        />
      )
    case 'ADVANCE':
      return <AdvanceZone view={view} api={api} run={run} gameId={gameId} />
    default:
      // §10.6 — the finale is over but the round has not been closed yet.
      if (view.finaleRanking)
        return <FinaleRanking view={view} api={api} run={run} gameId={gameId} />
      return <Leaderboard view={view} api={api} run={run} gameId={gameId} />
  }
}

/**
 * `ADVANCE` — nothing is wrong and the master decides the pace (§3.1 priority 7).
 *
 * Which surface that means depends on what is in front of them: a live question is the question
 * desk, a Jeopardy round with no open tile is the board, and anything else is the leaderboard with
 * the suggested action under it.
 */
function AdvanceZone({ view, api, run, gameId }: ZoneProps) {
  /*
   * The finale is checked **first**. A finale question is not a question in this sense — no answer
   * method, no accepted answers, nothing to submit — so falling through to the question desk drew a
   * proxy-answer control for a round nobody types in. Once the round is over the ranking belongs
   * here (§10.6); before that, the turn desk has already claimed the zone as `FINALE_TURN`.
   */
  if (view.round?.type === 'DSMTW_FINALE') {
    return view.finaleRanking ? (
      <FinaleRanking view={view} api={api} run={run} gameId={gameId} />
    ) : (
      <Leaderboard view={view} api={api} run={run} gameId={gameId} />
    )
  }
  /*
   * **A scored Jeopardy tile hands the desk back to the board** (PRD 3 §9), mirroring the main
   * screen's resolver — which needed this exact fix in slice 6 for the projector and now again
   * here for the desk. The board is the input device (D16): between tiles it is the only place
   * that shows who picks next (D30), and the generic branch below would instead offer
   * `[Next question]`, which opens the next tile *in position order* and silently bypasses the
   * pick. A `LOCKED` or `REVEALED` tile stays on the question desk — those states are still the
   * reveal moment the room is watching.
   *
   * Only while tiles remain **and the round is still open**: a closed round's tiles cannot be
   * picked (opening one is refused server-side), so its leftover board must not bury the advance
   * button.
   */
  if (
    view.round?.type === 'JEOPARDY' &&
    !view.round.closed &&
    view.question?.state === 'SCORED' &&
    nextPendingInRound(view)
  ) {
    return (
      <BoardDesk
        view={view}
        api={api}
        run={run}
        gameId={gameId}
        tiedTeamIds={view.board?.tiedForPickTeamIds ?? []}
      />
    )
  }
  if (
    view.question &&
    view.question.state !== 'PENDING' &&
    view.question.state !== 'SKIPPED'
  ) {
    return <QuestionDesk view={view} api={api} run={run} gameId={gameId} />
  }
  /*
   * The board is the desk **while there are tiles left to pick and the round is still open**
   * (D16). Once every tile has been played or skipped there is nothing to pick — and once the
   * master has ended the round its remaining tiles cannot be opened at all (the server refuses
   * it) — so either way the advance button outranks an unpickable board.
   */
  if (view.round?.type === 'JEOPARDY' && !view.round.closed && nextPendingInRound(view)) {
    return <BoardDesk view={view} api={api} run={run} gameId={gameId} tiedTeamIds={[]} />
  }
  return <Leaderboard view={view} api={api} run={run} gameId={gameId} />
}

/**
 * §13's `Enter` — the primary suggested action, wherever the master is.
 *
 * Exported because two zones offer the same button; binding it once here keeps the key and the
 * button pointed at the same call.
 */
export function usePrimaryAction(action: (() => void) | null): void {
  useControlKeys((event) => {
    if (event.key !== 'Enter' || !action) return false
    action()
    return true
  })
}
