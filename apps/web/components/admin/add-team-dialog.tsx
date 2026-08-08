'use client'

import {
  assignedColour,
  isColourTaken,
  TEAM_PALETTE,
  type MissedSoFar,
} from '@kwiz/domain'
import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'

/**
 * PRD 2 §11.2 / O5 — **a table arriving mid-game.**
 *
 * `[+ Add team]` stays available at every status because PRD 1 does not block late joins, and a pub
 * quiz has people walking in during round 1. This dialog is the gate, and it is justified only
 * because it is where the *decision* gets made rather than where a warning gets acknowledged:
 *
 * - **The numbers are computed** (`missedSoFar`, server-side). Working out "what have they missed?"
 *   mid-round in a noisy room is exactly the task that gets skipped, or got wrong.
 * - **The generosity option is inline**, so a master does not have to add the team and then remember
 *   to visit score adjustments. A choice offered where it arises is the one that gets made.
 * - **Half the missed points is suggested, not imposed** — a defensible default to override or zero.
 *   It writes an ordinary `SCORE_ADJUSTED` with a generated reason (D15), so it lands in the audit
 *   trail and can be revoked (D41) like anything else.
 *
 * Before the game starts there is nothing missed, so the whole warning section is absent and this is
 * just "name and colour" — the same dialog, without the part that would be noise.
 */
export function AddTeamDialog({
  gameId,
  teamCount,
  takenColours,
  missed,
  round,
  open,
  onClose,
}: {
  gameId: string
  teamCount: number
  takenColours: string[]
  /** Absent before `GAME_STARTED` — there is nothing to have missed. */
  missed: MissedSoFar | null
  /** Resolved server-side. `null` when no round is open. */
  round: { number: number; total: number } | null
  open: boolean
  onClose: () => void
}) {
  const t = useTranslations('admin.addTeam')
  const setup = useTranslations('admin.setup')
  const router = useRouter()

  const [name, setName] = useState('')
  const [colour, setColour] = useState(() => assignedColour(teamCount))
  const [generous, setGenerous] = useState(false)
  const [points, setPoints] = useState(missed?.suggestedStartingScore ?? 0)
  const [busy, setBusy] = useState(false)

  const add = async (): Promise<void> => {
    setBusy(true)
    const result = await api.addTeam(gameId, {
      name:
        name.trim() === ''
          ? setup('defaultTeamName', { number: teamCount + 1 })
          : name.trim(),
      colour,
      ...(generous && points !== 0
        ? {
            startingScore: points,
            reason: t('adjustmentReason', { round: round?.number ?? 0 }),
          }
        : {}),
    })
    setBusy(false)
    if (result.ok) {
      onClose()
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{missed ? t('titleMidGame') : t('title')}</DialogTitle>
          {missed && round ? (
            <DialogDescription>
              {t('inProgress', { round: round.number, total: round.total })}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {/* The arithmetic §11.2 exists for. Absent entirely before the game starts. */}
        {missed && missed.questions > 0 ? (
          <div className="text-muted-foreground space-y-1 text-sm">
            <p className="text-destructive flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t('missed', { questions: missed.questions, points: missed.points })}
            </p>
            <p>
              {t('ceiling', {
                theirs: missed.maximumPossible,
                others: missed.maximumPossibleForOthers,
              })}
            </p>
          </div>
        ) : null}

        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label htmlFor="add-team-name">{setup('teamName')}</Label>
            <Input
              id="add-team-name"
              value={name}
              placeholder={setup('defaultTeamName', { number: teamCount + 1 })}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={setup('colour')}
                className="border-border mb-1 size-9 shrink-0 rounded-full border"
                style={{ backgroundColor: colour }}
              />
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <ul className="grid grid-cols-4 gap-2">
                {TEAM_PALETTE.map((entry) => (
                  <li key={entry.hex}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-center gap-1"
                      onClick={() => setColour(entry.hex)}
                    >
                      <span
                        className="border-border size-8 rounded-full border"
                        style={{ backgroundColor: entry.hex }}
                      />
                      <span className="text-muted-foreground text-[10px] leading-none">
                        {isColourTaken(entry.hex, takenColours)
                          ? setup('colourTaken')
                          : entry.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </div>

        {/* Offered only when there is something to compensate for. */}
        {missed && missed.points > 0 ? (
          <section className="space-y-3">
            <h3 className="text-sm font-medium">{t('startingScore')}</h3>
            <RadioGroup
              value={generous ? 'GIVE' : 'ZERO'}
              onValueChange={(next) => setGenerous(next === 'GIVE')}
              className="gap-3"
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value="ZERO" id="add-team-zero" />
                <Label htmlFor="add-team-zero">{t('startOnZero')}</Label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <RadioGroupItem value="GIVE" id="add-team-give" />
                <Label htmlFor="add-team-give">{t('givePoints')}</Label>
                <Input
                  type="number"
                  aria-label={t('givePoints')}
                  className="w-24"
                  value={points}
                  onChange={(event) => {
                    setPoints(Number(event.target.value))
                    // Typing in the field is choosing the option — making them click the radio too is
                    // a way to enter a number that then gets ignored.
                    setGenerous(true)
                  }}
                />
                <span className="text-muted-foreground text-sm">
                  {t('halfOfMissed', { suggested: missed.suggestedStartingScore })}
                </span>
              </div>
            </RadioGroup>
            {generous && points !== 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('recordedAs', {
                  reason: t('adjustmentReason', { round: round?.number ?? 0 }),
                })}
              </p>
            ) : null}
          </section>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void add()
            }}
          >
            {t('addTeam')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
