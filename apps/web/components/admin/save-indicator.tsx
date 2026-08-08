'use client'

import { useFormatter, useTranslations } from 'next-intl'

import type { SaveStatus } from '@/lib/client/use-autosave'

/**
 * PRD 2 §15.1's quiet `Saved · 19:04`.
 *
 * Quiet is the point: autosave means the master never presses save, so the indicator's job is to
 * reassure without asking for attention. The one state that does ask is a failure — silence there
 * would be a master typing into a void.
 */
export function SaveIndicator({
  status,
  savedAt,
}: {
  status: SaveStatus
  savedAt: Date | undefined
}) {
  const t = useTranslations('common')
  const format = useFormatter()

  if (status === 'idle') return null

  if (status === 'failed') {
    return <output className="text-destructive text-sm">{t('saveFailed')}</output>
  }

  // `<output>` rather than a span with `role="status"`: it is the element for a live result, and it
  // announces politely without being asked to.
  return (
    <output className="text-muted-foreground text-sm tabular-nums">
      {status === 'saving' || !savedAt
        ? t('saving')
        : `${t('saved')} · ${format.dateTime(savedAt, { hour: '2-digit', minute: '2-digit' })}`}
    </output>
  )
}
