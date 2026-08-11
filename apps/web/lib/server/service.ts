import { appendAndProject, teamDrafts } from '@kwiz/db'
import {
  decide,
  fail,
  noticeReaches,
  ok,
  toMainScreenView,
  toMasterControlView,
  toPlayerView,
  type ActionResult,
  type Audience,
  type Command,
  type AudienceView,
  type GameState,
  type Notice,
} from '@kwiz/domain'

import { getPlayback } from './playback'
import type { Runtime } from './runtime'
import { joinUrl as buildJoinUrl, readSettings } from './settings'
import { frameId, type Frame, type Subscriber } from './transport'

/**
 * PRD 1 §6.4's request flow, in one place:
 *
 * ```
 * validate (the route) → decide (packages/domain) → append (durable) → fold → push
 * ```
 *
 * **The append is the commit point.** Nothing is broadcast that is not already durable, which is
 * what makes G6 hold: a crash can lose a broadcast, never a fact. It is also why `appendAndProject`
 * pushes nothing itself and returns the sequence numbers instead.
 */

export interface CommandContext {
  runtime: Runtime
  gameId: string
  now: number
}

export function runCommand(context: CommandContext, command: Command): ActionResult {
  const { runtime, gameId, now } = context
  const state = runtime.registry.get(gameId)
  if (!state) return fail('GAME_NOT_FOUND', `no game ${gameId}`)

  const decision = decide(state, command, now)
  if (!decision.ok) {
    return fail(decision.error, decision.message, decision.detail)
  }

  if (decision.events.length > 0) {
    appendAndProject(runtime.database, gameId, decision.events, () => new Date(now))
    runtime.registry.catchUp(gameId)
  }

  /*
   * `FINALE_ENDED` has no endpoint (protocol §7.2) because no client decides it: the round is over
   * when one finalist is left, when all of them are out, or when the questions run out. So it is
   * settled here, against the state the command just produced — and it derives the ranking with the
   * same function every view uses, so the event and the deriver cannot disagree.
   */
  const settled = runtime.registry.get(gameId)
  if (
    settled &&
    settled.finale.finalistIds.length > 0 &&
    settled.finale.ranking === null
  ) {
    const ending = decide(settled, { type: 'END_FINALE' }, now)
    if (ending.ok && ending.events.length > 0) {
      appendAndProject(runtime.database, gameId, ending.events, () => new Date(now))
      runtime.registry.catchUp(gameId)
    }
  }

  publishState(context)
  for (const notice of decision.notices) publishNotice(context, notice)

  // A stream stays open for a `FINISHED` game (§3.4) — the main screen keeps showing the leaderboard
  // — but an `ABANDONED` one is over, and the client is told by the stream closing.
  if (runtime.registry.get(gameId)?.status === 'ABANDONED') {
    runtime.transport.closeAll(gameId)
    runtime.registry.evictIfFinished(gameId, false)
  }

  return ok()
}

/**
 * Push the current view to every subscriber of one game.
 *
 * Views are **whole and idempotent** (D38, protocol §1), so this is also the entire reconnect
 * mechanism: there is no delta to compute and no replay machinery to get wrong.
 */
export function publishState(context: CommandContext): void {
  const { runtime, gameId } = context
  const state = runtime.registry.get(gameId)
  if (!state) return

  runtime.transport.broadcast(gameId, (subscriber) =>
    stateFrame(context, state, subscriber),
  )
}

export function publishNotice(context: CommandContext, notice: Notice): void {
  context.runtime.transport.broadcast(context.gameId, (subscriber) =>
    // Audience is decided by the notice's kind, not by the caller (protocol §9 P3).
    noticeReaches(notice, subscriber.audience) ? { kind: 'notice', notice } : null,
  )
}

/** Only this team's devices — a draft is shared across a team (D45), never beyond it. */
export function publishToTeam(context: CommandContext, teamId: string): void {
  const { runtime, gameId } = context
  const state = runtime.registry.get(gameId)
  if (!state) return

  runtime.transport.broadcast(gameId, (subscriber) =>
    subscriber.audience === 'PLAYER' && subscriber.teamId === teamId
      ? stateFrame(context, state, subscriber)
      : null,
  )
}

/**
 * One subscriber's `state` frame.
 *
 * Always built, never skipped: `Last-Event-ID` is an **optimisation, not a correctness mechanism**
 * (protocol §1) and it is consulted once, at connect. A push whose `seq` is unchanged is still a real
 * change — a shared draft (D45) moves text between a team's phones without appending anything to the
 * log — so suppressing it here would lose exactly that.
 */
export function stateFrame(
  context: CommandContext,
  state: GameState,
  subscriber: Pick<Subscriber, 'audience' | 'teamId'>,
): Extract<Frame, { kind: 'state' }> {
  return {
    kind: 'state',
    id: frameId(state.content.gameId, state.seq),
    data: buildView(context, state, subscriber.audience, subscriber.teamId),
  }
}

/**
 * protocol §6.1 — **one filter per audience**, selected here and nowhere else.
 *
 * The filters themselves live in `packages/domain` and are allowlists that construct (CLAUDE.md
 * §2.3); this only chooses which one and hands it the two things a pure function cannot reach: the
 * request instant, and the team's drafts.
 */
export function buildView(
  context: CommandContext,
  state: GameState,
  audience: Audience,
  teamId?: string,
): AudienceView {
  const { runtime, gameId, now } = context
  const joinUrl = joinUrlFor(runtime, state.code)

  switch (audience) {
    case 'MAIN_SCREEN':
      /*
       * The two facts about this machine that PRD 4 needs and `GameState` cannot hold: the master's
       * transport, for §6.1's equaliser and elapsed clock, and PRD 2 §16's mute, for §13's two sounds.
       * Neither is in the log and neither is replayable, so both are handed in — the same shape
       * `MasterControlView.controlScreens` established.
       */
      return toMainScreenView(state, now, joinUrl, {
        playback: getPlayback(gameId),
        soundMuted: readSettings(runtime.paths.dir).muteSounds,
      })
    case 'MASTER_CONTROL':
      // The socket count is a transport fact and cannot come from the log (PRD 3 §12), so it is
      // handed in here — the one thing on this view that is not a function of `GameState`.
      return toMasterControlView(
        state,
        now,
        joinUrl,
        runtime.transport.count(gameId, 'MASTER_CONTROL'),
      )
    case 'PLAYER':
      // Drafts are not events (protocol §4.8), so they cannot come from `GameState` and are passed
      // in. Omitting them would silently break D45 — two devices on one team would not see each
      // other typing — which is why `toPlayerView` takes them as an argument rather than merging
      // them afterwards.
      return toPlayerView(
        state,
        teamId ?? '',
        now,
        teamId === undefined ? new Map() : teamDrafts(runtime.database, gameId, teamId),
      )
    default: {
      // Three audiences, one filter each (protocol §2.1). A fourth would have to be given a filter
      // here before it could ever be subscribed.
      const unhandled: never = audience
      throw new Error(`no view filter for audience ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * The join URL the room reads off the projector, and the one its QR encodes.
 *
 * Delegates to `settings.joinUrl`, which is the single place that decides. **This used to return a
 * bare `/play/CODE` unconditionally**, with a comment saying PRD 2's first-run network picker would
 * turn it absolute in slice 4 — the picker landed, `settings.joinUrl` landed, and nothing came back
 * to this line. It was invisible until slice 6 rendered a QR code from a pushed `joinUrl`: the admin
 * game page used the real builder and showed the master a correct address while the projector would
 * have encoded a relative path no phone camera can resolve. Exactly PRD 1 §14's first stated risk.
 *
 * Still relative when no address has been chosen, which is `settings.joinUrl`'s own rule and the right
 * one: a guessed origin is a dead QR code that looks authoritative.
 */
function joinUrlFor(runtime: Runtime, code: string): string {
  return buildJoinUrl(readSettings(runtime.paths.dir), runtime.config.PORT, code)
}
