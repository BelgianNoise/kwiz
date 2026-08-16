'use client'

import type { MissedSoFar } from '@kwiz/domain'
import {
  AlertTriangle,
  ChevronLeft,
  ExternalLink,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AddTeamDialog } from '@/components/admin/add-team-dialog'
import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { ExportDialog } from '@/components/admin/export-dialog'
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
  /** The quiz this game was copied from — `null` once that quiz has been deleted (data model §10). */
  sourceQuizId: string | null
  /** §12.1's confirmation names the loss, because not knowing what goes is what stops masters tidying. */
  loss: { teams: number; answers: number }
  code: string
  /** Absolute once §4's address is chosen, relative until then — never a guess (§4). */
  joinUrl: string
  /** `null` until an address is chosen: a QR code for a relative path leads nowhere. */
  qr: string | null
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
export function GameDetail({
  game,
  teams,
  missed,
  round,
}: {
  game: GameDetailData
  teams: TeamRow[]
  /** §11.2 — `null` while `SETUP`, when there is nothing to have missed. */
  missed: MissedSoFar | null
  round: { number: number; total: number } | null
}) {
  const t = useTranslations('admin.game')
  const dashboard = useTranslations('admin.dashboard')
  const router = useRouter()

  const [addingTeam, setAddingTeam] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
              {/* §14.1 — quiz + **this** game only, which is what "export this game" means. */}
              {game.sourceQuizId ? (
                <DropdownMenuItem onSelect={() => setExporting(true)}>
                  {t('exportGame')}
                </DropdownMenuItem>
              ) : null}
              {game.status === 'SETUP' || game.status === 'LIVE' ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setAbandoning(true)}
                >
                  {t('abandon')}
                </DropdownMenuItem>
              ) : null}
              {/* Any status (§12.1). Per game, never in bulk — see `deleteGame`. */}
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                {t('deleteGame')}
              </DropdownMenuItem>
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
        <p className="text-muted-foreground font-mono text-sm break-all">
          {game.joinUrl}
        </p>

        {/*
          §12 — the QR code beside the code, not instead of it. A phone with a dead camera, a guest
          who cannot find their camera app, and a code read aloud across a room are all normal, so
          the six characters stay the primary route in.

          Trusted markup: `qrcode`'s own SVG output for a string this server built.
        */}
        {game.qr ? (
          <div
            className="[&_svg]:size-40 [&_svg]:rounded-lg [&_svg]:bg-white [&_svg]:p-2"
            // oxlint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: game.qr }}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t('noAddress')}</p>
        )}
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

        {/*
          PRD 2 §13 — *"two views on a finished (or live) game, both under §12 once the game has
          started."* Not a new tab: unlike the two above, this is the same person at the same laptop
          rather than a second display, and reviewing mid-game is a legitimate reason to leave the
          control desk for a moment.
        */}
        {game.status === 'SETUP' ? null : (
          <Button asChild variant="secondary">
            <Link href={`/admin/games/${game.id}/review`}>{t('review')}</Link>
          </Button>
        )}
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

      {/*
        §11.2 — available at **every** status. A table arriving during round 1 is normal, and the
        dialog is where the decision gets made, so there is nothing to gate here.
      */}
      <div>
        <Button variant="secondary" size="sm" onClick={() => setAddingTeam(true)}>
          <Plus className="size-4" />
          {t('addTeam')}
        </Button>
      </div>

      <AddTeamDialog
        open={addingTeam}
        gameId={game.id}
        teamCount={teams.length}
        takenColours={teams.map((team) => team.colour)}
        missed={missed}
        round={round}
        onClose={() => setAddingTeam(false)}
      />

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

      {game.sourceQuizId ? (
        <ExportDialog
          open={exporting}
          quizId={game.sourceQuizId}
          quizName={game.quizName}
          games={1}
          onlyGameId={game.id}
          onClose={() => setExporting(false)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle')}
        body={t('deleteBody', { teams: game.loss.teams, answers: game.loss.answers })}
        confirmLabel={t('deleteGame')}
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false)
          // Back to the dashboard: staying on the page of something that no longer exists would
          // render a 404 the master did not ask for.
          void api.deleteGame(game.id).then(() => router.push('/admin'))
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
