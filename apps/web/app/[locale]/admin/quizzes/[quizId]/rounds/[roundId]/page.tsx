import { loadQuizTree } from '@kwiz/db'
import { notFound } from 'next/navigation'

import { BoardBuilder } from '@/components/admin/board-builder'
import { FinaleEditor } from '@/components/admin/finale-editor'
import { QuestionSetEditor } from '@/components/admin/question-set-editor'
import { getRuntime } from '@/lib/server/runtime'

/**
 * PRD 2 §7, §8 and §9 — one route, three editors, chosen by the round's type.
 *
 * They are genuinely different surfaces rather than one form with variations: a Jeopardy round is
 * **authored as a board** because that is what the room will see (§8), and a finale is two numbers
 * plus a keyword list. A single list-of-questions editor would let a master build a board that looks
 * wrong on the projector without ever noticing.
 */
export const dynamic = 'force-dynamic'

export default async function RoundEditorPage({
  params,
}: {
  params: Promise<{ quizId: string; roundId: string }>
}) {
  const runtime = await getRuntime()
  const { quizId, roundId } = await params

  const quiz = loadQuizTree(runtime.database, quizId)
  const round = quiz?.rounds.find((candidate) => candidate.id === roundId)
  if (!quiz || !round) notFound()

  switch (round.type) {
    case 'JEOPARDY':
      return <BoardBuilder quiz={quiz} round={round} />
    case 'DSMTW_FINALE':
      return <FinaleEditor quiz={quiz} round={round} />
    default:
      return <QuestionSetEditor quiz={quiz} round={round} />
  }
}
