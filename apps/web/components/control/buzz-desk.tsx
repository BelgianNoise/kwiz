'use client'

import type { Attention } from '@kwiz/domain'
import { Check, Pause, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { ZoneProps } from '@/components/control/control-desk'
import { useControlKeys } from '@/components/control/keys'
import { TeamDot } from '@/components/control/team-dot'
import { Button } from '@/components/ui/button'

type Buzz = Extract<Attention, { kind: 'ADJUDICATE_BUZZ' }>

/**
 * PRD 3 §7 — **the most time-critical screen in the product.** The room is silent and looking at the
 * master.
 *
 * Two buttons, nothing else competing. No skip, no next, no reveal: those would be mis-clicks at the
 * worst possible moment, so they are simply not on this screen.
 */
export function BuzzDesk({ view, api, run, buzz }: ZoneProps & { buzz: Buzz }) {
  const t = useTranslations('control.buzz')
  const detail = buzz.buzz

  const adjudicate = (accepted: boolean): void =>
    run(() => api.adjudicate(detail.buzzId, accepted))

  // §13 — the same `Y`/`N` as a validation row, on the one screen where a trackpad is too slow.
  useControlKeys((event) => {
    const key = event.key.toLowerCase()
    if (key !== 'y' && key !== 'n') return false
    adjudicate(key === 'y')
    return true
  })

  const nameOf = (teamId: string): string =>
    view.teams.find((team) => team.id === teamId)?.name ?? ''

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      {/*
       * D35 — stated explicitly, because the master needs to know their thinking time is not
       * costing the other teams theirs.
       */}
      {detail.timerPaused ? (
        <p className="text-muted-foreground flex items-center justify-end gap-2 text-sm">
          <Pause aria-hidden className="size-4" />
          {t('timerPaused')}
        </p>
      ) : null}

      {/* The buzzing team's name dominates, in their colour: the master has to say it out loud
          immediately, and reading it must take no effort. */}
      <div className="flex items-center justify-center gap-4">
        <TeamDot colour={detail.teamColour} className="size-8" />
        <h1 className="text-5xl font-semibold">{detail.teamName}</h1>
      </div>

      <p className="text-muted-foreground text-center tabular-nums">
        {/* Two decimals — the margin *is* the drama (conventions §8.2). */}
        {t('buzzedAt', { seconds: (detail.offsetMs / 1000).toFixed(2) })}
      </p>

      {buzz.referenceAnswer ? (
        <p className="text-center text-2xl">{buzz.referenceAnswer}</p>
      ) : null}

      <div className="flex justify-center gap-6">
        <Button size="lg" className="h-16 w-48 text-xl" onClick={() => adjudicate(true)}>
          <Check aria-hidden />
          {t('correct')} (Y)
        </Button>
        <Button
          size="lg"
          variant="destructive"
          className="h-16 w-48 text-xl"
          onClick={() => adjudicate(false)}
        >
          <X aria-hidden />
          {t('wrong')} (N)
        </Button>
      </div>

      {/* The record behind "who was first", and behind any dispute (D35). */}
      <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt>{t('alsoBuzzed')}</dt>
        <dd>
          {detail.otherBuzzes.length === 0
            ? t('nobodyYet')
            : detail.otherBuzzes
                .map(
                  (other) =>
                    `${nameOf(other.teamId)} ${(other.offsetMs / 1000).toFixed(2)}s`,
                )
                .join(' · ')}
        </dd>

        <dt>{t('lockedOut')}</dt>
        <dd>
          {detail.lockedOutTeamIds.length === 0
            ? t('nobodyYet')
            : detail.lockedOutTeamIds.map(nameOf).join(' · ')}
        </dd>
      </dl>
    </section>
  )
}

/**
 * §7.1's deny loop, which lives on the question desk rather than here — once a buzz is denied there
 * is no buzz to adjudicate, so `attention` has already moved on.
 *
 * D35 rule 5: `[Reopen for everyone]` clears **all** lockouts, for when the master simply misheard.
 * D35 rule 4: when every team is locked out this resolves itself to `ADVANCE / REVEAL` with
 * *"nobody got it"*, so the master is never left with no live buzzers and no prompt.
 */
export function BuzzerState({ view, api, run }: ZoneProps) {
  const t = useTranslations('control.buzz')
  const detail = view.question
  if (!detail?.buzzes || detail.state !== 'OPEN') return null

  const lockedOut = detail.lockedOutTeamIds ?? []
  const canStillBuzz = view.teams.length - lockedOut.length
  // The team whose denial reopened the buzzers — the last one adjudicated wrong.
  const denied = [...detail.buzzes].reverse().find((buzz) => buzz.outcome === 'DENIED')
  const deniedTeam = view.teams.find((team) => team.id === denied?.teamId)

  return (
    <section className="space-y-2">
      {/*
       * §7.1 — **the transition is loud**, in colour and in words, because the master must know the
       * room is live again without reading carefully. It is the one moment on this surface where
       * shouting is the correct design.
       */}
      {deniedTeam && canStillBuzz > 0 ? (
        <p className="text-destructive flex items-center gap-2 text-lg font-medium">
          <X aria-hidden className="size-5" />
          {deniedTeam.name} — {t('wrong').toLowerCase()}. {t('liveAgain')}
        </p>
      ) : null}

      <p className="flex items-center gap-3 text-sm">
        <span>{canStillBuzz > 0 ? t('waiting') : t('nobodyGotIt')}</span>
        <span className="text-muted-foreground">
          {t('canStillBuzz', { count: Math.max(0, canStillBuzz) })}
        </span>
        {lockedOut.length > 0 ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => run(() => api.reopenBuzzers(detail.gameQuestionId))}
          >
            {t('reopen')}
          </Button>
        ) : null}
      </p>

      {lockedOut.length > 0 ? (
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <span>{t('lockedOut')}</span>
          {lockedOut.map((teamId) => {
            const team = view.teams.find((entry) => entry.id === teamId)
            return team ? (
              <span key={teamId} className="flex items-center gap-1">
                <TeamDot colour={team.colour} />
                {team.name}
              </span>
            ) : null
          })}
        </p>
      ) : null}
    </section>
  )
}
