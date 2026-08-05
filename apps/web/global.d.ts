import type { routing } from './i18n/routing'
import type { Messages } from './messages/en'

/**
 * Registers the message shape and locale union with next-intl, so `t('landing.scaffold.title')`
 * is checked at compile time and a typo is a build error rather than a visible key on a
 * projected screen.
 */
declare module 'next-intl' {
  interface AppConfig {
    Messages: Messages
    Locale: (typeof routing.locales)[number]
  }
}
