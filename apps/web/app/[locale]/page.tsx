import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'

/**
 * Slice 0 proves the app boots and that both locales render — nothing more. build-order is
 * explicit that no UI beyond that belongs here, and the real landing page (host or join,
 * with the prominent switcher PRD 1 §9.4 specifies) is PRD 2's, built in slice 4.
 *
 * The locale links are not a placeholder for that switcher; they exist so `/en` and `/nl`
 * are both reachable in a browser, which is this slice's smoke-checklist row.
 */
export default function ScaffoldPage() {
  const t = useTranslations('landing.scaffold')
  const language = useTranslations('common.language')

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8">
      <div className="space-y-2 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
        <p className="text-muted-foreground text-sm">{t('detail')}</p>
      </div>

      <nav aria-label={language('label')} className="flex gap-4 text-sm">
        {routing.locales.map((locale) => (
          <Link
            key={locale}
            href="/"
            locale={locale}
            className="underline underline-offset-4 hover:no-underline"
          >
            {language(locale)}
          </Link>
        ))}
      </nav>
    </main>
  )
}
