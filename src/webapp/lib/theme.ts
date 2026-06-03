/**
 * Theme manager — system-preference-following dark mode + optional manual override.
 *
 * Three modes:
 *   - 'system' — follow `prefers-color-scheme` and react to OS-level changes
 *   - 'light'  — force light theme regardless of OS
 *   - 'dark'   — force dark theme regardless of OS
 *
 * The default is 'system'. The user's choice (when not 'system') is persisted
 * to `localStorage` under the key `theme` so it survives reload.
 *
 * Wiring at runtime:
 *   - `setTheme()` toggles the `dark` class on `<html>`. Tailwind v4's
 *     `@custom-variant dark (&:where(.dark, .dark *))` (configured in app.css)
 *     keys the `dark:` utilities off this class.
 *   - When the mode is 'system', we attach a `matchMedia` listener so flipping
 *     the OS theme updates the page live without a reload.
 *   - The module performs ONE side effect on import: read the stored pref and
 *     apply the resolved class to `<html>`. Importing this from `main.ts`
 *     before the Svelte mount ensures the initial paint uses the right theme
 *     (no flash-of-wrong-theme on dark systems / dark-preferring users).
 *
 * Why a class on `<html>` and not just media query? We need both:
 *   1. an `auto` mode that follows the OS, and
 *   2. a manual override that wins when the user picks light or dark.
 * Pure media queries can't be overridden by a click; a class on the root
 * element can. So the class is the single source of truth, and the 'system'
 * mode just means "let the media query drive the class."
 */

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'
const DARK_CLASS = 'dark'

/** Return the user's saved preference, or 'system' if none / invalid. */
export function getTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return 'system'
}

/** True iff the OS currently prefers dark. Safe in non-browser environments. */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Apply the theme: toggle the `dark` class on `<html>` and persist (or clear)
 * the user's pref. 'system' clears the persisted pref so a fresh page-load
 * goes back to following the OS.
 */
export function setTheme(theme: Theme): void {
  if (typeof localStorage !== 'undefined') {
    if (theme === 'system') {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, theme)
    }
  }
  if (typeof document === 'undefined') return
  const isDark = theme === 'dark' || (theme === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle(DARK_CLASS, isDark)
}

/**
 * Subscribe to OS-level dark-mode changes. Callback fires with `true` when the
 * OS flips to dark, `false` when it flips to light. Returns an unsubscribe.
 *
 * Useful for keeping the page in sync while in 'system' mode without the user
 * having to reload. The callback receives the new boolean directly, not a
 * MediaQueryListEvent — keeps consumer code simple.
 */
export function watchSystemTheme(callback: (isDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = (e: MediaQueryListEvent): void => {
    callback(e.matches)
  }
  mql.addEventListener('change', listener)
  return () => {
    mql.removeEventListener('change', listener)
  }
}

// ---------------------------------------------------------------------------
// Module-load side effect: apply the saved theme NOW so the first paint after
// `import './lib/theme'` already has the right class. No-op outside browsers
// (SSR / Vitest with happy-dom is fine because `document` exists there too).
// ---------------------------------------------------------------------------
if (typeof document !== 'undefined') {
  setTheme(getTheme())
}
