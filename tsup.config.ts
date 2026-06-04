import { defineConfig } from 'tsup'

/**
 * Bundles the three Node CLIs into a single ESM entry that dispatches on
 * `argv[2]`. We deliberately mark `@garmin/fitsdk` and `adm-zip` as `external`:
 *
 *  - `@garmin/fitsdk` — the FIT Protocol License (Section 2c) prohibits
 *    redistribution. Inlining its source into our tarball would be a license
 *    violation. By keeping it as a runtime dependency in `package.json`, npm
 *    pulls it from Garmin's own published package and the user accepts
 *    Garmin's license at install time, exactly as if they had added it to
 *    their own project.
 *  - `adm-zip` — pure-JS, MIT, but no reason to inline it; let npm install it.
 *
 * Output is a single bin shim under `bin/polar-to-strava-fit.mjs` so the
 * published package's `bin` field can point at one file.
 */
export default defineConfig({
  entry: { 'polar-to-strava-fit': 'src/cli/bin.ts' },
  format: ['esm'],
  outDir: 'bin',
  outExtension: () => ({ js: '.mjs' }),
  target: 'node20',
  platform: 'node',
  external: ['@garmin/fitsdk', 'adm-zip'],
  clean: true,
  shims: false,
  splitting: false,
  sourcemap: false,
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
  dts: false,
})
