import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'

import { routing } from './routing'

/**
 * Message catalogues are imported through an explicit map rather than a templated dynamic
 * import, so adding a locale is a type error here instead of a 404 at runtime.
 */
const catalogues = {
  en: () => import('../messages/en'),
  nl: () => import('../messages/nl'),
} satisfies Record<(typeof routing.locales)[number], () => Promise<unknown>>

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  return {
    locale,
    messages: (await catalogues[locale]()).default,
  }
})
