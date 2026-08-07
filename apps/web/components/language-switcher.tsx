'use client'

import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'

import { Link } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { cn } from '@/lib/utils'

/**
 * PRD 1 §9.4 — **both locales are always reachable**, and the names are never translated: someone
 * who cannot read the current language has to be able to find their own.
 *
 * Never a flag icon alone. Flags mean countries, not languages.
 */

/**
 * The current path without its locale segment, which is what next-intl's `Link` wants.
 *
 * Done here rather than with next-intl's own `usePathname`, and that is not a style choice: that
 * hook is **not hook-count stable** across a client navigation that changes the locale context, and
 * React kills the render with *"Rendered more hooks than during the previous render"*. The symptom
 * is nothing to do with language — the page stops updating, so a dialog that asked to close stays
 * open, which is exactly how this was found.
 *
 * Next's own `usePathname` includes the locale, so the segment comes off here. One hook, no
 * conditions, and the regex is built from the routing config so adding a locale cannot miss it.
 */
const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join('|')})(?=/|$)`)

export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations('common.language')
  const pathname = usePathname()
  const withoutLocale = pathname.replace(LOCALE_PREFIX, '') || '/'

  return (
    <nav
      aria-label={t('label')}
      className={cn('flex items-center gap-3 text-sm', className)}
    >
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={withoutLocale}
          locale={locale}
          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
        >
          {t(locale)}
        </Link>
      ))}
    </nav>
  )
}
