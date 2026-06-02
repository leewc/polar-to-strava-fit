/**
 * Vitest config — extends `vite.config.ts` to add the `browser` resolve
 * condition needed when component tests use `// @vitest-environment happy-dom`.
 *
 * Without `browser` in `resolve.conditions`, the `svelte` package's exports
 * map falls back to its server entry (index-server.js), where `mount(...)`
 * throws `lifecycle_function_unavailable`. We add the condition here rather
 * than in `vite.config.ts` so the dev/build paths stay untouched (vitest
 * picks `vitest.config.ts` over `vite.config.ts` automatically).
 *
 * The `defineConfig({ extends })` form is the documented vitest pattern
 * for layering on top of the project's existing Vite config.
 */
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      conditions: ['browser'],
    },
  }),
)
