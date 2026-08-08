'use client'

import type { PreflightReport, QuizContent } from '@kwiz/domain'
import { useState } from 'react'

import { GameSetup } from '@/components/admin/game-setup'
import { PreflightReportView } from '@/components/admin/preflight-report'

/**
 * PRD 2 §10 → §11 — pre-flight, then setup, in one place.
 *
 * A master pressing `[Play]` is trying to run a game. Pre-flight is the thing they pass through on
 * the way, and **`[Play anyway]` is deliberately available even with errors**: a master five minutes
 * from doors open who knows question 34 is broken should be able to run the other 83 and skip it.
 * Blocking them protects the data at the expense of the event.
 */
export function PlayFlow({
  quiz,
  report,
  lastTeams,
}: {
  quiz: QuizContent
  report: PreflightReport
  lastTeams: { name: string; colour: string }[]
}) {
  // Skipped straight past when the quiz is clean: a healthy quiz should not make the master read a
  // page that says nothing is wrong.
  const [showing, setShowing] = useState<'preflight' | 'setup'>(
    report.findings.length === 0 ? 'setup' : 'preflight',
  )

  if (showing === 'setup') {
    return <GameSetup quiz={quiz} lastTeams={lastTeams} />
  }

  return (
    <PreflightReportView
      quiz={quiz}
      report={report}
      onContinue={() => setShowing('setup')}
    />
  )
}
