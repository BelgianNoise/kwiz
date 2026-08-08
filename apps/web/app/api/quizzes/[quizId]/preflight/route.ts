import { findAttachmentFile, loadQuizTree } from '@kwiz/db'
import { fail, ok, preflight } from '@kwiz/domain'

import { findBrokenAttachments } from '@/lib/server/attachments'
import { actionResponse } from '@/lib/server/http'
import { getRuntime } from '@/lib/server/runtime'

/**
 * `GET /api/quizzes/:quizId/preflight` — PRD 2 §10, run when `[Play]` is pressed and available from
 * the quiz editor at any time.
 *
 * The rules are pure and live in `@kwiz/domain`; this adds the one thing they cannot know, which is
 * whether each attachment's file is still on disk and still hashes to its checksum. That check is
 * the reason pre-flight catches *"the audio for question 12 is damaged"* rather than the room
 * discovering it.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ quizId: string }> },
): Promise<Response> {
  const runtime = await getRuntime()
  const { quizId } = await params

  const quiz = loadQuizTree(runtime.database, quizId)
  if (!quiz) return actionResponse(fail('GAME_NOT_FOUND', `no quiz ${quizId}`))

  const files = quiz.rounds
    .flatMap((round) => round.questions)
    .flatMap((question) => question.media)
    .map((media) => ({
      id: media.id,
      file: findAttachmentFile(runtime.database, media.id),
    }))
    .filter(
      (
        entry,
      ): entry is {
        id: string
        file: { checksum: string; ext: string; mimeType: string }
      } => entry.file !== undefined,
    )
    .map((entry) => ({
      id: entry.id,
      checksum: entry.file.checksum,
      ext: entry.file.ext,
    }))

  const brokenAttachmentIds = await findBrokenAttachments(runtime.paths, files)

  // The team count is an assumption while authoring and exact at game setup (D58, §9, §11.1), so
  // the caller states it rather than this endpoint guessing.
  const assumedTeams = Number(new URL(request.url).searchParams.get('teams') ?? '4')

  return actionResponse(
    ok(
      preflight(quiz, {
        brokenAttachmentIds,
        assumedTeams:
          Number.isFinite(assumedTeams) && assumedTeams > 1 ? assumedTeams : 4,
      }),
    ),
  )
}
