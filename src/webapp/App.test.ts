// @vitest-environment happy-dom
/**
 * App.test.ts — initial-render check for the 5-stage wizard.
 *
 * Svelte 5's package.json `exports` resolves to `index-server.js` under
 * Node — a stub whose `mount` throws `lifecycle_function_unavailable`. The
 * shared `vite.config.ts` doesn't set `resolve.conditions: ['browser']`
 * and the T8-A constraint forbids touching it. Without that condition no
 * trivially-available client renderer exists in the test env, so per
 * T8-A's explicit allowance ("Skip if a Svelte test renderer isn't
 * trivially available") this file uses `it.skip` for the mount-and-assert
 * path.
 *
 * What still runs: a *static* check on `App.svelte`'s compiled module to
 * confirm it loads without throwing and exposes the Svelte 5 component
 * shape (a function exported as default). This guards against accidental
 * regressions to the App module without needing the client renderer. The
 * full DOM-level assertions live in the Playwright E2E suite (T13) which
 * runs against `pnpm preview`.
 */
import { describe, expect, it } from 'vitest'

import App from './App.svelte'

describe('App.svelte — module load', () => {
  it('exports a Svelte 5 component as default', () => {
    // Svelte 5 components compile to plain functions. Asserting the type
    // catches the broadest class of import-time regressions.
    expect(typeof App).toBe('function')
  })

  // Full-DOM mount + initial-render assertion. Skipped under the Node
  // test env because Svelte 5's `mount` is the server stub there.
  // Re-enable once vite.config.ts can be updated with
  // `resolve: { conditions: ['browser', 'svelte'] }`.
  it.skip('renders the 5-stage wizard with stage 1 active and 2..5 pending', async () => {
    const { mount } = await import('svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)
    mount(App, { target })

    const text = document.body.textContent ?? ''
    expect(text).toContain('Polar → Strava')
    expect(text).toContain('1. ZIP loaded')
    expect(text).toContain('Sessions found')
    expect(text).toContain('Converting')
    expect(text).toContain('Validating')
    expect(text).toContain('Download')
    expect(text).toContain('never leaves your browser')
    expect(text).toContain('Drop your Polar export ZIP here')
    const pendingMarkers = (text.match(/◯/g) ?? []).length
    expect(pendingMarkers).toBeGreaterThanOrEqual(4)
  })
})
