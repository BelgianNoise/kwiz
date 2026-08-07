import { isStale, listGames, listQuizzes } from '@kwiz/db'
import { getTranslations } from 'next-intl/server'

import { GameList } from '@/components/admin/game-list'
import { QuizList } from '@/components/admin/quiz-list'
import { LanguageSwitcher } from '@/components/language-switcher'
import { getRuntime } from '@/lib/server/runtime'

/**
 * PRD 2 §5 — the dashboard. Quizzes above games, because `[Play]` is the verb a master reaches for.
 *
 * A **server component**: it reads the database directly rather than fetching its own API, which
 * would be a round trip to itself. The REST reads (protocol §7.4) exist for the client islands that
 * need to re-read without a full navigation, and for the review screens in slice 8.
 *
 * This is also the page that creates the database on a first ever visit (PRD 1 §6.6) — `getRuntime`
 * boots it, so the empty state below is a real screen rather than an error.
 */
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const runtime = await getRuntime()
  const t = await getTranslations('admin.dashboard')

  const quizzes = listQuizzes(runtime.database).map((quiz) => ({
    ...quiz,
    updatedAt: quiz.updatedAt.toISOString(),
    // Named here so the delete confirmation can say what survives (§5, data model §10).
    games: 0,
  }))

  const games = listGames(runtime.database)
  for (const quiz of quizzes) {
    quiz.games = games.filter((game) => game.sourceQuizId === quiz.id).length
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 p-6 sm:p-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <LanguageSwitcher />
      </header>

      <QuizList quizzes={quizzes} />

      <GameList
        games={games.map((game) => ({
          id: game.id,
          status: game.status,
          code: game.code,
          quizName: game.quizName,
          teams: game.teams,
          createdAt: game.createdAt.toISOString(),
          stale: isStale(game),
        }))}
      />
    </main>
  )
}
