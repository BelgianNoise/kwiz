'use client'

import type { MainScreenView, TeamPublic } from '@kwiz/domain'
import { STAGE_TRANSITION_MS_MAX } from '@kwiz/domain'

import { BreakStage } from '@/components/screen/break-stage'
import { LeaderboardStage } from '@/components/screen/leaderboard-stage'
import { RoundIntroStage } from '@/components/screen/round-intro-stage'
import { WaitingStage } from '@/components/screen/waiting-stage'

/**
 * PRD 4 §3 — **exactly one stage, and no shared frame between them.**
 *
 * Stages are mutually exclusive: each owns the whole safe area. There is no persistent header and no
 * sidebar, because at §2.1's size budget a header costs 10–15% of the vertical space on *every* stage,
 * permanently, to display something the room does not need. The join code is the only candidate and it
 * earns its place on three stages, which is why §4, §10 and §11 each draw it themselves.
 *
 * The switch below has no `default`. Every stage the server can send is handled, and a new one should
 * be a compile error rather than a blank projector.
 */
export function Stage({
  view,
  sound,
}: {
  view: MainScreenView
  /** §4.1's arming result — `false` means the room will not hear the two sounds. */
  sound: boolean
}) {
  const teams = new Map(view.teams.map((team) => [team.id, team]))

  return (
    /*
     * §15 — *"stage transitions are 250–400 ms and directional. Long enough to be caught peripherally;
     * short enough not to delay the room."* Keyed on the stage kind so the animation re-runs on a
     * *change* of stage and not on every pushed view — a view arrives on every answer, and a screen
     * that slid in on each one would be the *"two things animating"* glitch §15 forbids.
     */
    <div
      key={view.stage.kind}
      className="h-full w-full"
      style={{ animation: `kwiz-stage-in ${STAGE_TRANSITION_MS_MAX}ms ease-out` }}
    >
      <StageBody view={view} teams={teams} sound={sound} />
    </div>
  )
}

export type Teams = ReadonlyMap<string, TeamPublic>

function StageBody({
  view,
  teams,
  sound,
}: {
  view: MainScreenView
  teams: Teams
  sound: boolean
}) {
  const stage = view.stage

  switch (stage.kind) {
    case 'WAITING_FOR_PLAYERS':
      return (
        <WaitingStage
          quizName={view.quizName}
          code={view.code}
          joinUrl={view.joinUrl}
          teams={view.teams}
          joinedTeamIds={stage.joinedTeamIds}
          sound={sound}
        />
      )

    case 'ROUND_INTRO':
      return <RoundIntroStage stage={stage} />

    case 'LEADERBOARD':
      return <LeaderboardStage stage={stage} teams={teams} code={view.code} />

    case 'BREAK':
      return <BreakStage stage={stage} teams={teams} code={view.code} />

    // The remaining four stages are built in the pieces that follow; each is a `case` here so the
    // switch stays exhaustive rather than falling through to a blank projector.
    case 'QUESTION':
    case 'JEOPARDY_BOARD':
    case 'FINALE':
    case 'FINISHED':
      return null
  }

  /*
   * Unreachable: every `kind` returns above. The assignment is the point — a stage added to the view
   * without a branch here becomes a **compile error** rather than a blank projector, which is the one
   * failure mode this surface cannot recover from. (It also satisfies `consistent-return`, which
   * cannot see that a switch is exhaustive.)
   */
  const unhandled: never = stage
  return unhandled
}
