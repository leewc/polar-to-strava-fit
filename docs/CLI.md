# `polar-to-strava-fit` CLI

A Node CLI that does the same conversion as the webapp at https://leewc.com/polar-to-strava-fit/, headless. Same converter module, byte-identical output. Built for power users, scripts, and AI agents.

```bash
polar-to-strava-fit YOUR-EXPORT.zip out/
# 27 .fit files appear in out/, one per activity
```

## Install

Three ways, in order of stability.

### From a GitHub Release (recommended)

Each tagged release on https://github.com/leewc/polar-to-strava-fit/releases attaches a `polar-to-strava-fit-X.Y.Z.tgz` tarball.

```bash
# Pick a release URL from the Releases page, then:
npm install -g https://github.com/leewc/polar-to-strava-fit/releases/download/v0.1.0/polar-to-strava-fit-0.1.0.tgz

# Or with pnpm:
pnpm install -g https://github.com/leewc/polar-to-strava-fit/releases/download/v0.1.0/polar-to-strava-fit-0.1.0.tgz
```

Then:

```bash
polar-to-strava-fit ZIP OUT
```

The tarball is ~22 KB; `@garmin/fitsdk` and `adm-zip` install transitively from the public npm registry (~1.6 MB total install footprint). First-run cold start is bounded by those installs (~2–10 s depending on cache).

### Directly from GitHub (no release needed)

```bash
npm install -g github:leewc/polar-to-strava-fit
```

`npm` clones the repo, runs `prepublishOnly` (which runs `pnpm build:cli`), and links the bin. Slower than the Release path (full clone) and depends on `pnpm` being available for the prepare hook. Useful if you want bleeding-edge `main`.

### From a local clone (developer path)

```bash
git clone https://github.com/leewc/polar-to-strava-fit
cd polar-to-strava-fit
pnpm install
pnpm convert YOUR-EXPORT.zip out/
```

Works without any global install. Uses `tsx` to run the CLIs from source (no build step).

## Subcommands

The bin recognizes three verbs. The default verb is `convert`, so `polar-to-strava-fit ZIP OUT` is shorthand for `polar-to-strava-fit convert ZIP OUT`.

### `convert`

```bash
polar-to-strava-fit convert YOUR-EXPORT.zip out/
# OR equivalently:
polar-to-strava-fit YOUR-EXPORT.zip out/
```

Reads every `training-session-*.json` entry from the bulk-export ZIP and writes one `<startTimeUTC>-<sport>-<id>.fit` per activity into `out/`. Also writes a slim `<stem>.polar.json` sidecar with Polar-specific metadata that doesn't fit cleanly into FIT (training benefit, time-in-zone, etc.). Prints one line per session plus a summary.

### `inspect`

```bash
polar-to-strava-fit inspect out/2026-04-18T17-01-50Z-Running-0e124a07.fit
polar-to-strava-fit inspect FILE.fit --summary
```

Decodes a FIT file with `@garmin/fitsdk` and pretty-prints messages as JSON. `--summary` mode prints message counts plus first/last record only.

### `validate`

```bash
polar-to-strava-fit validate out/
```

For every `.fit` in the directory: round-trip-decodes it, runs the same conservation check the webapp's validate stage does, and prints a per-file pass/warn/fail row. Exit 0 if no decode failures.

## Troubleshooting

**`polar-to-strava-fit: command not found`** — your global bin directory isn't on `PATH`. `pnpm` and `npm` print the install location at the end of `install -g`; add that to `PATH` and reopen your shell. Or use `pnpm dlx polar-to-strava-fit ZIP OUT` / `npx polar-to-strava-fit ZIP OUT` to avoid the global install entirely.

**Cold start hangs for ~10 seconds on first run** — `npm` is fetching `@garmin/fitsdk` and `adm-zip` to your install cache. Subsequent runs are instant.

**The CLI converted my files but Strava flagged "GPS had a bad day"** — that's a real source-data glitch, not a CLI bug. The webapp's stats UI flags the same warning. Open the affected session in Polar Flow's web UI; you'll see the teleport. Strava still ingests the activity but won't put it on segment leaderboards.

**The CLI converted my files but Strava flagged "may be in a vehicle"** — that would be a CLI bug. Please open an issue with the offending `.fit` (it's just numbers; nothing private survives the converter that wasn't already in your Polar export).

## For AI agents

The CLI is the right surface to script against. Pure I/O with no auth, no rate limits, deterministic output, structured stdout. Recommended pattern:

```bash
mkdir converted
polar-to-strava-fit convert export.zip converted/  # converts every session
polar-to-strava-fit validate converted/             # asserts integrity
# Then upload converted/*.fit to Strava however you want.
```

The bundled bin is a single 76 KB ESM file with a `#!/usr/bin/env node` shebang; no dynamic require, no native binaries, runs anywhere Node 20+ runs.

## Why no `npm publish`?

The package isn't on the public npm registry yet (as of this writing). Reasons:

- The tool is a one-time backfill — most users will use the webapp at https://leewc.com/polar-to-strava-fit/ and never touch the CLI.
- Releasing to npm adds a versioning + maintenance commitment.
- A GitHub Release with an attached tarball gives the same `pnpm/npm install -g <URL>` UX at zero per-version cost.

If you want this on npm, [open an issue](https://github.com/leewc/polar-to-strava-fit/issues) and I'll publish.
