import { createNavigation } from 'next-intl/navigation'

import { routing } from './routing'

/**
 * Locale-aware navigation. Using these instead of `next/link` and `next/navigation` is
 * what makes a language switch swap the `[locale]` segment while preserving the current
 * path — PRD 1 §9.4 requires switching to keep game state, an open SSE connection and an
 * in-progress draft answer.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)
