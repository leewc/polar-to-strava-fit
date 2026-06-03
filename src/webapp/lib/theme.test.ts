// @vitest-environment happy-dom
/**
 * Tests for the theme manager. We use happy-dom so `localStorage`,
 * `document`, and `window.matchMedia` are all available.
 *
 * The module under test performs a side effect on import: it reads the stored
 * pref and applies the .dark class. We use `vi.resetModules()` between tests
 * that care about that initial side effect so each one re-runs the import in
 * a clean slate. Tests that just exercise the public API can `import` once at
 * module top.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/** Stand up a stub for `matchMedia`; happy-dom doesn't ship one by default. */
function installMatchMediaStub(prefersDark: boolean): {
  fire: (matches: boolean) => void
} {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  let current = prefersDark
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).matchMedia = (query: string) => ({
    media: query,
    get matches() {
      return current
    },
    addEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.add(fn)
    },
    removeEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.delete(fn)
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
  })
  return {
    fire: (matches: boolean) => {
      current = matches
      const event = { matches } as MediaQueryListEvent
      for (const fn of listeners) fn(event)
    },
  }
}

describe('theme manager', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    vi.resetModules()
    installMatchMediaStub(false)
  })

  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it("getTheme() returns 'system' by default when nothing is stored", async () => {
    const { getTheme } = await import('./theme')
    expect(getTheme()).toBe('system')
  })

  it("getTheme() returns 'system' for an unrecognized stored value", async () => {
    localStorage.setItem('theme', 'taupe')
    const { getTheme } = await import('./theme')
    expect(getTheme()).toBe('system')
  })

  it("setTheme('dark') applies the .dark class to <html>", async () => {
    const { setTheme } = await import('./theme')
    setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it("setTheme('light') removes the .dark class", async () => {
    document.documentElement.classList.add('dark')
    const { setTheme } = await import('./theme')
    setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it("setTheme('system') resolves to the OS preference (dark)", async () => {
    installMatchMediaStub(true) // OS prefers dark
    const { setTheme } = await import('./theme')
    setTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it("setTheme('system') resolves to the OS preference (light)", async () => {
    installMatchMediaStub(false) // OS prefers light
    document.documentElement.classList.add('dark')
    const { setTheme } = await import('./theme')
    setTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('localStorage roundtrip: persist explicit pref, clear on system', async () => {
    const { setTheme, getTheme } = await import('./theme')
    setTheme('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(getTheme()).toBe('dark')

    setTheme('light')
    expect(localStorage.getItem('theme')).toBe('light')
    expect(getTheme()).toBe('light')

    // 'system' clears the stored pref so reload follows OS again.
    setTheme('system')
    expect(localStorage.getItem('theme')).toBeNull()
    expect(getTheme()).toBe('system')
  })

  it('module-load side effect applies the stored pref on import', async () => {
    localStorage.setItem('theme', 'dark')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    await import('./theme')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('module-load side effect with no stored pref follows OS (dark)', async () => {
    installMatchMediaStub(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    await import('./theme')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('watchSystemTheme() fires on matchMedia change and unsubscribes cleanly', async () => {
    const stub = installMatchMediaStub(false)
    const { watchSystemTheme } = await import('./theme')
    const calls: boolean[] = []
    const unsubscribe = watchSystemTheme((isDark) => calls.push(isDark))

    stub.fire(true)
    stub.fire(false)
    expect(calls).toEqual([true, false])

    unsubscribe()
    stub.fire(true)
    // After unsubscribe, no further callbacks recorded.
    expect(calls).toEqual([true, false])
  })
})
