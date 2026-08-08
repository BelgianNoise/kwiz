import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'

import { recordProbe } from '@/lib/server/probe'

/**
 * The page a phone lands on from PRD 2 §4's `[Test with my phone]` QR code.
 *
 * **A page rather than a bare endpoint**, for two reasons. The phone's half of this test matters: a
 * guest scanning a QR code and getting raw JSON has learned nothing, while "you reached the quiz
 * laptop" tells them the network is fine. And it keeps every user-facing string in the messages module
 * (CLAUDE.md §7) instead of inlining HTML in a route handler.
 *
 * Recording a hit on a GET is a side effect on a read, which is normally worth avoiding. Here it *is*
 * the feature — the request arriving is the entire signal — and it is idempotent: the same phone
 * loading it twice leaves the same single latest hit.
 */
export const dynamic = 'force-dynamic'

export default async function ProbePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>
}) {
  const t = await getTranslations('setup.probe')
  const { address } = await searchParams
  const requestHeaders = await headers()

  if (address) {
    recordProbe(address, requestHeaders.get('user-agent') ?? 'unknown', Date.now())
  }

  return (
    // Player-surface sizing (CLAUDE.md §7): this is read at arm's length on a phone, not on the desk.
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-2xl font-semibold">{t('reached')}</p>
      <p className="text-muted-foreground">{t('reachedBody')}</p>
      {address ? (
        <p className="text-muted-foreground font-mono text-sm">{address}</p>
      ) : null}
    </main>
  )
}
