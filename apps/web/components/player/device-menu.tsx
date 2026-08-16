'use client'

import type { PlayerView } from '@kwiz/domain'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { useRouter } from '@/i18n/navigation'
import { player } from '@/lib/client/api'
import { clearDeviceToken } from '@/lib/client/device'

/**
 * PRD 5 §14 — **one small control, top corner, away from the buzzer.**
 *
 * Everything in it is a correction or a preference; nothing here is part of playing. The placement is
 * the design: this surface's primary control is a near-fullscreen button being stabbed at by whoever
 * reacts first (§8), and a destructive action anywhere near it will be hit by accident.
 */
export function DeviceMenu({
  view,
  gameId,
  code,
  token,
}: {
  view: PlayerView
  gameId: string
  code: string
  token: string
}) {
  const t = useTranslations('player.menu')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  /*
   * §14 — *"the menu is **not available** during buzzer questions while buzzers are live."*
   *
   * The whole screen is the buzzer at that moment, and a menu affordance would be a target competing
   * with it. Not merely hidden behind the button: the trigger itself goes.
   */
  const stage = view.stage
  const buzzing =
    stage.kind === 'QUESTION' &&
    stage.question.answerMethod === 'BUZZER' &&
    (stage.question.buzzersLive ?? false)

  if (buzzing) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('label')}
        // Top-left, because the thumb that reaches the buzzer comes from the bottom.
        className="text-muted-foreground fixed top-2 left-2 flex size-11 items-center justify-center rounded-full text-2xl"
      >
        ⋮
      </button>

      {open ? (
        <div className="bg-background/95 fixed inset-0 z-10 flex flex-col gap-2 p-5">
          <div className="flex items-center justify-between pb-2">
            <span className="text-lg font-medium">{view.team.name}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 px-3 text-lg underline underline-offset-4"
            >
              {t('close')}
            </button>
          </div>

          {/* §14 — per-device locale (D13), names shown in their own language, never a flag. */}
          <div className="border-border flex min-h-14 items-center justify-between rounded-xl border px-4">
            <span className="text-lg">{t('language')}</span>
            <LanguageSwitcher />
          </div>

          {/*
            §2.4 — a player who tapped the wrong row. Their draft for the current question is
            discarded (protocol P4): a draft belongs to `(question, team)`, and carrying one team's
            in-progress answer to another is worse than losing it. Already-submitted answers stay with
            the team they were submitted for — a device moving does not move history.
          */}
          <details className="border-border rounded-xl border">
            <summary className="flex min-h-14 items-center px-4 text-lg">
              {t('switchTeam')}
            </summary>
            <ul className="flex flex-col gap-2 p-3">
              {view.otherTeams.map((team) => (
                <li key={team.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void player(gameId, token)
                        .switchTeam(team.id)
                        .then(() => setOpen(false))
                    }}
                    className="border-border min-h-14 w-full rounded-lg border px-4 text-left text-lg"
                  >
                    {team.name}
                  </button>
                </li>
              ))}
            </ul>
          </details>

          <hr className="border-border my-2" />

          {/*
            §14 / O2 — *"leave this quiz"* earns its place even though it is destructive, because
            *"clear your browser storage"* is not an instruction you can give a pub guest. Without it a
            phone handed to a different table between games is unrecoverable and the master cannot
            help.
            **Confirmed**, because it genuinely severs this device's link.
          */}
          {leaving ? (
            <div className="border-destructive flex flex-col gap-3 rounded-xl border p-4">
              <p className="text-lg">{t('leaveConfirm')}</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    clearDeviceToken(gameId)
                    router.replace(`/play/${code}`)
                  }}
                  className="bg-destructive text-destructive-foreground min-h-14 flex-1 rounded-lg text-lg font-medium"
                >
                  {t('leave')}
                </button>
                <button
                  type="button"
                  onClick={() => setLeaving(false)}
                  className="border-border min-h-14 flex-1 rounded-lg border text-lg"
                >
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setLeaving(true)}
              className="text-destructive min-h-14 rounded-xl px-4 text-left text-lg"
            >
              {t('leave')}
            </button>
          )}
        </div>
      ) : null}
    </>
  )
}
