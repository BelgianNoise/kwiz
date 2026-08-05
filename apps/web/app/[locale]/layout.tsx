import type { Metadata } from 'next'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
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
  // what makes `setRequestLocale` and `lang` below safe.
  if (!hasLocale(routing.locales, locale)) notFound()

  setRequestLocale(locale)

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
