'use client'

import type { Attention } from '@kwiz/domain'
import { NotebookPen } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import type { ZoneProps } from '@/components/control/control-desk'
import { digitIndex, useControlKeys } from '@/components/control/keys'
import { TeamDot } from '@/components/control/team-dot'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Scoring = Extract<Attention, { kind: 'SCORE_DO' }>

/** PRD 3 §8 — a physical challenge just finished and the teams are watching for a verdict. */
export function DoDesk({
  view,
  api,
  run,
  gameId,
  scoring,
}: ZoneProps & { scoring: Scoring }) {
  const t = useTranslations('control.question')

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm">
          {t('points', { points: scoring.points })}
        </p>
        <h1 className="text-2xl font-medium">{scoring.prompt}</h1>
        {scoring.masterNotes ? (
          <p className="bg-muted flex items-start gap-2 rounded-md p-2 text-sm">
            <NotebookPen aria-hidden className="mt-0.5 size-4 shrink-0" />
            {scoring.masterNotes}
          </p>
        ) : null}
      </header>

      {scoring.scoringMode === 'WINNER_TAKES_ALL' ? (
        <WinnerTakesAll
          view={view}
          api={api}
          run={run}
          gameId={gameId}
          scoring={scoring}
        />
      ) : (
        <PerTeamScore view={view} api={api} run={run} gameId={gameId} scoring={scoring} />
      )}
    </section>
  )
}

/**
 * §8.1 — large team tiles, selectable by tap or by number key.
 *
 * **Multi-select is hinted in place**: D23 allows ties, but a master will not discover it without
 * being told and will otherwise pick one winner arbitrarily. `[Nobody got it]` is a real button for
 * the same reason — sometimes every team fails, and the master needs to say so decisively rather
 * than invent a winner.
 */
function WinnerTakesAll({ api, run, scoring }: ZoneProps & { scoring: Scoring }) {
  const t = useTranslations('control.do')
  const [selected, setSelected] = useState<string[]>([])

  const toggle = (teamId: string): void =>
    setSelected((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId],
    )

  // §13 — `1`–`9` selects a team.
  useControlKeys((event) => {
    const index = digitIndex(event)
    const team = index === null ? undefined : scoring.teams[index]
    if (!team) return false
    toggle(team.teamId)
    return true
  })

  const award = (teamIds: string[]): void =>
    run(() => api.doWinners(scoring.gameQuestionId, teamIds))

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg">{t('whoWon')}</h2>
        <span className="text-muted-foreground text-sm">{t('tieHint')}</span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {scoring.teams.map((team, index) => (
          <li key={team.teamId}>
            <button
              type="button"
              aria-pressed={selected.includes(team.teamId)}
              onClick={() => toggle(team.teamId)}
              className={cn(
                'flex h-14 w-full items-center gap-3 rounded-md border px-4 text-lg',
                selected.includes(team.teamId)
                  ? 'border-foreground bg-accent'
                  : 'hover:bg-accent/50',
              )}
            >
              <span className="text-muted-foreground w-4 text-sm tabular-nums">
                {index + 1}
              </span>
              <TeamDot colour={team.colour} className="size-4" />
              <span className="min-w-0 flex-1 truncate text-left">{team.name}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between">
        {/* `[]` is the explicit "nobody got it" (D23), not an omission. */}
        <Button variant="outline" onClick={() => award([])}>
          {t('nobody')}
        </Button>

        {/* The button reflects the configured payout, so a tie's consequence is visible before
            it is committed (D23). */}
        <Button
          size="lg"
          disabled={selected.length === 0}
          onClick={() => award(selected)}
        >
          {selected.length > 1
            ? scoring.tiePayout === 'SPLIT'
              ? t('awardSplit', { points: scoring.points })
              : t('awardEach', { points: scoring.points })
            : t('award', { points: scoring.points })}
        </Button>
      </div>
    </div>
  )
}

/**
 * §8.2 — a data-entry task, and it should feel like one. Tab moves down the list.
 *
 * **Empty and zero look different** while entering (D24): a master half-way through needs to see who
 * they have not got to, even though both resolve to 0. Values are clamped to `0…points` on entry
 * rather than rejected on save.
 */
function PerTeamScore({ api, run, scoring }: ZoneProps & { scoring: Scoring }) {
  const t = useTranslations('control.do')

  // Seeded from what has actually been saved, so re-opening a partially scored question shows the
  // work already done rather than a blank sheet.
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      scoring.teams.map((team) => [
        team.teamId,
        team.score === null ? '' : String(team.score),
      ]),
    ),
  )

  const entered = scoring.teams.filter(
    (team) => (scores[team.teamId] ?? '').trim() !== '',
  ).length

  const save = (): void =>
    run(() =>
      api.doScores(
        scoring.gameQuestionId,
        scoring.teams
          .filter((team) => (scores[team.teamId] ?? '').trim() !== '')
          .map((team) => ({
            teamId: team.teamId,
            score: clamp(Number(scores[team.teamId]), scoring.points),
          })),
      ),
    )

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg">{t('scoreEach')}</h2>
        <span className="text-muted-foreground text-sm">
          {t('max', { points: scoring.points })} ·{' '}
          {t('scored', { scored: entered, total: scoring.teams.length })}
        </span>
      </div>

      <ul className="space-y-2">
        {scoring.teams.map((team) => {
          const empty = (scores[team.teamId] ?? '').trim() === ''
          return (
            <li
              key={team.teamId}
              className="flex items-center gap-3"
              /*
               * Same signal as an unjudged answer row (`question-desk.tsx`), and the same
               * reason: a master mid-conversation with the room, three rows in, is the exact
               * moment the fourth, still-blank one is easiest to walk past — D24's own
               * distinction between "not got to yet" and "scored zero" is invisible at a
               * glance otherwise, since both render as an empty-looking box either way.
               */
              style={
                empty
                  ? { animation: 'kwiz-attention 2.4s ease-in-out infinite' }
                  : undefined
              }
            >
              <TeamDot colour={team.colour} />
              <span className="min-w-0 flex-1 truncate">{team.name}</span>
              <Input
                aria-label={team.name}
                className="w-20 text-right tabular-nums"
                inputMode="numeric"
                value={scores[team.teamId] ?? ''}
                /*
                 * §8.2 — **clamped on entry, not rejected on save.** A master typing 99 into a
                 * 20-point question sees it become 20 while they are still looking at the row, rather
                 * than discovering it after pressing save. An empty box stays empty: that is D24's
                 * distinction between "not got to yet" and "scored zero".
                 */
                onChange={(event) => {
                  const typed = event.target.value
                  setScores((current) => ({
                    ...current,
                    [team.teamId]:
                      typed.trim() === ''
                        ? ''
                        : String(clamp(Number(typed), scoring.points)),
                  }))
                }}
              />
            </li>
          )
        })}
      </ul>

      <Button size="lg" onClick={save}>
        {t('save')}
      </Button>
    </div>
  )
}

const clamp = (value: number, max: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), max) : 0
