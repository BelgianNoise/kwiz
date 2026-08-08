'use client'

import {
  AlertTriangle,
  ChevronLeft,
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { LiveTeams } from '@/components/admin/live-teams'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Link, useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'

export interface GameDetailData {
  id: string
  code: string
  status: 'SETUP' | 'LIVE' | 'FINISHED' | 'ABANDONED'
  quizName: string
  stale: boolean
  rounds: number
  questions: number
  hasTemplate: boolean
}

export interface TeamRow {
  id: string
  name: string
  colour: string
  deviceCount: number
}

/**
 * PRD 2 §12 — the game hub.
 *
 * **The code is the visual anchor**, because during setup this page *is* what the master is using
 * while people arrive. The two launch buttons open new tabs, since the two surfaces live on two
 * displays — and both URLs carry this `gameId`, because per D21 there is no "current game".
 */
export function GameDetail({ game, teams }: { game: GameDetailData; teams: TeamRow[] }) {
  const t = useTranslations('admin.game')
  const dashboard = useTranslations('admin.dashboard')
  const router = useRouter()

  const [regenerating, setRegenerating] = useState(false)
  const [abandoning, setAbandoning] = useState(false)

  const refresh = (): void => router.refresh()

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin">
            <ChevronLeft className="size-4" />
            {dashboard('title')}
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <Badge variant={game.status === 'LIVE' ? 'default' : 'secondary'}>
            {dashboard(`status.${game.status}`)}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={game.quizName}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {game.status === 'SETUP' || game.status === 'LIVE' ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setAbandoning(true)}
                >
                  {t('abandon')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <h1 className="text-2xl font-semibold tracking-tight">{game.quizName}</h1>

      <section className="border-border space-y-3 rounded-xl border p-6">
        <p className="text-muted-foreground text-sm">{t('join')}</p>
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-mono text-4xl tracking-widest tabular-nums">
            {game.code}
          </span>
          {game.status === 'SETUP' ? (
            <Button variant="secondary" size="sm" onClick={() => setRegenerating(true)}>
              <RefreshCw className="size-4" />
              {t('regenerate')}
            </Button>
          ) : null}
        </div>
        {/*
          The join URL is relative until PRD 2 §4's network picker exists: the server does not know
          which of the laptop's addresses a phone can reach, and guessing produces a QR code that
          resolves to nothing (PRD 1 §14's first risk).
        */}
        <p className="text-muted-foreground text-sm">/play/{game.code}</p>
      </section>

      <div className="flex flex-wrap gap-3">
        {/* Two displays, so two tabs (§12). */}
        <Button asChild variant="secondary">
          <a href={`/screen/${game.id}`} target="_blank" rel="noreferrer">
            {t('openMainScreen')}
            <ExternalLink className="size-4" />
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a href={`/control/${game.id}`} target="_blank" rel="noreferrer">
            {t('openControl')}
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>

      {/*
        §12 — the re-sync banner appears only while `SETUP` and only when stale, and its confirmation
        states what survives. Without it a master edits the template, wonders why the game still shows
        the typo, and never learns a re-sync exists (data model §7.1).
      */}
      {game.stale && game.hasTemplate ? (
        <section className="border-border flex flex-wrap items-center gap-3 rounded-xl border p-4">
          <AlertTriangle className="text-destructive size-4" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t('staleTitle')}</p>
            <p className="text-muted-foreground text-sm">{t('staleBody')}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void api.resyncGame(game.id).then(refresh)
            }}
          >
            {t('resync')}
          </Button>
        </section>
      ) : null}

      {/* Live over the `MASTER_CONTROL` stream rather than polling (§12, D2). */}
      <LiveTeams gameId={game.id} initial={teams} />

      <p className="text-muted-foreground text-sm">
        {t('rounds', { rounds: game.rounds, questions: game.questions })}
        {game.status === 'SETUP' ? ` · ${t('notStarted')}` : ''}
      </p>

      <ConfirmDialog
        open={regenerating}
        title={t('regenerateTitle')}
        body={t('regenerateBody')}
        confirmLabel={t('regenerate')}
        onCancel={() => setRegenerating(false)}
        onConfirm={() => {
          setRegenerating(false)
          void api.regenerateCode(game.id).then(refresh)
        }}
      />

      <ConfirmDialog
        open={abandoning}
        title={t('abandonTitle')}
        body={t('abandonBody')}
        confirmLabel={t('abandon')}
        onCancel={() => setAbandoning(false)}
        onConfirm={() => {
          setAbandoning(false)
          void api.abandonGame(game.id).then(refresh)
        }}
      />
    </main>
  )
}
