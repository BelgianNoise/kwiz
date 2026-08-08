'use client'

import {
  assignedColour,
  dsmtwFinaleRoundConfigSchema,
  finaleRound,
  LOCALES,
  pointsPerSecond,
  quizPoints,
  secondsForScore,
  suggestFinaleQuestions,
  type Locale,
  type QuizContent,
} from '@kwiz/domain'
import { AlertTriangle, Check, ChevronLeft, GripVertical, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ColourPicker } from '@/components/admin/colour-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Link, useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'
import { useReorder } from '@/lib/client/use-reorder'

interface DraftTeam {
  key: string
  name: string
  colour: string
}

/**
 * PRD 2 §11 — game setup. The screen that runs **fifteen minutes before doors open, in a noisy room,
 * on battery** (§1.1), which is why nothing here demands more than it needs.
 *
 * - **Names default to `Team 1…n`**, so a master can create the game *now* and rename later — and
 *   renaming works at any time, including after the game finishes (§13.4).
 * - **Colours come from the curated palette** (PRD 1 §9.3) with taken ones *marked* rather than
 *   disabled: a master may genuinely want a near-match, and the palette's job is to make the first
 *   few teams mutually unmistakable, not to police the rest.
 * - **The code is generated, not picked** (§11). It is unique among joinable games, and a master
 *   choosing one is a collision waiting to happen.
 */
export function GameSetup({
  quiz,
  lastTeams,
}: {
  quiz: QuizContent
  lastTeams: { name: string; colour: string }[]
}) {
  const t = useTranslations('admin.setup')
  const finaleCopy = useTranslations('admin.finale')
  const language = useTranslations('common.language')
  const common = useTranslations('common')
  const router = useRouter()

  /** The same label the authoring editor uses, because it is the same number (§9, §11.1). */
  const finalePenaltyLabel = finaleCopy('penalty')

  const [teams, setTeams] = useState<DraftTeam[]>(() =>
    [0, 1, 2, 3].map((index) => ({
      key: `team-${index}`,
      name: '',
      colour: assignedColour(index),
    })),
  )
  const [locale, setLocale] = useState<Locale>('en')
  const [busy, setBusy] = useState(false)

  const finale = finaleRound(quiz)
  const authored = finale
    ? dsmtwFinaleRoundConfigSchema.safeParse(finale.config)
    : undefined
  const [penalty, setPenalty] = useState(
    authored?.success ? authored.data.penaltySeconds : 20,
  )

  const secondsPerPoint = authored?.success ? authored.data.secondsPerPoint : 0.5
  const total = quizPoints(quiz)
  const topSeconds = secondsForScore(total, secondsPerPoint)

  /**
   * §11.1 — recomputed against the **real** team count, which is the only reason this control lives
   * here rather than only in authoring (D54). It moves as teams are added or removed.
   */
  const suggested = suggestFinaleQuestions(
    Array.from({ length: teams.length }, () => topSeconds),
    penalty,
  )
  const finaleQuestions = finale?.questions.length ?? 0
  const reach = penalty * 5 * Math.max(0, teams.length - 1)

  /** Local only — the teams do not exist until `[Create game]`, so this is an array move. */
  const reorder = useReorder({
    canDrag: () => teams.length > 1,
    canDrop: () => true,
    onMove: (key, direction, steps) => {
      const from = teams.findIndex((team) => team.key === key)
      const to = direction === 'DOWN' ? from + steps : from - steps
      if (from < 0 || to < 0 || to >= teams.length) return

      const next = [...teams]
      const [moved] = next.splice(from, 1)
      if (moved) next.splice(to, 0, moved)
      setTeams(next)
    },
  })

  const named = (team: DraftTeam, index: number): string =>
    team.name.trim() === ''
      ? t('defaultTeamName', { number: index + 1 })
      : team.name.trim()

  const create = async (): Promise<void> => {
    setBusy(true)
    const result = await api.createGame({
      quizId: quiz.id,
      teams: teams.map((team, index) => ({
        name: named(team, index),
        colour: team.colour,
      })),
      defaultPlayerLocale: locale,
      ...(finale ? { finale: { secondsPerPoint, penaltySeconds: penalty } } : {}),
    })
    setBusy(false)
    if (result.ok && result.data) router.push(`/admin/games/${result.data.gameId}`)
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6 sm:p-10">
      <header>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/quizzes/${quiz.id}`}>
            <ChevronLeft className="size-4" />
            {quiz.name}
          </Link>
        </Button>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {t('heading', { name: quiz.name })}
        </h1>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">{t('teams')}</h2>
          <div className="flex gap-2">
            {lastTeams.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setTeams(
                    lastTeams.map((team, index) => ({
                      key: `last-${index}`,
                      name: team.name,
                      colour: team.colour,
                    })),
                  )
                }
              >
                {t('copyFromLast')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setTeams([
                  ...teams,
                  {
                    key: `team-${Date.now()}`,
                    name: '',
                    colour: assignedColour(teams.length),
                  },
                ])
              }
            >
              {t('addTeam')}
            </Button>
          </div>
        </div>

        <ul className="space-y-2">
          {teams.map((team, index) => (
            <li
              key={team.key}
              {...reorder.rowProps(team.key, index)}
              className={[
                'flex items-center gap-2',
                reorder.draggingId === team.key ? 'opacity-40' : '',
                reorder.overId === team.key ? 'border-primary border-t-2' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {/*
                §11 — teams are ordered, and the order is what every surface reads (`position`).
                Reordering here is local: nothing exists server-side until `[Create game]`.
              */}
              <span
                className="text-muted-foreground cursor-grab active:cursor-grabbing"
                title={common('dragToReorder')}
                aria-hidden
              >
                <GripVertical className="size-4" />
              </span>
              <ColourPicker
                colour={team.colour}
                taken={teams
                  .filter((other) => other.key !== team.key)
                  .map((other) => other.colour)}
                onPick={(colour) =>
                  setTeams(
                    teams.map((other) =>
                      other.key === team.key ? { ...other, colour } : other,
                    ),
                  )
                }
              />
              <Input
                value={team.name}
                aria-label={t('teamName')}
                placeholder={t('defaultTeamName', { number: index + 1 })}
                onChange={(event) =>
                  setTeams(
                    teams.map((other) =>
                      other.key === team.key
                        ? { ...other, name: event.target.value }
                        : other,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('removeTeam')}
                disabled={teams.length <= 1}
                onClick={() => setTeams(teams.filter((other) => other.key !== team.key))}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {finale ? (
        <section className="border-border space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">{t('finaleHeading')}</h2>
            <span className="text-muted-foreground text-sm">
              {t('teamsPlaying', { count: teams.length })}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="w-28 space-y-2">
              <Label htmlFor="setup-penalty-field">{finalePenaltyLabel}</Label>
              <Input
                id="setup-penalty-field"
                type="number"
                min={0}
                value={penalty}
                onChange={(event) => setPenalty(Number(event.target.value))}
              />
            </div>
            <div className="flex-1 space-y-1">
              {/* The arithmetic updates as teams are added or removed — the whole point of §11.1. */}
              <p className="text-muted-foreground text-sm">
                {t('penaltyReach', { teams: teams.length, seconds: reach })}
              </p>
              {reach >= topSeconds && topSeconds > 0 ? (
                <p className="text-destructive flex items-center gap-2 text-sm">
                  <AlertTriangle className="size-4" />
                  {t('penaltyWarning')}
                </p>
              ) : null}
              <p className="text-muted-foreground text-sm">
                {t('rateFromQuiz', { rate: pointsPerSecond(secondsPerPoint) })}
              </p>
            </div>
          </div>

          {/* §11.1 — exact here, because it depends on the real team count and the real banks (D58). */}
          <p
            className={
              finaleQuestions < suggested
                ? 'text-destructive flex items-center gap-2 text-sm'
                : 'text-muted-foreground flex items-center gap-2 text-sm'
            }
          >
            {finaleQuestions < suggested ? (
              <AlertTriangle className="size-4" />
            ) : (
              <Check className="size-4" />
            )}
            {finaleQuestions < suggested
              ? t('questionsShort', {
                  have: finaleQuestions,
                  suggested,
                  teams: teams.length,
                })
              : t('questionsOk', { suggested, teams: teams.length })}
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-medium">{t('playerLanguage')}</h2>
        <RadioGroup
          value={locale}
          onValueChange={(next) => {
            const found = LOCALES.find((candidate) => candidate === next)
            if (found) setLocale(found)
          }}
          className="flex gap-6"
        >
          {LOCALES.map((candidate) => (
            <div key={candidate} className="flex items-center gap-2">
              <RadioGroupItem value={candidate} id={`locale-${candidate}`} />
              <Label htmlFor={`locale-${candidate}`}>{language(candidate)}</Label>
            </div>
          ))}
        </RadioGroup>
        {/* D29 — a default for joining devices, never a lock on a player's own choice. */}
        <p className="text-muted-foreground text-sm">{t('playerLanguageHint')}</p>
      </section>

      <footer className="flex justify-end">
        <Button
          disabled={busy || teams.length === 0}
          onClick={() => {
            void create()
          }}
        >
          {t('createGame')}
        </Button>
      </footer>
    </main>
  )
}
