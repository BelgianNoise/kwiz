import { findGame, isStale, listGames, loadQuizTree } from '@kwiz/db'
import { notFound } from 'next/navigation'

import { GameDetail } from '@/components/admin/game-detail'
import { getRuntime } from '@/lib/server/runtime'

/**
 * PRD 2 §12 — the hub for one game, before, during and after.
 *
 * Per D21 neither launch link is "the current game": both carry this `gameId`, and so does every
 * route on this page. There is deliberately no route that means the current one.
 */
export const dynamic = 'force-dynamic'

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ gameId: string }>
}) {
  const runtime = await getRuntime()
  const { gameId } = await params

  const game = findGame(runtime.database, gameId)
  const summary = listGames(runtime.database).find((entry) => entry.id === gameId)
  if (!game || !summary) notFound()

  // The copy subtree, not the template: this is what the game will actually play (data model §5).
  const state = runtime.registry.get(gameId)
  const template = game.sourceQuizId
    ? loadQuizTree(runtime.database, game.sourceQuizId)
    : undefined

  return (
    <GameDetail
      game={{
        id: game.id,
        code: game.code,
        status: game.status,
        quizName: game.quizName,
        stale: isStale(summary),
        rounds: state?.content.rounds.length ?? 0,
        questions:
          state?.content.rounds.reduce(
            (total, round) => total + round.questions.length,
            0,
          ) ?? 0,
        hasTemplate: template !== undefined,
      }}
      teams={[...(state?.teams.values() ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((team) => ({
          id: team.id,
          name: team.name,
          colour: team.colour,
          deviceCount: team.deviceCount,
        }))}
    />
  )
}
