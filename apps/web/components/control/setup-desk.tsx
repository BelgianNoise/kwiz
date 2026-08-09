'use client'

import { useTranslations } from 'next-intl'

import { usePrimaryAction, type ZoneProps } from '@/components/control/control-desk'
import { TeamDot } from '@/components/control/team-dot'
import { Button } from '@/components/ui/button'

/**
 * PRD 3 §4 — pre-game.
 *
 * **Which teams haven't joined is the whole content of this screen**, because that is what the
 * master is actually doing while people arrive: chasing the table that hasn't scanned the QR yet.
 *
 * `[Start the quiz]` is enabled even with teams unjoined — PRD 1 flow step 10 explicitly does not
 * block joins after start, and a team still ordering drinks should not hold up the room. No
 * confirmation (§1.1): starting is not irreversible in any way that matters.
 *
 * The QR code and join URL are deliberately **not** here. They live on PRD 2 §12's game page, which
 * is where the master has been while people arrive; this screen is for starting, not for joining.
 */
export function SetupDesk({ view, api, run }: ZoneProps) {
  const t = useTranslations('control.setup')
  const start = (): void => run(() => api.start())
  usePrimaryAction(start)

  const joined = view.teams.filter((team) => team.deviceCount > 0).length

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-medium">{t('title')}</h1>

      <ul className="space-y-2">
        {view.teams.map((team) => (
          <li key={team.id} className="flex items-center gap-3">
            <TeamDot colour={team.colour} />
            <span className="min-w-0 flex-1 truncate">{team.name}</span>
            <span className="text-muted-foreground">
              {team.deviceCount > 0
                ? t('devices', { count: team.deviceCount })
                : t('notJoined')}
            </span>
            {team.deviceCount > 0 ? <span>{t('ready')}</span> : null}
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground">
        {t('joined', { joined, total: view.teams.length })}
      </p>

      <Button size="lg" onClick={start}>
        {t('start')}
      </Button>
    </section>
  )
}
