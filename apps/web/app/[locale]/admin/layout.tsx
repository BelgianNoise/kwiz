import type { ReactNode } from 'react'

import { ThemeToggle } from '@/components/theme-toggle'

/**
 * The one thing every admin page shares. There is no admin chrome to speak of — each page
 * builds its own header — so this exists solely to guarantee the theme toggle reaches every
 * one of them without hand-editing eight separate files, and without a ninth one someone
 * adds later silently missing it.
 *
 * Fixed rather than in-flow: a toggle that shifted position per page (because one page has
 * a settings gear where another has a back-link) would be the harder thing to find, not the
 * easier one.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ThemeToggle className="bg-card border-border fixed right-4 bottom-4 border shadow-sm" />
    </>
  )
}
