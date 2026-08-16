import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'

/**
 * PRD 5 §2.1's most likely failure: a code typed by someone squinting at a projector across a dark
 * room, or a code from a game that has since finished.
 *
 * **Not an error page.** conventions §2's normalisation exists to make this rare — `O`→`0`, `I`→`1`,
 * `L`→`1`, whitespace and hyphens stripped — and when it happens anyway the useful answer is the code
 * they actually used, so they can compare it with the screen, plus a way back. A stack trace or a
 * 404 tells a pub guest nothing they can act on.
 *
 * A **finished** game's code stops resolving, which is indistinguishable from a wrong one here — and
 * that is the right answer for a player either way: this code will not get you into a game.
 */
export async function NoSuchGame({ code }: { code: string }) {
  const t = await getTranslations('player.join')

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold">{t('noGame')}</h1>
      <p className="text-muted-foreground text-lg">{t('noGameBody')}</p>
      <p className="font-mono text-2xl tracking-[0.2em]">{code}</p>
      <Link href="/" className="text-lg underline underline-offset-4">
        {t('tryAgain')}
      </Link>
    </main>
  )
}
