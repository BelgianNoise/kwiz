'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'

export interface GameRow {
  id: string
  status: 'SETUP' | 'LIVE' | 'FINISHED' | 'ABANDONED'
  code: string
  quizName: string
  teams: number
  createdAt: string
  stale: boolean
}

/**
 * PRD 2 §5's game section.
 *
 * **Live and setup games are pinned above finished ones, and finished ones are collapsed behind a
 * toggle.** A master who has run thirty quizzes should not scroll past them to find tonight's.
 */
export function GameList({ games }: { games: GameRow[] }) {
  const t = useTranslations('admin.dashboard')
  const format = useFormatter()
  const [showFinished, setShowFinished] = useState(false)

  const running = games.filter(
    (game) => game.status === 'SETUP' || game.status === 'LIVE',
  )
  const done = games.filter((game) => game.status !== 'SETUP' && game.status !== 'LIVE')
  const shown = showFinished ? [...running, ...done] : running

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('games')}</h2>
        {done.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFinished(!showFinished)}
          >
            {showFinished ? t('hideFinished') : t('showFinished')}
          </Button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          {t('emptyGames')}
        </div>
      ) : (
        <ul className="divide-border border-border divide-y rounded-xl border">
          {shown.map((game) => (
            <li key={game.id} className="flex flex-wrap items-center gap-3 p-4">
              <Badge variant={game.status === 'LIVE' ? 'default' : 'secondary'}>
                {t(`status.${game.status}`)}
              </Badge>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{game.quizName}</p>
                <p className="text-muted-foreground text-sm">
                  {game.status === 'SETUP' || game.status === 'LIVE'
                    ? t('code', { code: game.code })
                    : format.dateTime(new Date(game.createdAt), {
                        day: 'numeric',
                        month: 'short',
                      })}{' '}
                  · {t('teamCount', { count: game.teams })}
                </p>
              </div>

              {/*
                §5 — without this badge a master edits the template, wonders why the game still
                shows the typo, and never learns that a re-sync exists (data model §7.1).
              */}
              {game.stale ? (
                <Badge variant="outline">⚠ {t('templateUpdated')}</Badge>
              ) : null}

              <Button asChild variant="secondary">
                <Link href={`/admin/games/${game.id}`}>{t('open')}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
