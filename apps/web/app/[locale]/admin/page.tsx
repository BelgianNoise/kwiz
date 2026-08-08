import { gameWinners, isStale, listGames, listQuizzes } from '@kwiz/db'
import { Settings } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { GameList } from '@/components/admin/game-list'
import { ImportZone } from '@/components/admin/import-zone'
import { NetworkBanner } from '@/components/admin/network-banner'
import { QuizList } from '@/components/admin/quiz-list'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import { isAddressStale } from '@/lib/server/network'
import { getRuntime } from '@/lib/server/runtime'
import { readSettings } from '@/lib/server/settings'

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

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const runtime = await getRuntime()
  const t = await getTranslations('admin.dashboard')

  /**
   * D10 — **first run goes to §4, once.** The picker is not a nag: it is skipped forever after an
   * address is chosen, and §16 is how a master gets back to it. Redirecting rather than rendering a
   * prompt is deliberate, because a dashboard offering `[Play]` before the network is settled leads
   * straight to the dead-QR-code failure §4 exists to prevent.
   */
  const settings = readSettings(runtime.paths.dir)
  const { locale } = await params
  if (settings.networkAddress === null) redirect(`/${locale}/admin/setup`)

  const quizzes = listQuizzes(runtime.database).map((quiz) => ({
    ...quiz,
    updatedAt: quiz.updatedAt.toISOString(),
    // Named here so the delete confirmation can say what survives (§5, data model §10).
    games: 0,
  }))

  const games = listGames(runtime.database)

  /*
   * §5's two at-a-glance columns. The winner comes from the score projection — no replay, so the
   * list does not get slower with every quiz a master has run. The round *does* need state, but only
   * for `LIVE` games, of which PRD 1 §2.1 allows five.
   */
  const winners = gameWinners(runtime.database)
  const liveRound = (id: string): { number: number; total: number } | null => {
    const state = runtime.registry.get(id)
    const index =
      state?.content.rounds.findIndex((round) => round.id === state.currentRoundId) ?? -1
    return state && index >= 0
      ? { number: index + 1, total: state.content.rounds.length }
      : null
  }
  for (const quiz of quizzes) {
    quiz.games = games.filter((game) => game.sourceQuizId === quiz.id).length
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Button asChild variant="ghost" size="icon" aria-label={t('settings')}>
            <Link href="/admin/settings">
              <Settings className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      {/* §4 — a saved address that no longer exists is the second most likely way setup fails. */}
      {isAddressStale(settings.networkAddress) ? (
        <NetworkBanner address={settings.networkAddress} />
      ) : null}

      {/* §14.2 — the drop target is the dashboard itself, so the zone wraps rather than sits beside. */}
      <ImportZone>
        <QuizList quizzes={quizzes} />
      </ImportZone>

      <GameList
        games={games.map((game) => ({
          id: game.id,
          status: game.status,
          code: game.code,
          quizName: game.quizName,
          teams: game.teams,
          createdAt: game.createdAt.toISOString(),
          stale: isStale(game),
          winners: winners.get(game.id) ?? [],
          round: game.status === 'LIVE' ? liveRound(game.id) : null,
        }))}
      />
    </main>
  )
}
