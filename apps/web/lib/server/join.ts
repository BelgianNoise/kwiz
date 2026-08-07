import { randomBytes } from 'node:crypto'

import { findJoinableGameByCode } from '@kwiz/db'
import { fail, ok, type ActionResult } from '@kwiz/domain'
import { v7 as uuidv7 } from 'uuid'

import type { Runtime } from './runtime'
import { runCommand, type CommandContext } from './service'

/**
 * `POST /api/games/join` (protocol §7.1) — the one action that resolves a game by **code** rather
 * than by id, because a phone scanning a QR has nothing else.
 *
 * It is also the only action that returns data: the fresh `deviceToken`. Everything else a client
 * learns arrives on the stream (protocol §7).
 */
export interface JoinResult {
  gameId: string
  teamId: string
  /** Held in `localStorage` and presented on every later request. Continuity, not authentication. */
  deviceToken: string
}

export function runJoin(
  runtime: Runtime,
  input: { code: string; teamId: string; now: number },
): ActionResult<JoinResult> {
  // Normalisation happens inside the lookup (conventions §2), so `kw-lz oa` finds `KW1Z0A`.
  const game = findJoinableGameByCode(runtime.database, input.code)
  // A finished game's code no longer resolves, which is indistinguishable from a wrong code — and
  // that is the right answer for a player: this code will not get you into a game.
  if (!game) return fail('GAME_NOT_FOUND', `no joinable game with code ${input.code}`)

  const context: CommandContext = { runtime, gameId: game.id, now: input.now }
  const deviceId = uuidv7()
  /*
   * 32 bytes of CSPRNG, base64url so it survives a header and `localStorage` untouched.
   *
   * It is **device continuity, not authentication** (PRD 1 §4): anyone on the network can open
   * `/control`, so a token guards nothing. What it does is let a phone that slept, reloaded, or
   * survived a server restart come back as the same device on the same team.
   */
  const deviceToken = randomBytes(32).toString('base64url')

  const result = runCommand(context, {
    type: 'JOIN',
    teamId: input.teamId,
    deviceId,
    deviceToken,
    maxDevicesPerTeam: runtime.config.KWIZ_MAX_DEVICES_PER_TEAM,
  })
  if (!result.ok) return result

  return ok({ gameId: game.id, teamId: input.teamId, deviceToken })
}
