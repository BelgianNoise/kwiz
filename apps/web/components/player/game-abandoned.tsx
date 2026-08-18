import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'

/**
 * PRD 5 §15 O3 — *"`ABANDONED` gets a bare message."*
 *
 * **A different message from the unknown-code one, not the same page by another route.** Both are
 * *"not an error page"*, which is where the resemblance ends: this code was right, so telling
 * someone it *"may be slightly off"* sends them back to re-read a projector that is no longer
 * showing anything.
 *
 * And no standings, unlike a finished game: the master pulled the quiz, so there is no result to
 * announce — the same reason the live surface refuses to announce one (PRD 4 §14). The copy is
 * shared with the live abandon path, because a phone that was in the room and a phone opening the
 * link afterwards are told the same true thing.
 */
export async function GameAbandoned() {
  const t = await getTranslations('player')

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 p-6">
      <p className="text-2xl font-medium">{t('game.abandoned')}</p>
      <Link href="/" className="text-lg underline underline-offset-4">
        {t('finished.backHome')}
      </Link>
    </main>
  )
}
