import { randomBytes } from 'node:crypto'

import {
  appendAndProject,
  createGameFromQuiz,
  generateUnusedCode,
  isStale,
  listGames,
} from '@kwiz/db'
import { fail, LOCALES, ok } from '@kwiz/domain'
import { z } from 'zod'

import { actionResponse, parseBody, readJsonBody, UNPARSEABLE } from '@/lib/server/http'
import { getRuntime, isDatabaseUsable } from '@/lib/server/runtime'

/**
 * `GET /api/games` (protocol §7.4) — the dashboard's game list, and `POST /api/games` — PRD 2 §11's
 * game setup, which is where a quiz becomes something a room can play.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const runtime = await getRuntime()
  return actionResponse(
    ok(
      listGames(runtime.database).map((game) => ({
        ...game,
        // The `⚠ template updated` badge (§5): computed here so the dashboard cannot get the
        // comparison subtly wrong, and so the re-sync action appears exactly when it would do
        // something.
        stale: isStale(game),
      })),
    ),
  )
}

const setupSchema = z.object({
  quizId: z.string().min(1),
  teams: z
    .array(
      z.object({
        name: z.string().min(1),
        /** Resolved hex from the palette, never an index (data model §6.2). */
        colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      }),
    )
    .min(1),
  /** D29 — a default for devices joining, never a lock on a player's own choice. */
  defaultPlayerLocale: z.enum(LOCALES).default('en'),
  /**
   * §11.1 — offered only when the quiz ends in a finale, because the right penalty depends on the
   * team count being decided on that very screen (D54). Written as an event rather than into the
   * game copy, which I16 forbids.
   */
  finale: z
    .object({
      secondsPerPoint: z.number().positive(),
      penaltySeconds: z.number().int().nonnegative(),
    })
    .optional(),
})

export async function POST(request: Request): Promise<Response> {
  const server = await getRuntime()
  if (!isDatabaseUsable(server)) {
    return actionResponse(
      fail('DATABASE_MIGRATION_REQUIRED', 'the database has pending migrations'),
    )
  }

  const body = await readJsonBody(request)
  if (body === UNPARSEABLE) {
    return actionResponse(fail('VALIDATION_ERROR', 'the request body is not JSON'))
  }
  const parsed = parseBody(setupSchema, body)
  if (!parsed.ok) return actionResponse(parsed)

  // The code is generated, never picked (§11): it has to be unique among joinable games, and a
  // master choosing one is a collision waiting to happen.
  const code = generateUnusedCode(server.database, (size) => randomBytes(size))
  const created = createGameFromQuiz(server.database, {
    quizId: parsed.data.quizId,
    code,
    defaultPlayerLocale: parsed.data.defaultPlayerLocale,
    teams: parsed.data.teams,
  })
  if (!created.ok || !created.data) return actionResponse(created)

  if (parsed.data.finale) {
    appendAndProject(server.database, created.data.gameId, [
      { type: 'FINALE_CONFIGURED', payload: parsed.data.finale },
    ])
  }

  return actionResponse(ok({ gameId: created.data.gameId, code }))
}
