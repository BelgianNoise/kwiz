import type { Metadata } from 'next'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { routing } from '@/i18n/routing'

import '../globals.css'

/*
 * The root layout lives inside `[locale]` because every route in the app is
 * locale-scoped — all four surfaces sit under it (CLAUDE.md §3).
 */

export const metadata: Metadata = {
  // A brand name, so not translated (PRD 1 §9.4).
  title: 'Kwiz',
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  // A backstop, not the main path: `proxy.ts` rewrites an unrecognised first segment to
  // `/en/<segment>`, so `/de/play/ABC123` 404s as an unknown route before reaching here.
  // The guard stays because Next types this param as a bare `string`, and narrowing it is
  // what makes `lang` below safe.
  //
  // Nothing primes next-intl here: `i18n/request.ts` reads the segment itself through
  // `next/root-params`, which is what replaced the deprecated `setRequestLocale`.
  if (!hasLocale(routing.locales, locale)) notFound()

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
         * Dark by default, following the OS otherwise, unless the theme toggle
         * (`components/theme-toggle.tsx`) has stored an explicit choice — inline and
         * blocking so `.dark` lands on `<html>` before first paint (no flash of the wrong
         * theme), and `suppressHydrationWarning` above is for exactly this: the class this
         * adds differs from what the server rendered, and that mismatch is expected, not a
         * bug.
         *
         * Cannot import `lib/client/theme.ts` — this has to run before any bundle does —
         * so the storage key and the fallback order (`light` → `dark` → follow the OS) are
         * duplicated here by hand; keep the two in sync if either changes.
         *
         * `!isLight` rather than `prefers-color-scheme: dark` matching: the query only
         * tells us when the OS explicitly says light, and "dark unless told otherwise" is
         * the product decision (CLAUDE.md §7's Terminal theme) — an OS with no opinion, or
         * one this query can't read, still gets dark. The change listener only matters
         * without a stored override — this app runs for a whole evening on a laptop nobody
         * restarts, and an OS theme flip (a scheduled light↔dark switch is a common OS
         * default) applies without a reload for anyone who hasn't overridden it.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=null;try{s=localStorage.getItem('kwiz.theme')}catch(e){}var m=window.matchMedia('(prefers-color-scheme: light)');var apply=function(){document.documentElement.classList.toggle('dark',s==='dark'||(s!=='light'&&!m.matches))};apply();m.addEventListener('change',function(){if(s===null)apply()})}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
