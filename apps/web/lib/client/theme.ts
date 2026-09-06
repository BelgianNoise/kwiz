'use client'

/**
 * The theme toggle's own preference — `'system'` (the default: follow the OS, live) or an
 * explicit override.
 *
 * Same `localStorage` convention as `device.ts`: try/catch around every access, because
 * storage can be unavailable (private browsing, a locked-down browser) — a failed read or
 * write is answered by falling back to `'system'`, the same way a device with no token
 * falls back to the team picker rather than erroring.
 *
 * Global, not per-game: unlike the device token, this is a preference about the device
 * itself, not about any one game.
 *
 * The root layout's bootstrap script applies this before first paint, in inline JS that
 * cannot import this module — keep `KEY` and the fallback order (`light` → `dark` →
 * system) in sync by hand if either changes.
 */

const KEY = 'kwiz.theme'

export type ThemePreference = 'system' | 'light' | 'dark'

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      localStorage.removeItem(KEY)
    } else {
      localStorage.setItem(KEY, preference)
    }
  } catch {
    // The class still flips for this tab (applyTheme runs regardless); only persistence
    // across a reload is lost, the same graceful degradation as a lost device token.
  }
}

/** Whether the effective mode is dark, given a preference and the OS's own current setting. */
export function resolveDark(
  preference: ThemePreference,
  systemPrefersLight: boolean,
): boolean {
  if (preference === 'light') return false
  if (preference === 'dark') return true
  return !systemPrefersLight
}

/** Flips `<html>`'s `.dark` class to match a preference, right now, in this tab. */
export function applyTheme(preference: ThemePreference): void {
  const systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
  document.documentElement.classList.toggle(
    'dark',
    resolveDark(preference, systemPrefersLight),
  )
}
