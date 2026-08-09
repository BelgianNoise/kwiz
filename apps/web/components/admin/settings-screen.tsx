'use client'

import type { MigrationOutcome } from '@kwiz/db'
import { AlertTriangle, ChevronLeft, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Link, useRouter } from '@/i18n/navigation'
import { api } from '@/lib/client/api'
import type { StorageStats } from '@/lib/server/attachments'

/**
 * PRD 2 §16. Five sections, no cleverness — the value is that every one of them answers a question a
 * master would otherwise have to leave the app to answer.
 */
export function SettingsScreen({
  network,
  muted,
  storage,
  about,
}: {
  network: { address: string | null; port: number; stale: boolean }
  muted: boolean
  storage: StorageStats
  /** The outcome's `kind`, not a string: it indexes a message key, so a typo must not compile. */
  about: {
    appVersion: string
    schemaVersion: number
    migration: MigrationOutcome['kind']
  }
}) {
  const t = useTranslations('admin.settings')
  const dashboard = useTranslations('admin.dashboard')
  const router = useRouter()

  const [isMuted, setMuted] = useState(muted)
  const [reclaiming, setReclaiming] = useState(false)
  const [reclaimed, setReclaimed] = useState<{ removed: number; bytes: number } | null>(
    null,
  )

  const reclaim = async (): Promise<void> => {
    setReclaiming(true)
    const result = await api.reclaimSpace()
    setReclaiming(false)
    if (result.ok && result.data) {
      setReclaimed(result.data)
      router.refresh()
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 p-6 sm:p-10">
      <header>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin">
            <ChevronLeft className="size-4" />
            {dashboard('title')}
          </Link>
        </Button>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </header>

      <Section title={t('network')}>
        {network.address ? (
          <p className="font-mono text-sm">
            http://{network.address}:{network.port}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">{t('noAddress')}</p>
        )}
        {/* §4's last bullet: a stale saved address must not fail silently. */}
        {network.stale ? (
          <p className="text-destructive flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4" />
            {t('addressStale')}
          </p>
        ) : null}
        <Button asChild variant="secondary" size="sm">
          <Link href="/admin/setup">{t('changeAddress')}</Link>
        </Button>
      </Section>

      {/* D13 — per device, not per game, which is why it is here and not in game setup. */}
      <Section title={t('language')} description={t('languageHint')}>
        <LanguageSwitcher />
      </Section>

      {/*
        §16 — this lives here rather than on the projected screen, which has no controls at all.
        A venue with its own sound system needs it, and hunting through OS volume mid-quiz is not an
        acceptable answer (PRD 4 §13).
      */}
      <Section title={t('sound')}>
        <div className="flex items-center gap-3">
          <Switch
            id="mute-sounds"
            checked={isMuted}
            onCheckedChange={(next) => {
              setMuted(next)
              void api.setMute(next)
            }}
          />
          <Label htmlFor="mute-sounds">{t('muteAll')}</Label>
        </div>
      </Section>

      <Section title={t('storage')}>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">{t('dataDir')}</dt>
          <dd className="font-mono break-all">{storage.dataDir}</dd>
          <dt className="text-muted-foreground">{t('databaseSize')}</dt>
          <dd>{formatBytes(storage.databaseBytes)}</dd>
          <dt className="text-muted-foreground">{t('attachments')}</dt>
          <dd>
            {t('attachmentSummary', {
              count: storage.attachmentCount,
              size: formatBytes(storage.attachmentBytes),
            })}
          </dd>
        </dl>

        {/*
          §16 — user-facing because content-addressed files accumulate invisibly: a replaced image
          leaves the old one behind until reconciliation runs (data model §8), on the master's laptop.
        */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={reclaiming || storage.orphanCount === 0}
            onClick={() => {
              void reclaim()
            }}
          >
            <Trash2 className="size-4" />
            {t('reclaim')}
          </Button>
          <span className="text-muted-foreground text-sm">
            {reclaimed
              ? t('reclaimed', {
                  count: reclaimed.removed,
                  size: formatBytes(reclaimed.bytes),
                })
              : storage.orphanCount === 0
                ? t('nothingToReclaim')
                : t('reclaimable', {
                    count: storage.orphanCount,
                    size: formatBytes(storage.orphanBytes),
                  })}
          </span>
        </div>
      </Section>

      <Section title={t('about')}>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          {/* P2 #23 — schema version and migration status were shown here with no app version at
              all, even though `package.json` already carries one. */}
          <dt className="text-muted-foreground">{t('appVersion')}</dt>
          <dd>{about.appVersion}</dd>
          <dt className="text-muted-foreground">{t('schemaVersion')}</dt>
          <dd>{about.schemaVersion}</dd>
          <dt className="text-muted-foreground">{t('migrationStatus')}</dt>
          <dd>{t(`migration.${about.migration}`)}</dd>
        </dl>
      </Section>
    </main>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-border space-y-3 rounded-xl border p-4">
      <div>
        <h2 className="font-medium">{title}</h2>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

/**
 * Not through the messages module: this is a number with an SI unit, identical in both locales, and
 * routing it through i18n would invite someone to "translate" `MB`.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'TB'}`
}
