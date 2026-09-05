'use client'

import type { MasterControlView } from '@kwiz/domain'
import { ChevronDown, ExternalLink, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/admin/confirm-dialog'
import { BreakDialog } from '@/components/control/break-desk'
import type { Run } from '@/components/control/control-desk'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ControlApi } from '@/lib/client/api'

/**
 * PRD 3 §2's header: orientation after a glance away, and the one menu.
 *
 * The join code is here because **someone always asks for it again** — a table that arrived late,
 * a phone that was restarted. It is the only piece of the game state on this surface that exists
 * purely to be read aloud.
 */
export function ControlHeader({
  view,
  quizName,
  gameId,
  api,
  run,
  reconnecting,
}: {
  view: MasterControlView
  quizName: string
  gameId: string
  api: ControlApi
  run: Run
  reconnecting: boolean
}) {
  const t = useTranslations('control.frame')
  const tBreak = useTranslations('control.break')
  const [confirm, setConfirm] = useState<'FINISH' | 'ABANDON' | null>(null)
  const [breakOpen, setBreakOpen] = useState(false)

  const live = view.status === 'LIVE'
  const questionOpen = view.question?.state === 'OPEN'
  const currentQuestionId = view.question?.gameQuestionId
  /*
   * §9.1 — skipping is legal from `PENDING` (never opened) or `OPEN` (opened, then abandoned) and
   * nowhere else (D46). The disabled state says exactly that rather than leaving the domain to
   * refuse with `QUESTION_NOT_OPEN`: a menu item that looks available and quietly does nothing is
   * worse than one that is visibly not.
   */
  const canSkip =
    live && (view.question?.state === 'PENDING' || view.question?.state === 'OPEN')
  const round = view.round

  return (
    <header className="col-start-1 row-start-1 flex items-center gap-4 border-b px-4 py-2 text-sm">
      <span className="truncate font-medium">{quizName}</span>

      <span className="text-muted-foreground truncate">
        {/*
         * `view.round` is null in two states that must not share one label (stress-testing
         * findings, ISSUE-3): before `[Start the quiz]`, where "not started" is still true, and
         * live between starting and opening round one, where it reads as if the master's own
         * press hadn't registered. Derived from `status`, not guessed from which is "less wrong".
         */}
        {view.round
          ? t('round', { number: view.round.number, total: view.round.total })
          : live
            ? t('ready')
            : t('notStarted')}
        {view.round ? ` · ${view.round.title}` : ''}
      </span>

      {/* Never small: this is read out to a room across a bar. */}
      <span className="font-mono text-base tracking-widest">
        {t('code', { code: view.code })}
      </span>

      <div className="ml-auto flex items-center gap-3">
        {reconnecting ? (
          <span className="text-destructive">{t('reconnecting')}</span>
        ) : null}

        {/*
         * §12 — passive, and only above one. Two desks are legitimate (there is no auth, PRD 1 §4)
         * and every action is idempotent or event-superseding, so this is information rather than a
         * warning.
         */}
        {view.controlScreens > 1 ? (
          <span className="text-muted-foreground flex items-center gap-1">
            <Users aria-hidden className="size-3.5" />
            {t('otherScreens', { count: view.controlScreens - 1 })}
          </span>
        ) : null}

        <Button asChild size="sm" variant="ghost">
          <a href={`/screen/${gameId}`} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden />
            {t('mainScreen')}
          </a>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              {t('menu')}
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/*
             * §9.1 — **pointer-only, never a keystroke.** A stray key must not be able to discard a
             * question in front of a room, which is why this lives in a menu and not on the desk.
             */}
            <DropdownMenuItem
              disabled={!canSkip}
              onSelect={() => {
                if (currentQuestionId) run(() => api.skipQuestion(currentQuestionId))
              }}
            >
              {t('skipQuestion')}
            </DropdownMenuItem>

            {/*
             * §11.2 — refused over an open question, so late auto-submits cannot trickle in from
             * the phones still awake while the room is at the bar. **With the reason shown**: a
             * greyed item with no explanation is the master wondering whether the app is broken.
             */}
            <DropdownMenuItem
              disabled={!live || questionOpen}
              onSelect={() => setBreakOpen(true)}
            >
              <span className="flex flex-col items-start">
                {view.break ? tBreak('extend') : tBreak('start')}
                {questionOpen ? (
                  <span className="text-muted-foreground text-xs">
                    {tBreak('blocked')}
                  </span>
                ) : null}
              </span>
            </DropdownMenuItem>

            <DropdownMenuItem
              disabled={!live || !round}
              onSelect={() => {
                if (round) run(() => api.closeRound(round.id))
              }}
            >
              {t('closeRound')}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* The two irreversible ones. §1.1 allows a dialog for exactly these, and only these. */}
            <DropdownMenuItem disabled={!live} onSelect={() => setConfirm('FINISH')}>
              {t('finish')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!live}
              variant="destructive"
              onSelect={() => setConfirm('ABANDON')}
            >
              {t('abandon')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'ABANDON' ? t('abandonTitle') : t('finishTitle')}
        body={confirm === 'ABANDON' ? t('abandonBody') : t('finishBody')}
        confirmLabel={confirm === 'ABANDON' ? t('abandon') : t('finish')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          run(() => (confirm === 'ABANDON' ? api.abandon() : api.finish()))
          setConfirm(null)
        }}
      />

      <BreakDialog
        open={breakOpen}
        extending={view.break !== null}
        onOpenChange={setBreakOpen}
        onStart={(durationMs) => {
          run(() => api.startBreak(durationMs))
          setBreakOpen(false)
        }}
      />
    </header>
  )
}
