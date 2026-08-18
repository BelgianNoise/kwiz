import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'

export interface FinalStanding {
  teamId: string
  name: string
  colour: string
  rank: number
  score: number
}

/**
 * PRD 5 §15 O3 — **what a finished game's code shows now.**
 *
 * *"The likely visitor is someone reopening a bookmark the morning after, and standings are what
 * they want."* Slice 7 could not serve this: a finished game's code stops resolving (data model
 * §6.1), so the only honest answer then was *"this code will not get you into a game"*. Slice 8's
 * review read is what makes the standings reachable without a joinable game.
 *
 * **Static, and no stream.** There is nothing left to push — the game is over, and opening an SSE
 * connection for a phone that will read one screen and close it is the polling §12 rules out. This
 * is also why it is a server component: one render, no client bundle, no reconnect loop.
 *
 * `ABANDONED` never reaches here. O3 gives it *"a bare message"*, and announcing standings for a
 * game the master pulled would be a winner nobody won — the same rule the live surface follows.
 */
export async function FinalStandings({
  quizName,
  standings,
}: {
  quizName: string
  standings: FinalStanding[]
}) {
  const t = await getTranslations('player.finished')

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 p-6">
      <header>
        <p className="text-muted-foreground text-lg">{quizName}</p>
        <h1 className="text-3xl font-semibold">{t('finalScores')}</h1>
      </header>

      <ol className="flex flex-col gap-2">
        {standings.map((standing) => (
          <li
            key={standing.teamId}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-lg"
          >
            {/* D32 — ties share a rank and show it; nothing here breaks one. */}
            <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">
              {standing.rank}
            </span>
            {/* PRD 1 §9.5 — colour beside the name, never instead of it. */}
            <span
              aria-hidden
              className="size-4 shrink-0 rounded-full"
              style={{ backgroundColor: standing.colour }}
            />
            <span className="min-w-0 flex-1 truncate">{standing.name}</span>
            <span className="shrink-0 tabular-nums">{standing.score}</span>
          </li>
        ))}
      </ol>

      {/*
        No team is highlighted, unlike the live `FINISHED` stage: this page has no device token and
        therefore no idea whose phone it is. Guessing would be worse than not marking one.
      */}
      <p className="text-muted-foreground text-lg">{t('gameOver')}</p>
      <Link href="/" className="text-lg underline underline-offset-4">
        {t('backHome')}
      </Link>
    </main>
  )
}
