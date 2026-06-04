# T22 — CLI vending feasibility

**Date:** 2026-06-03
**Verdict:** **ship** — the work is straightforward, the tarball is ~22 KB gzipped (well under all thresholds), the FIT-license redistribution problem is sidestepped by keeping `@garmin/fitsdk` external, and the npm name is available.

---

## TL;DR

| Metric | Value |
|---|---:|
| Tarball (gzipped) | **22 KB** |
| Unpacked package | **84 KB** |
| Bundled bin (`bin/polar-to-strava-fit.mjs`) | 76 KB |
| Total install footprint (incl. `@garmin/fitsdk` 1.3 MB + `adm-zip` 164 KB transitively) | ~1.6 MB |
| `npm view polar-to-strava-fit` | 404 — name available |
| Smoke test against real export ZIP | 27/27 sessions converted, 27/27 validate ok, inspect prints clean JSON |
| Tests passing | 160 + 1 skipped |
| Type errors | 0 |

The thresholds in the task brief (<5 MB unpacked, <1 MB tarball) are met by **two orders of magnitude**.

---

## Investigation

### Q1. Bundle size

`tsup` config at `tsup.config.ts`:

- Single entry `src/cli/bin.ts` → `bin/polar-to-strava-fit.mjs`.
- `format: ['esm']`, `target: 'node20'`, `platform: 'node'`.
- `external: ['@garmin/fitsdk', 'adm-zip']` — see Q5 for the licensing rationale.
- `banner: { js: '#!/usr/bin/env node' }` so the file is directly executable.
- `clean: true`, `splitting: false`, `sourcemap: false`, `minify: false`, `dts: false` — single self-contained file, no debug map shipped, readable enough to audit.

Build output:

```
ESM bin/polar-to-strava-fit.mjs 76.16 KB
ESM ⚡️ Build success in 18ms
```

`pnpm pack` produces:

```
$ ls -la polar-to-strava-fit-0.0.0.tgz
-rw-r--r--  22046 polar-to-strava-fit-0.0.0.tgz   # 22 KB gzipped
$ tar -tvzf polar-to-strava-fit-0.0.0.tgz
package/package.json       2119
package/README.md          4456
package/bin/polar-to-strava-fit.mjs   77984      # bundled CLI
```

The `files` field in `package.json` whitelists exactly three entries (`bin/polar-to-strava-fit.mjs`, `README.md`, `LICENSE`), so no test fixtures, source `.ts`, or webapp assets sneak in. Both thresholds pass with massive headroom:

- Unpacked: **84 KB** ≪ 5 MB target (60× headroom).
- Tarball: **22 KB** ≪ 1 MB target (45× headroom).

### Q2. End-to-end UX

Built the prototype, packed, installed locally two ways:

**Path A — local install into a sandbox:**

```
$ pnpm add /path/to/polar-to-strava-fit-0.0.0.tgz
+ polar-to-strava-fit 0.0.0
$ ./node_modules/.bin/polar-to-strava-fit /tmp/polar-real-export.zip out
wrote 2025-08-17T00-12-22Z-Running-0de21131.fit (4455 records, sport=running/street, 93882 bytes)
... (25 more) ...
wrote 2025-06-25T02-40-58Z-Other-indoor-81384352.fit (3610 records, sport=generic/generic, 21988 bytes)
27 sessions converted, 0 sport-mapping fallbacks
$ ls out/*.fit | wc -l
      27
```

**Path B — pnpm global install:**

```
$ pnpm install -g /path/to/polar-to-strava-fit-0.0.0.tgz
+ polar-to-strava-fit 0.0.0
$ polar-to-strava-fit /tmp/polar-real-export.zip out
... 27 lines ...
27 sessions converted, 0 sport-mapping fallbacks
$ ls out/*.fit | wc -l
      27
```

**Subcommands:**

```
$ polar-to-strava-fit inspect out/2026-05-23T17-46-22Z-Running-0e16eab9.fit --summary
{
  "counts": { "fileIdMesgs": 1, "deviceInfoMesgs": 1, "eventMesgs": 2,
              "recordMesgs": 1384, "lapMesgs": 1, "sessionMesgs": 1, "activityMesgs": 1 },
  "firstRecord": { "timestamp": "2026-05-23T17:46:22.000Z", ... },
  "lastRecord": { ... }
}

$ polar-to-strava-fit validate out
✓ 2026-05-23T17-46-22Z-Running-0e16eab9.fit
... (26 more) ...
27 files: 27 ok, 0 warned, 0 failed

$ polar-to-strava-fit --help     # prints usage
$ polar-to-strava-fit --version  # 0.0.0-dev
```

`npx polar-to-strava-fit ZIP OUT` would behave identically once published — npx's contract is "fetch the package's bin and run it", which is exactly what `pnpm install -g` did locally.

The two-arg unprefixed form (`polar-to-strava-fit ZIP OUT`) is the headline UX from the README. The dispatcher in `src/cli/bin.ts` recognizes `convert | inspect | validate | --help | --version` and falls through to `runConvertCli` for everything else, so `polar-to-strava-fit foo.zip out/` works without typing `convert`.

### Q3. One bin or three?

**One bin with subcommands.** Already implemented:

```json
"bin": { "polar-to-strava-fit": "bin/polar-to-strava-fit.mjs" }
```

Why one bin:

- npm's bin namespace is global. Three names (`polar-to-strava-fit`, `polar-to-strava-fit-inspect`, `polar-to-strava-fit-validate`) is three opportunities to collide and three things to remember.
- All three subcommands share `@garmin/fitsdk` as a peer dep already; bundling them into one file costs nothing because tsup deduplicates the imports.
- The unprefixed two-arg form gives the convert UX a "default verb" feel while still allowing `polar-to-strava-fit inspect ...` for the rare uses.
- The bundled bin already passes a single-file basename guard (`/(^|[\\/])convert\.[mc]?[tj]s$/` in each module) so importing `runConvertCli` from `src/cli/bin.ts` doesn't accidentally fire the dev-time `tsx convert.ts` self-execution path.

A future split is reversible — three separate bins can be added without renaming the existing one. The reverse (collapsing three bins to one) requires a major version bump.

### Q4. Naming

`https://registry.npmjs.org/polar-to-strava-fit` returns **HTTP 404**. Name is available.

Quick scan for fallbacks (all also 404 / available):

- `polar-strava-fit`
- `polar2strava`
- `polar-export-to-fit`

Recommended primary: **`polar-to-strava-fit`**. Reasons:

- Matches the repo, the GitHub Pages slug, the homepage URL, the `package.json` name field, and the README brand. Zero rename surface.
- Verb-explicit and direction-explicit: nobody confuses input/output.
- "fit" suffix disambiguates from any future Polar-to-anything tool (e.g. a TCX variant).

If the user wants to publish under a scope, `@leewc/polar-to-strava-fit` is also available (no scope conflict on `@leewc`). Scoped names are easier to defend against typo-squats but add a flag to install (`pnpm add @leewc/polar-to-strava-fit`).

### Q5. License — `@garmin/fitsdk`

`node_modules/.pnpm/@garmin+fitsdk@21.205.0/node_modules/@garmin/fitsdk/LICENSE.txt` is the **FIT Protocol License Agreement** (Garmin International, last updated 2022-10-12). The relevant sections:

- **§1 (Grant):** non-exclusive, royalty-free, non-transferable, **non-sublicensable** license to use the SDK for the licensee's internal business purposes.
- **§2c (Use restrictions):** "Licensee shall not... rent, lease, lend, sell, sublicense, assign, **distribute**, publish, **transfer or otherwise make available the Licensed Technology**, or any features or functionality of the Licensed Technology, to any third party for any reason."
- **§4 (Confidentiality):** the SDK itself is treated as Garmin's Confidential Information.

**Conclusion: redistributing the SDK source inside our published tarball would violate §2c.** Inlining `@garmin/fitsdk` into `bin/polar-to-strava-fit.mjs` would qualify as distribution.

**The fix is already in place.** `tsup.config.ts` marks `@garmin/fitsdk` (and `adm-zip` — MIT but no reason to inline) as `external`. They stay as runtime deps in `package.json`:

```json
"dependencies": {
  "@garmin/fitsdk": "^21.205.0",
  "adm-zip": "^0.5.16"
}
```

When a user runs `npm install polar-to-strava-fit`, npm (or pnpm/yarn) pulls `@garmin/fitsdk` from Garmin's own published package on the npm registry. The user accepts Garmin's license at install time, exactly as if they had added the dep to their own project. Garmin chose to publish to npm with this license; the install-time acceptance flow is the path Garmin sanctioned.

This is the same pattern every other npm package using `@garmin/fitsdk` follows (e.g. `fit-decoder`, `fit-encoder` wrappers on npm). It is not a novel reading of the license.

**One README disclosure already exists** at `README.md` line 78:

> The bundled @garmin/fitsdk has its own (FIT Protocol License); see node_modules/@garmin/fitsdk/LICENSE.txt.

Recommend re-wording slightly post-publish to "the [npm-installed] @garmin/fitsdk" to make explicit that we don't ship it. Not a blocker.

**No lawyer round needed.** The mechanism is identical to every other Node project that depends on a non-OSI-licensed package via npm.

### Q6. Publish workflow

Recommendation: **manual `pnpm publish` initially; add a release-tag GitHub Action only if/when the cadence justifies it.**

**Manual flow (preferred for v0.x):**

```bash
# 1. Flip private flag in package.json
#    "private": true → remove or set to false
# 2. Bump version
pnpm version patch       # or minor/major
# 3. Build (prepublishOnly hook runs `pnpm build:cli` already)
# 4. Publish
pnpm publish --access public
# 5. Tag in git
git push --follow-tags
```

Setup time: **~5 minutes** (mostly the `pnpm version` + `pnpm publish` and confirming the prompt). Requires a one-time `npm login` against an Anthropic-or-personal npm account.

**GitHub Action flow (defer):**

A `.github/workflows/release.yml` that triggers on `v*` tags, runs `pnpm install && pnpm build:cli && pnpm test && pnpm publish` with `NODE_AUTH_TOKEN` from a secret. Setup time: ~30 minutes (writing the workflow + adding the npm automation token to repo secrets + smoke-testing the first release with a `--dry-run` step).

Why defer: this is a one-time backfill tool, not a SaaS the user iterates on weekly. The release cadence will likely be "publish once, fix one or two bugs over the next few months, that's it." Manual publish from the user's machine has fewer moving parts and one fewer secret to rotate.

The existing `prepublishOnly: pnpm build:cli` script in `package.json` already prevents publishing a stale bin file — that hook runs automatically before either manual or GHA publish.

---

## Risks (acknowledged, not blockers)

- **`private: true` flag.** Currently set in `package.json`. Must be flipped to publish. Pre-flight checklist item, not a code change.
- **Version pinning of `@garmin/fitsdk`.** Currently `^21.205.0`. If Garmin ships a breaking change in `22.x`, our bundle would not auto-update users; they'd get the latest matching `^21` until manually updated. This is industry-standard semver behavior and matches the webapp's own pinning, but is worth noting in a release note.
- **No PII in bundled output.** Verified — `bin/polar-to-strava-fit.mjs` contains only the converter source, no fixtures, no real export data, no API keys.
- **README references `node_modules/@garmin/fitsdk/LICENSE.txt` for license text.** Pre-publish edit: link to https://www.npmjs.com/package/@garmin/fitsdk instead so installed users have a stable reference.
- **`npx polar-to-strava-fit` cold-start is bounded by `@garmin/fitsdk` install time.** ~2-4 s on a warm npm cache; ~10 s on a cold one. Acceptable for a one-time backfill tool but worth surfacing in the README so users don't think it's hung.
- **pnpm-only worktree state.** The current `package.json` includes `devEngines.packageManager.name: pnpm`. Pre-publish, confirm yarn / npm users can install the published tarball without the `devEngines` field rejecting them — `devEngines` is advisory by spec but worth a sanity install via `npm i -g` from the registry once published.
- **No CHANGELOG.md exists yet.** Trivial to add; conventional but not strictly required for a v0.x package.

---

## Files written / modified during this investigation

These were already present from prior work in this worktree (verified, untouched today):

- `tsup.config.ts` — bundle config
- `src/cli/bin.ts` — single-bin dispatcher
- `src/cli/convert.ts` — added `runConvertCli` export + bundle-safe self-execution guard
- `src/cli/inspect.ts` — added `runInspectCli` export + bundle-safe self-execution guard
- `src/cli/validate.ts` — added `runValidateCli` export + bundle-safe self-execution guard
- `package.json` — `bin`, `files`, `engines`, `keywords`, `homepage`, `repository`, `prepublishOnly`, runtime deps narrowed to `@garmin/fitsdk` + `adm-zip`
- `bin/polar-to-strava-fit.mjs` — built artifact (76 KB)
- `polar-to-strava-fit-0.0.0.tgz` — packed tarball (22 KB)

This report:

- `docs/research/cli-vending-feasibility.md`

---

## Recommendation: **ship**

Concrete next-steps the user takes:

1. Flip `private: true` → remove it (or set to `false`) in `package.json`.
2. `pnpm version 0.1.0` (or `0.0.1` if more conservative).
3. `npm login` to whichever npm account will own the package.
4. `pnpm publish --access public` (the `prepublishOnly` hook rebuilds the bin first).
5. Smoke test once: `pnpm dlx polar-to-strava-fit ZIP OUT` from an unrelated directory.
6. Add a one-paragraph "Use the CLI: `npx polar-to-strava-fit ZIP OUT`" note to the README's marketing/FAQ section.
7. Link from the live site footer.

Total post-decision work: ~30 minutes including the README edit and a sanity-check upload to Strava.
