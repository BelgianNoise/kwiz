import type { Messages } from './en'

/**
 * Typed as `Messages`, so a key present in English and missing here is a **compile error**
 * rather than a runtime fallback nobody notices. PRD 1 §9.2 requires full EN/NL parity on
 * the player and main screen, and the compiler is a cheaper guarantee than a review.
 *
 * Dutch runs 20–30% longer than English, which is why it — not English — is the layout
 * baseline for the main screen (PRD 1 §9.4).
 */
const nl: Messages = {
  common: {
    appName: 'Kwiz',

    // Identical to the English catalogue on purpose — see the note there.
    language: {
      label: 'Taal',
      en: 'English',
      nl: 'Nederlands',
    },
  },

  landing: {
    scaffold: {
      title: 'Kwiz',
      subtitle: 'De basisopzet werkt.',
      detail: 'De schermen worden gebouwd in build-order slices 4 tot 7.',
    },
  },
}

export default nl
