'use client'

import type { Attention, MasterControlView } from '@kwiz/domain'
import {
  FINALE_CLOCK_WARN_S,
  pointsPerSecond,
  suggestFinaleQuestions,
} from '@kwiz/domain'
import { NotebookPen } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { usePrimaryAction, type ZoneProps } from '@/components/control/control-desk'
import { digitIndex, useControlKeys } from '@/components/control/keys'
import { AdvanceButton } from '@/components/control/leaderboard'
import { TeamDot } from '@/components/control/team-dot'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useElapsed } from '@/lib/client/use-countdown'
import { cn } from '@/lib/utils'

type Turn = Extract<Attention, { kind: 'FINALE_TURN' }>
type Picking = Extract<Attention, { kind: 'PICK_FINALISTS' }>

/** How many keywords a finale question has (I17). The penalty arithmetic below is per question. */
const KEYWORDS_PER_QUESTION = 5

/**
 * PRD 3 §10.1 — picking finalists.
 *
 * **Descending score order, all pre-selected** (D55): deselecting the bottom few is then a couple of
 * clicks, which is the common case, and the master never has to hunt.
 *
 * The two numbers beside each row are the point of the screen. `0s · out at once` is spelled out
 * because D56 has no floor — a team on zero points is eliminated before speaking — and the penalty
 * arithmetic is restated live against the actual finalist count, because it is the one number that
 * decides whether the round lasts five questions or one.
 */
export function FinalistPicker({ api, run, picking }: ZoneProps & { picking: Picking }) {
  const t = useTranslations('control.finale')
  const candidates = picking.candidates
  const [chosen, setChosen] = useState<string[]>(() =>
    candidates.map((candidate) => candidate.teamId),
  )

  const finalists = candidates.filter((candidate) => chosen.includes(candidate.teamId))
  const pool = finalists.reduce((total, candidate) => total + candidate.seconds, 0)
  const penalty = picking.penaltySeconds

  /*
   * Seconds one question can take out of the pool if all five keywords are found: each find charges
   * every team **except** the one that found it, so the round drains faster with more finalists in
   * it. This is the same shape as `suggestFinaleQuestions`'s inner term (conventions §8.1) rather
   * than a second piece of arithmetic beside it.
   */
  const worstCase = penalty * KEYWORDS_PER_QUESTION * Math.max(0, finalists.length - 1)

  const suggested = suggestFinaleQuestions(
    finalists.map((candidate) => candidate.seconds),
    penalty,
  )

  const toggle = (teamId: string): void =>
    setChosen((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId],
    )

  // Minimum two (D55). `Enter` is the same refusal as the button: it simply is not the primary
  // action yet.
  usePrimaryAction(chosen.length < 2 ? null : () => run(() => api.setFinalists(chosen)))

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-medium">{t('whoPlays')}</h1>
        <span className="text-muted-foreground text-sm">
          {/* Asked upside down on purpose — "2 points = 1 second" is how a master thinks about
              it, and `pointsPerSecond` is the one place that inversion happens (PRD 2 §9). */}
          {t('rate', { points: Math.round(pointsPerSecond(picking.secondsPerPoint)) })}
        </span>
      </div>

      <ul className="space-y-2">
        {candidates.map((candidate) => (
          <li key={candidate.teamId}>
            <Label className="flex items-center gap-3 font-normal">
              <Checkbox
                checked={chosen.includes(candidate.teamId)}
                onCheckedChange={() => toggle(candidate.teamId)}
              />
              <TeamDot colour={candidate.colour} />
              <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {candidate.score}
              </span>
              <span className="w-16 text-right tabular-nums">
                {t('seconds', { seconds: candidate.seconds })}
              </span>
              {candidate.seconds === 0 ? (
                <span className="text-destructive text-xs">{t('outAtOnce')}</span>
              ) : null}
            </Label>
          </li>
        ))}
      </ul>

      <div className="text-muted-foreground space-y-1 text-sm">
        <p>{t('penaltyLine', { penalty, max: worstCase, pool })}</p>
        {/* D58's suggestion, from the one implementation the round editor also uses. */}
        <p>{t('suggested', { count: suggested })}</p>
      </div>

      <div className="flex items-center gap-4">
        <Button
          size="lg"
          disabled={chosen.length < 2}
          onClick={() => run(() => api.setFinalists(chosen))}
        >
          {t('start')}
        </Button>
        {chosen.length < 2 ? (
          <span className="text-muted-foreground text-sm">{t('needTwo')}</span>
        ) : null}
      </div>
    </section>
  )
}

/**
 * PRD 3 §10.2 — the turn desk. **The most time-pressured screen in the product.**
 *
 * Everything here is arranged for speed rather than completeness:
 *
 * - The current team's name and clock dominate. The master says the name aloud and watches that
 *   number; both must be readable without focusing.
 * - **Clocks are whole seconds, never `m:ss`** (D57). `84 → 64` after a penalty is instant;
 *   `1:24 → 1:04` is a base-60 conversion the master does not have spare attention for.
 * - **Unmarked keywords are the buttons.** One click each, no dialog, no confirmation. A marked
 *   keyword becomes static text with the credited team, so the list doubles as the record.
 * - **Marking never pauses the clock.** The room's time keeps running while the master clicks,
 *   exactly as the show works. Only a handover stops it.
 * - **Every clock is on screen at all times**, because a team about to be eliminated by someone
 *   else's correct guess is the thing the master most needs to see coming.
 */
export function FinaleDesk({ view, api, run, turn }: ZoneProps & { turn: Turn }) {
  const t = useTranslations('control.finale')

  // D52 — the client counts down from `turnStartedAt`; the server never ticks.
  const elapsed = useElapsed(turn.turnStartedAt)

  const nameOf = (teamId: string | null): string =>
    view.teams.find((team) => team.id === teamId)?.name ?? ''

  const remainingFor = (clock: Turn['clocks'][number]): number =>
    clock.onTurn ? clock.secondsAtTurnStart - elapsed : clock.secondsAtTurnStart

  useEliminationWatch(turn, remainingFor, (teamId) => run(() => api.eliminate(teamId)))

  const mark = (index: number, unmark: boolean): boolean => {
    const keyword = turn.keywords[index]
    if (!keyword) return false
    if (unmark) {
      if (keyword.markedByTeamId === null) return false
      run(() => api.unmarkKeyword(keyword.id))
    } else {
      if (keyword.markedByTeamId !== null) return false
      run(() => api.markKeyword(keyword.id))
    }
    return true
  }

  const pass = (): void => run(() => api.passTurn())

  // §10.3 — this round earns its own bindings, because clicking five buttons under time pressure is
  // where a master falls behind the room.
  useControlKeys((event) => {
    if (event.code === 'Space') {
      pass()
      return true
    }
    const index = digitIndex(event)
    if (index === null || index >= KEYWORDS_PER_QUESTION) return false
    return mark(index, event.shiftKey)
  })

  const current = turn.clocks.find((clock) => clock.onTurn)

  return (
    <section className="mx-auto flex h-full max-w-3xl flex-col gap-5">
      <header className="space-y-1">
        <p className="text-muted-foreground text-sm">
          {t('questionOf', { number: turn.questionNumber, total: turn.questionTotal })}
        </p>
        <h1 className="text-xl font-medium">{turn.prompt}</h1>
        {turn.masterNotes ? (
          <p className="bg-muted flex items-start gap-2 rounded-md p-2 text-sm">
            <NotebookPen aria-hidden className="mt-0.5 size-4 shrink-0" />
            {turn.masterNotes}
          </p>
        ) : null}
      </header>

      <div className="flex items-center gap-4">
        <TeamDot colour={colourOf(view, turn.currentTeamId)} className="size-6" />
        <h2 className="text-4xl font-semibold">{nameOf(turn.currentTeamId)}</h2>
        <span
          className={cn(
            'text-5xl tabular-nums',
            current && remainingFor(current) <= FINALE_CLOCK_WARN_S && 'text-destructive',
          )}
        >
          {/* Whole seconds and no unit: a ticking `84` reads as a clock, `84s` as a setting
              (conventions §8.2). */}
          {Math.max(0, Math.ceil(current ? remainingFor(current) : 0))}
        </span>
        <span className="text-muted-foreground ml-auto text-sm">
          {turn.nextTeamId
            ? t('next', { team: nameOf(turn.nextTeamId) })
            : t('nextNobody')}
        </span>
      </div>

      <ol className="space-y-1">
        {turn.keywords.map((keyword, index) => (
          <li key={keyword.id} className="flex items-center gap-3">
            <span className="text-muted-foreground w-4 tabular-nums">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-lg">{keyword.text}</span>

            {keyword.markedByTeamId ? (
              <>
                <span className="text-muted-foreground text-sm">
                  {t('markedBy', { team: nameOf(keyword.markedByTeamId) })}
                </span>
                {/* §10.4 — a mis-marked keyword is not merely a wrong tick: it charged every other
                    team the penalty. Un-marking reverses the mark *and* the seconds. */}
                <Button size="xs" variant="ghost" onClick={() => mark(index, true)}>
                  {t('unmark')}
                </Button>
              </>
            ) : keyword.revealed ? (
              <span className="text-muted-foreground text-sm">
                {t('revealedUnguessed')}
              </span>
            ) : (
              <Button size="sm" variant="outline" onClick={() => mark(index, false)}>
                {t('mark')}
              </Button>
            )}
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-4">
        {/* §10.5 — master-triggered, so they keep the beat to say "nobody? it was Billie Jean." */}
        {turn.allRemainingPassed ? (
          <>
            <span className="text-muted-foreground text-sm">{t('allPassed')}</span>
            <Button
              size="lg"
              onClick={() => run(() => api.revealKeywords(turn.gameQuestionId))}
            >
              {t('revealRemaining')}
            </Button>
          </>
        ) : (
          // Names the team, so the handover is one deliberate click rather than a generic "next"
          // the master has to interpret.
          <Button size="lg" onClick={pass}>
            {turn.nextTeamId
              ? t('pass', { team: nameOf(turn.nextTeamId) })
              : t('allPassed')}
          </Button>
        )}
      </div>

      <ClockStrip clocks={turn.clocks} remainingFor={remainingFor} view={view} />
    </section>
  )
}

/** §10.2's bottom strip — every clock, all the time. */
function ClockStrip({
  clocks,
  remainingFor,
  view,
}: {
  clocks: Turn['clocks']
  remainingFor: (clock: Turn['clocks'][number]) => number
  view: MasterControlView
}) {
  const t = useTranslations('control.finale')

  return (
    <footer className="mt-auto flex flex-wrap gap-x-6 gap-y-1 border-t pt-3">
      {clocks.map((clock) => (
        <span
          key={clock.teamId}
          className={cn(
            'flex items-center gap-2',
            clock.eliminated && 'text-muted-foreground line-through',
            clock.onTurn && 'font-medium',
          )}
        >
          <TeamDot colour={clock.colour || colourOf(view, clock.teamId)} />
          {clock.name}
          <span className="tabular-nums">
            {clock.eliminated
              ? t('eliminated')
              : Math.max(0, Math.ceil(remainingFor(clock)))}
          </span>
        </span>
      ))}
    </footer>
  )
}

/**
 * §10.6 — a clock reaching zero eliminates immediately, and **control is what notices**.
 *
 * The browser only reports *that* a clock ran out; the server recomputes the exact instant from the
 * log, so a slow tab cannot skew the ranking (protocol §4.6). Elimination can also happen
 * **off-turn** — a penalty can take a waiting team to zero — which is why this watches every clock
 * and not only the one that is running.
 *
 * Posted at most once per team per turn: the command is idempotent (a team still above zero is a
 * `{ ok: true, events: [] }` no-op), but a desk re-posting four times a second would still be
 * writing nonsense into the request log.
 */
function useEliminationWatch(
  turn: Turn,
  remainingFor: (clock: Turn['clocks'][number]) => number,
  eliminate: (teamId: string) => void,
): void {
  const posted = useRef(new Set<string>())

  const expired = turn.clocks
    .filter((clock) => !clock.eliminated && remainingFor(clock) <= 0)
    .map((clock) => clock.teamId)

  const key = expired.join(',')

  useEffect(() => {
    for (const teamId of key === '' ? [] : key.split(',')) {
      if (posted.current.has(teamId)) continue
      posted.current.add(teamId)
      eliminate(teamId)
    }
    // `eliminate` closes over a fresh `run` each render; the id list is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/**
 * §10.6 and PRD 4's `FINISHED` stage — **two tabs** (D51).
 *
 * *Survival* is the finale's own result: rank groups, best first, and simultaneous eliminations
 * share a rank. *Points* is the standing the room spent the whole evening building, which the finale
 * deliberately does not overwrite — a finale scores in seconds, so `teams` is already the pre-finale
 * table.
 */
export function FinaleRanking({
  view,
  api,
  run,
  finished,
}: ZoneProps & { finished?: boolean }) {
  const t = useTranslations('control.finale')
  const tf = useTranslations('control.frame')

  const ranking = view.finaleRanking
  const byPoints = [...view.teams].sort((a, b) => b.score - a.score)

  const nameOf = (teamId: string): string =>
    view.teams.find((team) => team.id === teamId)?.name ?? ''
  const colourFor = (teamId: string): string =>
    view.teams.find((team) => team.id === teamId)?.colour ?? ''

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-medium">
        {finished
          ? view.status === 'ABANDONED'
            ? tf('abandoned')
            : tf('finished')
          : t('rankingTitle')}
      </h1>

      {ranking ? (
        <Tabs defaultValue="survival">
          <TabsList>
            <TabsTrigger value="survival">{t('survivalTab')}</TabsTrigger>
            <TabsTrigger value="points">{t('pointsTab')}</TabsTrigger>
          </TabsList>

          <TabsContent value="survival">
            <ol className="space-y-2">
              {ranking.map((group, index) => (
                <li key={group.join('-')} className="flex items-start gap-3">
                  <span className="text-muted-foreground w-20 shrink-0 text-sm">
                    {group.length > 1
                      ? t('shared', { place: index + 1 })
                      : t('place', { place: index + 1 })}
                  </span>
                  <span className="flex flex-wrap gap-x-4">
                    {group.map((teamId) => (
                      <span key={teamId} className="flex items-center gap-2">
                        <TeamDot colour={colourFor(teamId)} />
                        {nameOf(teamId)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          </TabsContent>

          <TabsContent value="points">
            <PointsTable teams={byPoints} />
          </TabsContent>
        </Tabs>
      ) : (
        <PointsTable teams={byPoints} />
      )}

      {finished ? null : <AdvanceButton view={view} api={api} run={run} />}
    </section>
  )
}

function PointsTable({ teams }: { teams: MasterControlView['teams'] }) {
  return (
    <ol className="space-y-2">
      {teams.map((team, index) => (
        <li key={team.id} className="flex items-center gap-3">
          <span className="text-muted-foreground w-6 tabular-nums">{index + 1}</span>
          <TeamDot colour={team.colour} />
          <span className="min-w-0 flex-1 truncate">{team.name}</span>
          <span className="tabular-nums">{team.score}</span>
        </li>
      ))}
    </ol>
  )
}

const colourOf = (view: MasterControlView, teamId: string | null): string =>
  view.teams.find((team) => team.id === teamId)?.colour ?? ''
