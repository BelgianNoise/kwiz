'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  applyTheme,
  readThemePreference,
  storeThemePreference,
  type ThemePreference,
} from '@/lib/client/theme'
import { cn } from '@/lib/utils'

const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark']
const ICON = { system: Monitor, light: Sun, dark: Moon } as const

/**
 * One control, reused everywhere the shared Terminal tokens reach: the landing page, every
 * admin page (`admin/layout.tsx`), the master control header, and the player device menu.
 *
 * **Never the projected main screen.** PRD 4's screen renders from its own hardcoded dark
 * palette, not these tokens (CLAUDE.md §7) — a toggle there would visibly do nothing, which
 * is worse than no control at all.
 *
 * Cycles system → light → dark → system on tap, icon showing the current choice. A single
 * cycling icon rather than a three-way picker so the same component drops into a dense
 * fixed header (control), a thumb's-reach menu (player) and a roomier admin page alike,
 * without needing a second, wider layout for the ones with less room.
 *
 * Starts unmounted (`null`) rather than guessing: the bootstrap script already decided the
 * effective mode from `localStorage` before this ever renders, and reading that same value
 * again here — synchronously, during render — would read stale server-rendered markup on
 * the very first client render and could disagree with it for one frame. A `null` first
 * render costs nothing a user would notice and never fights the script that got there first.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('common.theme')
  const [preference, setPreference] = useState<ThemePreference | null>(null)

  useEffect(() => {
    setPreference(readThemePreference())
  }, [])

  if (preference === null) return null

  const Icon = ICON[preference]

  const cycle = (): void => {
    const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]!
    storeThemePreference(next)
    applyTheme(next)
    setPreference(next)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`${t('label')}: ${t(preference)}`}
      onClick={cycle}
      className={cn('text-muted-foreground', className)}
    >
      <Icon aria-hidden className="size-4" />
    </Button>
  )
}
