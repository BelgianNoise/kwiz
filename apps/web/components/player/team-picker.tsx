'use client'

import type { ErrorCode } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { useRouter } from '@/i18n/navigation'
import { joinGame } from '@/lib/client/api'
import { readDeviceToken, storeDeviceToken } from '@/lib/client/device'

interface PickableTeam {
  id: string
  name: string
  colour: string
  devices: number
}

/**
 * PRD 5 §2.2 — *"Which team are you?"*
 *
 * **Teams are created by the master** (PRD 2 §11); players choose from a list and never name
 * themselves. That is what keeps team identity under the master's control for scoring, and it is why
 * this screen needs no text input at all — the one screen on the surface where that is true.
 */
export function TeamPicker({
  code,
  gameId,
  quizName,
  teams,
  maxDevices,
}: {
  code: string
  gameId: string
  quizName: string
  teams: PickableTeam[]
  maxDevices: number
}) {
  const t = useTranslations('player.join')
  const router = useRouter()
  const [joining, setJoining] = useState<string | null>(null)
  const [refused, setRefused] = useState<ErrorCode | null>(null)

  /*
   * §2.3 — *"reopening the URL resumes: same team, same state, nothing to re-enter."*
   *
   * Checked before anything is drawn, so a phone that already joined never sees the picker again. It
   * is what makes an accidental tab close, a browser crash or a phone restart a non-event.
   */
  useEffect(() => {
    if (readDeviceToken(gameId)) router.replace(`/play/${code}/game`)
  }, [gameId, code, router])

  const pick = (team: PickableTeam): void => {
    setJoining(team.id)
    setRefused(null)
    void joinGame(code, team.id).then((result) => {
      if (!result.ok || !result.data) {
        setJoining(null)
        setRefused(result.ok ? null : result.error)
        return
      }
      storeDeviceToken(gameId, result.data.deviceToken)
      router.replace(`/play/${code}/game`)
    })
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-5">
      <header className="pt-4">
        <p className="text-muted-foreground text-lg">{quizName}</p>
        <h1 className="text-3xl font-semibold">{t('whichTeam')}</h1>
      </header>

      <ul className="flex flex-col gap-3">
        {teams.map((team) => {
          const full = team.devices >= maxDevices
          return (
            <li key={team.id}>
              {/*
                §2.2 — **large tap targets**, because this is being tapped by someone holding a drink
                in a dim pub. A whole row, not a radio dot with a label beside it.

                **One tap joins. No confirmation** — switching is available afterwards (§2.4), so a
                mis-tap costs a menu item rather than a dialog on every correct tap.
              */}
              <button
                type="button"
                onClick={() => pick(team)}
                disabled={full || joining !== null}
                className="border-border bg-card flex min-h-20 w-full items-center gap-4 rounded-xl border px-5 py-4 text-left disabled:opacity-60"
              >
                <span
                  aria-hidden
                  className="size-6 shrink-0 rounded-full"
                  style={{ backgroundColor: team.colour }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xl font-medium">{team.name}</span>
                  {/*
                    D20 — a full team is shown **with the reason**. Hiding it makes a player think
                    they scanned the wrong code; this tells them to sit elsewhere or ask the master.
                  */}
                  {full ? (
                    <span className="text-muted-foreground block text-base">
                      {t('alreadyHas', { count: team.devices })}
                    </span>
                  ) : null}
                </span>
                {joining === team.id ? (
                  <span className="text-muted-foreground text-base">{t('joining')}</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      {/*
        A refusal is almost always `TEAM_FULL` — someone else took the last slot between this page
        rendering and the tap. Named plainly, because "something went wrong" would send a guest to
        find the master for something they can fix by tapping a different row.
      */}
      {refused ? <Refusal code={refused} /> : null}

      {teams.length === 0 ? (
        <p className="text-muted-foreground text-lg">{t('noTeams')}</p>
      ) : null}
    </main>
  )
}

function Refusal({ code }: { code: ErrorCode }) {
  const tError = useTranslations('errors')
  // conventions §6.1 — `errors.<CODE>` is the one place a typed refusal becomes copy (D11).
  return (
    <p className="text-destructive text-lg" role="alert">
      {tError(code)}
    </p>
  )
}
