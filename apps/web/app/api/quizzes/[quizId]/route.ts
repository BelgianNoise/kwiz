import { loadQuizTree } from '@kwiz/db'
import { fail, ok } from '@kwiz/domain'

import { actionResponse } from '@/lib/server/http'
import { getRuntime } from '@/lib/server/runtime'

/**
 * `GET /api/quizzes/:quizId` — the whole template tree for the editors.
 *
 * Unbounded by nature (protocol §1.1: a quiz is O(questions)), which is exactly why it is a REST
 * read rather than anything that could end up on a stream.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ quizId: string }> },
): Promise<Response> {
  const runtime = await getRuntime()
  const { quizId } = await params

  const tree = loadQuizTree(runtime.database, quizId)
  return actionResponse(tree ? ok(tree) : fail('GAME_NOT_FOUND', `no quiz ${quizId}`))
}
