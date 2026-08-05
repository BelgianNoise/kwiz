/**
 * Keys are `<surface>.<section>.<key>` (conventions §6.1), flat within a section and never
 * deeper than three levels, so any key is greppable.
 *
 * Only `common` and `landing` exist so far. `admin`, `control`, `screen`, `player` and
 * `errors` arrive with the surfaces that need them — an empty section written now is a
 * stub, and `errors` in particular must mirror the `ErrorCode` catalogue (conventions §4)
 * exactly, which is slice 3's job.
 *
 * **No hardcoded user-facing string anywhere, including scaffolding.** The rule only holds
 * if it holds from the first page.
 */
const en = {
  common: {
    appName: 'Kwiz',

    /**
     * Language names are **never translated** and are identical in every catalogue
     * (PRD 1 §9.4): both locales must be reachable from a device that cannot read the
     * current one. Never a flag icon alone — flags mean countries, not languages.
     */
    language: {
      label: 'Language',
      en: 'English',
      nl: 'Nederlands',
    },
  },

  landing: {
    scaffold: {
      title: 'Kwiz',
      subtitle: 'The scaffold is running.',
      detail: 'Surfaces are built in build-order slices 4 to 7.',
    },
  },
}

export type Messages = typeof en

export default en
