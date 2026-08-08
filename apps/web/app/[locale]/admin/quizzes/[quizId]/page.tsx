import { listGames, loadQuizTree } from '@kwiz/db'
import { notFound } from 'next/navigation'

import { QuizEditor } from '@/components/admin/quiz-editor'
import { getRuntime } from '@/lib/server/runtime'

/**
 * PRD 2 §6 — the quiz editor: name, description and the round list.
 *
 * The tree is loaded server-side and handed to one client component, which mutates through the
 * typed client and calls `router.refresh()` to re-run this. That keeps a single source of truth for
 * what is on screen — the database — rather than a client cache that can disagree with it.
 */
export const dynamic = 'force-dynamic'

export default async function QuizEditorPage({
  params,
}: {
  params: Promise<{ quizId: string }>
}) {
  const runtime = await getRuntime()
  const { quizId } = await params

  const quiz = loadQuizTree(runtime.database, quizId)
  if (!quiz) notFound()

  // The export dialog offers the "quiz + N played games" option only when there are any (§14.1).
  const games = listGames(runtime.database).filter(
    (entry) => entry.sourceQuizId === quizId,
  ).length

  return <QuizEditor quiz={quiz} games={games} />
}
