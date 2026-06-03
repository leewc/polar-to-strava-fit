# Polar → Strava

Migrate your Polar Flow training history to Strava — in your browser, free, privacy-first.

Live at: https://leewc.com/polar-to-strava-fit/

## Why this exists

Polar Flow's web UI exports activities one at a time. Strava only accepts FIT/TCX/GPX uploads. If you've moved (or are moving) from Polar to Strava and want your historical data with you, you're stuck. This bridges the two:

- Drop your Polar bulk-export ZIP onto the page
- The converter runs in your browser via a Web Worker
- Download a ZIP of Strava-ready .fit files
- Upload to https://www.strava.com/upload/select

## Privacy

Your data never leaves your browser. The converter is a static site with no backend, no analytics, no telemetry, no logging.

Open DevTools → Network tab before dropping your ZIP. You'll see only same-origin asset fetches from the CDN: the initial page load, plus a few JavaScript chunks lazy-loaded as you progress through the wizard (the conversion engine, the stats module, the ZIP library — all code, no data). There are no requests to any third-party service, no requests carrying any of your training data, and no requests to Polar or Strava during conversion.

## How to get your Polar export ZIP

Step-by-step, with attention to current Polar UI flow as of 2026:

1. Sign in at https://flow.polar.com
2. Click your name (top-right) → **Settings** → **Account**
3. Scroll to **Export training data**
4. Click **Request export** — Polar emails a download link when ready (typically a few hours, can take up to a day for large datasets)
5. Download the .zip file from the email link. It'll be named something like `polar-user-data-export_<uuid>.zip` and is typically a few MB depending on how many activities you've recorded.

## How to use the converter

1. Open https://leewc.com/polar-to-strava-fit/
2. Drag your ZIP onto the drop zone (or click to browse)
3. The wizard walks you through 5 stages: ZIP loaded → Sessions found → Converting → Validating → Download
4. Click **Download all as ZIP** — you'll get `polar-to-strava-fit-export.zip` containing one .fit file per activity
5. Open https://www.strava.com/upload/select and drop your .fit files in (Strava accepts up to 25 per batch — split your downloads if needed)

## What gets converted

- Sport classification (Running → Run, Cycling → Ride, etc. — Polar publishes the official mapping, this tool uses it)
- Date/time, duration
- Distance (when present)
- GPS route (when present)
- Heart rate (when recorded)
- Speed, cadence, power, altitude (when recorded)
- Calories

Polar-specific fields that don't fit cleanly into FIT (training benefit, fat percentage, time-in-zone arrays, etc.) are preserved alongside each .fit in a `.polar.json` sidecar that Strava ignores but you can keep for reference.

## Common Strava warnings

Strava runs its own quality checks on uploaded files. Some files may show:

- **"GPS had a bad day"** — your original Polar tracking has a glitch (a teleport between two adjacent records). The converter doesn't touch this; the source data is what's wrong. The activity still uploads, but Strava won't put it on segment leaderboards. You can manually crop the bad segment in Strava if it matters.
- **"May be in a vehicle"** — if you see this, that's a converter bug; please open an issue. The converter divides Polar's km/h SPEED stream by 3.6 to produce FIT's m/s field; if Strava still flags it as vehicle pace, something else is up.
- **Duplicate of activity X** — Strava deduplicates by start time. If you previously uploaded the same activity manually, the new upload is rejected. Harmless — your earlier upload is still there.

## Prefer a CLI?

The whole conversion engine is also runnable headless from a clone of this repo:

```bash
git clone https://github.com/leewc/polar-to-strava-fit
cd polar-to-strava-fit
pnpm install
pnpm convert YOUR-EXPORT.zip out/
# 27 .fit files appear in out/, one per activity
```

The CLI uses the exact same `polarToFit` module that powers the webapp — output is byte-identical. A standalone `npx polar-to-strava-fit` install is on the roadmap (T22).

## Development

This is a TypeScript + Svelte 5 + Vite project with a Node CLI counterpart that shares the conversion module.

```bash
pnpm install
pnpm dev          # webapp dev server at http://localhost:5173/polar-to-strava-fit/
pnpm test         # vitest, 160+ tests
pnpm check        # svelte-check + tsc
pnpm build        # static dist/ for deployment
pnpm convert ZIP OUTDIR   # CLI: convert a ZIP to a directory of .fit files
pnpm validate OUTDIR      # CLI: re-validate a directory of converted .fit files
pnpm inspect FILE.fit     # CLI: pretty-print a FIT file's messages as JSON
```

### Architecture

- **`src/core/`** — pure conversion logic (browser- and Node-portable). Types, JSON5-tolerant parser, polarToFit (8-message FIT activity), 171-row sport map, time helpers, stats.
- **`src/validate/`** — round-trip + conservation + GPS-quality checks. Used by both the webapp and the CLI.
- **`src/webapp/`** — Svelte 5 wizard UI (5-stage state machine), Web Worker pipeline, shadcn-svelte components, marketing/FAQ section.
- **`src/cli/`** — three Node CLIs (`convert` / `inspect` / `validate`) wrapping the core.
- **`fixtures/`** — three anonymized Polar training-session fixtures for tests.
- **`public/sample-polar-export.zip`** — the demo ZIP exposed via the "Try with sample data →" button.

See `PLAN.md` for the full implementation plan, decisions log, and per-wave orchestration playbook. See `WORK_LOG.md` for sub-agent telemetry and cumulative cost.

## License

MIT. The bundled @garmin/fitsdk has its own (FIT Protocol License); see node_modules/@garmin/fitsdk/LICENSE.txt.
