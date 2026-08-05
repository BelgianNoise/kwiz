import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { locale as rootLocale } from 'next/root-params'

import { routing } from './routing'

/**
 * Reads the locale from **`next/root-params`**, Next 16's typed accessor for the dynamic
 * segments of the root layout. Next generates `locale()` from our `app/[locale]` segment.
 *
 * This replaces the older `requestLocale` + `setRequestLocale` pair, which next-intl
 * deprecated in favour of root params. Nothing has to be threaded through the layout any
 * more: the segment is the single source of the locale, and there is no cache to prime.
 *
 * Message catalogues are imported through an explicit map rather than a templated dynamic
 * import, so adding a locale is a type error here instead of a 404 at runtime.
 */
const catalogues = {
  en: () => import('../messages/en'),
  nl: () => import('../messages/nl'),
} satisfies Record<(typeof routing.locales)[number], () => Promise<unknown>>

export default getRequestConfig(async () => {
  const requested = await rootLocale()
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  return {
    locale,
    messages: (await catalogues[locale]()).default,
  }
})
