# polar-to-strava-fit — Polar → Strava FIT Converter (static-site webapp)

## Context

User has years of training data locked inside a Polar bulk-export ZIP (32 files, ~10MB). Polar's web UI exports one session at a time only, and Strava accepts FIT/TCX/GPX — not Polar's native JSON. This blocks any reasonable migration path.

**Core tenet: full fidelity, no manipulation.** Sport types, GPS, HR, cadence, calories — anything Polar captured must round-trip into Strava without the user re-classifying activities by hand. The user will link Polar↔Strava for new activities going forward; this is the one-time backfill of historical data.

**Product shape: a static-hosted, browser-only webapp.** The user drops their export ZIP onto a page, watches per-session conversion + validation, downloads `.fit` files (or a single ZIP of them) and uploads to Strava. Zero server, zero network requests after page load — privacy is verifiable in DevTools. Hosted free on GitHub Pages / Cloudflare Pages.

A Node CLI also exists as a secondary tool for first-light validation against the real Polar export and for headless re-runs, but the webapp is the primary deliverable.

## What's actually in the export (verified from the user's ZIP)

- 5 metadata JSON files (account, devices, calendar, profile, favourites) — ignored.
- 29 `training-session-*.json` files — the actual workouts. This particular export has 2 sport types in use, but the converter must handle the full Polar sport catalog because future exports (this user's or others') will.
- Each session has a top-level **`name`** ("Running", "Other indoor") — this is the Polar Flow display label and is the key to the FIT sport mapping. `sport.id` is also present (numeric, undocumented) but used only as a fallback signal.
- Sample streams (1Hz): `DISTANCE` (m, cumulative), `SPEED` (m/s), `HEART_RATE` (bpm). Some values are the literal `NaN` token (sensor dropouts) — `JSON.parse` rejects this; preprocess source text by replacing the bare `NaN` token with `null` before parsing.
- Route waypoints have `latitude`, `longitude`, `elapsedMillis`. No altitude, no cadence, no power in this dataset (the converter must still wire these through when present in other exports).
- `laps` is always `{}` in this dataset → emit a single lap covering the full session.
- `startTime` is local civil time (e.g. `2025-08-16T17:12:22`); `timezoneOffsetMinutes` (e.g. `-420`) gives the offset to UTC. FIT requires UTC timestamps.

The user's ZIP `polar-user-data-export_de647c3a-0cdf-4e0f-afcb-1a64eaa77441.zip` is in the project directory and is the working dataset for development and validation.

## Format choice: FIT

Strava accepts FIT, TCX (v2), GPX (v1.1) and gzipped variants (per `https://developers.strava.com/docs/uploads/`, verified 2026-06-01). FIT is correct here because:

- **Full sport-type fidelity.** TCX limits to `Running` / `Biking` / `Other` — every non-running, non-cycling activity (swimming, hiking, strength, yoga, skiing, …) becomes "Other" and the user re-classifies in Strava. That violates the no-manipulation tenet.
- **Polar publishes the exact mapping.** The Polar AccessLink "Sport type mapping in FIT-files" appendix maps Polar Flow display labels directly to FIT `sport` + `sub_sport` enums. Running→`RUNNING/STREET`, Trail running→`RUNNING/TRAIL`, Mountain biking→`CYCLING/MOUNTAIN`, Indoor cycling→`CYCLING/INDOOR_CYCLING`, Open water swimming→`SWIMMING/OPEN_WATER`, Strength training→`TRAINING/STRENGTH_TRAINING`, etc. We embed this table and fall back to `GENERIC` for unmapped labels (which is exactly what Polar's own first-party export does).
- **Strava reads FIT natively** and infers activity type from `session.sport` + `session.sub_sport` directly — no post-upload cleanup needed.

Cost is debuggability (binary format) and bundle size for the webapp (~80KB min+gzip for `@garmin/fitsdk`). The debuggability problem is solved with the SDK's own decoder + a `inspect` helper that dumps any `.fit` to JSON. Bundle size is fine for a static-hosted single-purpose tool.

## Stack

**Svelte 5 + Vite + TypeScript**, styled with **Tailwind + shadcn-svelte** components, deployed as a static site.

- **Vite** — dev server with HMR, ESM-native, builds to plain static files. `@garmin/fitsdk` is ESM-only and Vite handles it without polyfill drama.
- **Svelte 5** — ~5KB runtime, components compile to vanilla JS. The UI is naturally form-shaped (file in → progress list → files out), which Svelte handles in fewer lines than React with smaller output.
- **shadcn-svelte + Tailwind** — copy-paste components (no runtime library dep), zero per-component bundle cost beyond what we use, modern neutral look. Built on `bits-ui` headless primitives. Components used: `Button`, `Card`, `Checkbox`, `Progress`, `Badge`, `Alert`, `Select`. Tailwind handles layout, spacing, typography.
- **TypeScript end-to-end** — same converter module powers the webapp AND the Node CLI. No rewrite.
- **The pure converter (`polarToFit.ts`) has zero environment-specific imports** — runs identically in browser and Node.

### Browser-side pipeline

```
<input type="file"> → file.arrayBuffer()
                   → fflate.unzipSync (in-memory, no disk)
                   → for each training-session-*.json entry:
                       text → NaN→null preprocess → JSON.parse → polarToFit(session)
                       → Uint8Array
                   → wrap each in Blob, plus a download-all ZIP via fflate.zipSync
                   → URL.createObjectURL for download links
```

Web Worker offloads the conversion loop so the UI stays responsive (28+ sessions × thousands of records each is non-trivial CPU). The pure converter is identical in main thread or worker.

### Node CLI side (secondary)

`pnpm convert <zip> <out>` is a ~30 line wrapper using `node:fs` + `adm-zip` that calls the same `polarToFit`. Used for headless runs and as the fastest path to first-light validation against Strava (no UI needed to drag the first .fit out and upload it).

## Dependencies

- **Runtime (webapp):** `svelte`, `@garmin/fitsdk`, `fflate`, `tailwindcss`, `bits-ui` (shadcn-svelte's headless primitive base; no direct shadcn npm — its components are copy-pasted into `src/webapp/lib/components/ui/`). That's the entire surface area users download.
- **Runtime (CLI):** `@garmin/fitsdk`, `adm-zip`.
- **Dev:** `vite`, `@sveltejs/vite-plugin-svelte`, `typescript`, `vitest`, `@vitest/browser` (for testing browser pipeline), `tsx` (run TS scripts directly), `playwright` (E2E for the webapp), `tailwindcss`, `autoprefixer`, `@tailwindcss/typography`.

## Project layout

```
polar-to-strava-fit/
├── package.json              # type: module
├── tsconfig.json             # target ES2022, strict
├── vite.config.ts            # base: '/polar-to-strava-fit/' for GitHub Pages
├── index.html                # Vite SPA entry
├── src/
│   ├── core/                 # PURE, environment-agnostic — used by webapp + CLI
│   │   ├── polarToFit.ts     # (session: PolarSession) => Uint8Array
│   │   ├── polarToFit.test.ts
│   │   ├── parsePolarJson.ts # NaN-tolerant JSON parser
│   │   ├── sportMap.ts       # Polar Flow label → { sport, subSport }
│   │   ├── time.ts           # local↔UTC + FIT local_timestamp helper
│   │   └── types.ts          # PolarSession TS interface
│   ├── webapp/               # Svelte UI
│   │   ├── App.svelte        # top-level state machine (5 stages below)
│   │   ├── DropZone.svelte   # drag-drop / click-to-pick file input
│   │   ├── ManifestList.svelte # per-session row with checkbox + sport label
│   │   ├── ProgressList.svelte # converting / done / warning per row
│   │   ├── DownloadPanel.svelte # individual + zip-all download links
│   │   ├── worker.ts         # Web Worker that runs polarToFit in batches
│   │   ├── pipeline.ts       # orchestrates: unzip → convert → validate → blob
│   │   └── main.ts           # mounts App
│   ├── cli/
│   │   ├── convert.ts        # `pnpm convert <zip> <out>`
│   │   ├── inspect.ts        # `pnpm inspect <fit>` — decode + pretty-print
│   │   └── validate.ts       # `pnpm validate <out-dir>` — batch sanity check
│   └── validate/
│       └── checks.ts         # PURE conservation/round-trip checks; reused by both webapp and CLI validators
├── fixtures/                 # 3 representative training-session-*.json files
├── public/                   # static assets (favicon, etc.)
├── polar-user-data-export_de647c3a-0cdf-4e0f-afcb-1a64eaa77441.zip   # the user's working dataset (gitignored)
└── out/                      # CLI output (gitignored)
```

## Pure converter: `polarToFit(session) → Uint8Array`

Builds the FIT message stream in this exact order (verified canonical from Garmin's `encode-activity-recipe.test.js`):

1. **`file_id`** — `type=ACTIVITY`, `manufacturer=DEVELOPMENT` (or `POLAR_ELECTRO`), `product=1`, `serial_number=<derive from Polar identifier.id>`, `time_created=startTimeUTC`. Must be the first message.
2. **`device_info`** (creator) — `device_index=CREATOR`, manufacturer/product/sw_version stamped from Polar `application.name` / `product.modelName`.
3. **`event`** — `event=TIMER`, `event_type=START`, `timestamp=startTimeUTC`.
4. **`record`** stream — one per second of the session. Required: `timestamp`. Optional fields when available: `position_lat`/`position_long` (degrees → semicircles `Math.round(deg * 2^31 / 180)`), `distance`, `speed`, `heart_rate`, `altitude`, `cadence`, `power`. Missing/`NaN` values omitted.
5. **`event`** — `event=TIMER`, `event_type=STOP`, `timestamp=stopTimeUTC`.
6. **`lap`** — single lap covering the whole session. Required: `message_index=0`, `timestamp=stopTimeUTC`, `start_time=startTimeUTC`, `total_elapsed_time=durationMillis/1000`, `total_timer_time=durationMillis/1000`. Add `total_distance`, `total_calories`, `avg_heart_rate`, `max_heart_rate`, `sport`, `sub_sport` when known.
7. **`session`** — `message_index=0`, `timestamp=stopTimeUTC`, `start_time=startTimeUTC`, `total_elapsed_time`, `total_timer_time`, `sport`, `sub_sport`, `first_lap_index=0`, `num_laps=1`, plus aggregates when present.
8. **`activity`** — terminal aggregate. `timestamp=stopTimeUTC`, `total_timer_time`, `num_sessions=1`, `local_timestamp` (Unix timestamp + offset, FIT-spec recipe).

## Sport mapping: `sportMap.ts`

Object literal `Record<string, { sport: number; subSport?: number }>`, keyed on the Polar Flow display label exactly as it appears in `session.name`. Values are FIT enum members from `@garmin/fitsdk`'s `Profile`. Seeded from Polar's published "Sport type mapping in FIT-files" appendix (~150 rows). Default fallback `{ sport: GENERIC }`.

**Why key on `name` and not `sport.id`:** numeric `sport.id` is undocumented by Polar (research confirmed nowhere in their public docs or swagger). The `name` field IS Polar's official human-readable Sport-in-Polar-Flow label, which IS the key Polar uses in their published FIT mapping. This sidesteps reverse-engineering.

## Edge cases the converter handles

- **`NaN` literals.** Preprocess input text: `text.replace(/\bNaN\b/g, 'null')` before `JSON.parse`. Treat parsed `null` as missing and omit that record field.
- **Indoor sessions with no GPS.** Emit records with `timestamp` + HR only.
- **Missing entire sample streams** (small 2022 indoor sessions have no DISTANCE/SPEED). Iterate to `min(availableStreamLengths)`.
- **Timezone.** Parse `startTime` as naive local, then add `-timezoneOffsetMinutes` minutes to get UTC.
- **Sample / waypoint length mismatch** (1384 samples vs 1383 waypoints). Walk both with a moving cursor; bail at the shorter.
- **Coordinate conversion.** Degrees → semicircles `Math.round(deg * (2 ** 31) / 180)`.
- **Unknown sport name.** Webapp surfaces a yellow warning row and lets the user override the FIT sport via dropdown before download. CLI logs the warning and falls back to `GENERIC`.

## Webapp UX — single-page wizard

All 5 stages stack vertically on one page in `App.svelte`. Each stage shows one of three states: **completed** (✓, collapsed to a one-line summary, click to re-expand), **active** (▼, expanded with full detail), or **pending** (◯, dimmed). Privacy footer always visible.

```
┌─────────────────────────────────────────────────┐
│  Polar → Strava                                 │
│  Convert your Polar export to Strava-ready FIT  │
│                                                 │
│  ✓ 1. ZIP loaded                                │
│    polar-user-data-export.zip · 10.2 MB         │
│                                                 │
│  ✓ 2. 29 sessions found       [edit selection]  │
│                                                 │
│  ▼ 3. Converting...                             │
│    ████████████████░░░░  18 / 29                │
│    ✓ 2025-08-16 · Running · 4455 records        │
│    ✓ 2026-05-23 · Running · 1383 records        │
│    ⟳ 2026-04-04 · Running · ...                 │
│                                                 │
│  ◯ 4. Validating                                │
│  ◯ 5. Download                                  │
│                                                 │
│  Your data never leaves your browser →          │
└─────────────────────────────────────────────────┘
```

Stage details:

1. **ZIP loaded** — `DropZone.svelte` accepts a single `.zip` via drag-drop or click-to-pick. shadcn `Card` wrapper, dashed border on hover, file size shown after pick.
2. **Sessions found** — `ManifestList.svelte` lists each `training-session-*.json` (date, duration, sport label as a `Badge`, GPS y/n icon, sample summary). shadcn `Checkbox` per row, defaulting to checked. Header reads "29 sessions ready. Convert all →" with a primary `Button`.
3. **Converting** — `ProgressList.svelte` shows a `Progress` bar plus per-row status (`pending|converting|ready|warning|error`) using shadcn `Badge` colour variants. Web Worker offloads conversion. Live record-count when ready.
4. **Validating** — per-row mini-report rendered as a compact `Alert` if outside tolerance: distance Δ vs Polar source within 1%, duration Δ within 1s, record count vs expected. Green check otherwise. User can still download warned files.
5. **Download** — `DownloadPanel.svelte` shows a primary "Download all as ZIP" `Button` (one `polar-to-strava-fit-export.zip` packed via `fflate.zipSync`) + per-row individual `.fit` download links. Copy-to-clipboard "Strava upload URL" button.

Out of band: `SportOverridePanel.svelte` — a collapsible card listing any GENERIC-fallback rows. shadcn `Select` for FIT sport, optional second `Select` for sub_sport. Re-runs that single session's `polarToFit` on change.

## Validation

Strava is the final correctness oracle. Layered local checks first:

1. **Round-trip with `@garmin/fitsdk` Decoder** — every produced `.fit` is decoded back to messages and asserted to contain `file_id`, `session`, `activity` and a non-zero record count. Encoder→Decoder identity catches any malformed output.
2. **Total-conservation** — `sum(record.distance deltas) ≈ session.total_distance ≈ Polar.distanceMeters` within ~1%; `(session.stop - session.start) ≈ Polar.durationMillis/1000` within 1s.
3. **Record count** — equals `min(availableSampleLengths)` (or `samplesLen` for indoor).
4. **Sport sanity** — `session.sport` + `session.sub_sport` match what `sportMap` returned for the source's `name`.
5. **Strava test upload** — manual; user uploads smallest GPS .fit + smallest indoor .fit and confirms Strava ingests with sane metrics. After acceptance, batch-upload the rest.

## Hosting

Vite produces a flat `dist/` directory with hashed asset filenames. Deploy to **GitHub Pages** via a single `gh-pages`-style action that runs `vite build` and pushes `dist/` to a `gh-pages` branch. `vite.config.ts` sets `base: '/polar-to-strava-fit/'` to match the Pages URL. Total transfer per visit: ~150KB gz (Svelte runtime + fitsdk + fflate + app code). Cloudflare Pages or Netlify are equally workable alternatives.

## Out of scope

- Strava OAuth direct upload (manual upload at `https://www.strava.com/upload/select` is sufficient).
- TCX / GPX output paths.
- Multi-lap splitting (Polar data has none in this dataset).
- Empirical reverse-engineering of numeric `sport.id` (sidestepped by keying on `name`).
- i18n (English-only initial release).

---

## Decomposition: parallelizable task graph

Each task is a discrete unit with a narrow interface. Run within a phase concurrently (worktree isolation if same repo). Each task ends by running `pnpm test` for its tests and reporting PASS or a structured failure.

### Phase 0 — Scaffolding (1 task, blocking everything)

**T0. `scaffold-project`**
- Initialize Vite + Svelte 5 + TS via `pnpm create vite . --template svelte-ts` (manually adjusted), set `package.json` `"type": "module"`.
- Add `vite.config.ts` with `base: '/polar-to-strava-fit/'`, Svelte plugin.
- Install runtime: `svelte`, `@garmin/fitsdk`, `fflate`, `adm-zip`, `tailwindcss`, `bits-ui`, `clsx`, `tailwind-merge` (the last two are shadcn-svelte conventions). Dev: `typescript`, `vitest`, `@vitest/browser`, `tsx`, `@types/node`, `autoprefixer`, `@tailwindcss/typography`, `playwright`.
- Initialize Tailwind: `pnpm dlx tailwindcss init -p`. Configure `tailwind.config.ts` to scan `./src/**/*.{html,js,ts,svelte}`. Add the shadcn-svelte CSS-variable theme to `src/webapp/app.css`.
- Initialize shadcn-svelte: `pnpm dlx shadcn-svelte@latest init` (sets up `src/webapp/lib/utils.ts` and `components.json`). Pre-add the components we need: `Button`, `Card`, `Checkbox`, `Progress`, `Badge`, `Alert`, `Select` via `pnpm dlx shadcn-svelte@latest add button card checkbox progress badge alert select`.
- `tsconfig.json` strict, ES2022, paths alias `@core/*` → `src/core/*`, `$lib/*` → `src/webapp/lib/*` (shadcn-svelte convention).
- Create empty directories matching the Project Layout. Add `.gitignore` (`node_modules`, `dist`, `out`, `*.zip`).
- Wire npm scripts: `dev`, `build`, `preview`, `test`, `test:e2e` (playwright), `convert` (`tsx src/cli/convert.ts`), `inspect` (`tsx src/cli/inspect.ts`), `validate` (`tsx src/cli/validate.ts`).
- Acceptance: `pnpm dev` serves a Svelte page rendering a shadcn `Button` with Tailwind classes applied; `pnpm test` runs and finds zero tests without erroring; `pnpm build` produces `dist/`.
- **Inputs:** none. **Outputs:** committed scaffold.

### Phase 1 — Core building blocks (4 tasks, fully parallel)

All four read only this plan + the research file. Independent of each other. Each emits files in `src/core/` plus tests.

**T1. `types-and-fixtures`**
- Write `src/core/types.ts` with the `PolarSession` interface mirroring the JSON shape (`identifier`, `name`, `startTime`, `stopTime`, `durationMillis`, `distanceMeters`, `timezoneOffsetMinutes`, `sport.id`, `hrAvg`, `hrMax`, `calories`, `exercises[]` with `samples.samples[]` and `routes.route.wayPoints[]`). Allow `null` in sample `values[]`.
- Extract 3 fixtures from `polar-user-data-export_de647c3a-0cdf-4e0f-afcb-1a64eaa77441.zip` into `fixtures/`:
  - `running-large.json` — `training-session-2025-08-16T17:12:22-...` (Running, GPS, ~4455 records)
  - `indoor-tiny.json` — `training-session-2022-06-18T18:50:02-...` (Other indoor, no GPS, HR-only)
  - `running-recent.json` — `training-session-2026-05-23T10:46:22-...` (Running, GPS, mid-size)
- Apply `NaN→null` preprocessing to fixtures so they parse with raw `JSON.parse` (T3 still does this at runtime; fixtures are pre-cleaned for fast test bootstrapping).
- **Inputs:** the user's ZIP. **Outputs:** `src/core/types.ts`, `fixtures/*.json`.

**T2. `sport-map`**
- Write `src/core/sportMap.ts`: `Record<string, { sport: number; subSport?: number }>` keyed on Polar Flow label. Values from `Profile.MesgNum` constants in `@garmin/fitsdk`.
- Seed from the full Polar AccessLink "Sport type mapping in FIT-files" appendix. The agent research file at `/Users/wenlee/.claude/plans/we-want-to-assist-linked-candle-agent-a9c3a939142443db6.md` has the canonical sample. Implementer fetches the live page at `https://www.polar.com/accesslink-api/#sport-type-mapping-in-fit-files` to capture all ~150 rows.
- Export a `lookupSport(name: string)` helper returning the mapped enum or the GENERIC fallback, plus a boolean `isFallback` flag for the webapp's warning UI.
- Tests: at least 12 representative mappings + GENERIC fallback for unknown labels + case-insensitive match for "Running" vs "running".
- **Inputs:** Polar appendix. **Outputs:** `src/core/sportMap.ts` + `.test.ts`.

**T3. `parse-polar-json`**
- Write `src/core/parsePolarJson.ts` exporting `parsePolarJson(text: string): PolarSession`.
- Replace `\bNaN\b` with `null`, then `JSON.parse`, then minimal runtime shape check (top-level `identifier.id`, `startTime`, `exercises` array exists).
- Tests: NaN-only sample stream parses to all `null`s; mixed NaN/number; no NaN; malformed JSON throws with a useful message; missing top-level field throws.
- **Inputs:** none. **Outputs:** `src/core/parsePolarJson.ts` + tests.

**T4. `time-utils`**
- Write `src/core/time.ts`:
  - `polarLocalToUtcDate(startTime: string, timezoneOffsetMinutes: number): Date` — parse naive local string, return UTC `Date`.
  - `fitLocalTimestamp(utcDate: Date, timezoneOffsetMinutes: number): number` — Unix seconds + offset for FIT's `local_timestamp` field.
- Tests: PDT (-420), UTC (0), JST (+540), DST edge dates, exact second boundaries, milliseconds rounding.
- **Inputs:** none. **Outputs:** `src/core/time.ts` + tests.

### Phase 2 — Pure converter (1 task, gated by Phase 1)

**T5. `polar-to-fit`**
- Write `src/core/polarToFit.ts` exporting `polarToFit(session: PolarSession): Uint8Array`.
- Implement the 8-message FIT pipeline (file_id → device_info → event(start) → records → event(stop) → lap → session → activity) using `@garmin/fitsdk`'s `Encoder`.
- Pull in T1 (types), T2 (sportMap), T3 (parser only used in tests), T4 (time).
- Tests against all 3 fixtures:
  - Encoder→Decoder round-trip: assert message types & ordering, non-zero record count.
  - Conservation: sum of record-distance ≈ Polar `distanceMeters` within 1%.
  - Sport pass-through: emitted `session.sport`/`sub_sport` matches `sportMap[name]`.
  - Indoor session emits zero `position_lat`/`position_long` records.
  - Timestamps round-trip to UTC correctly given the source's local time + offset.
- **Inputs:** T1–T4. **Outputs:** `src/core/polarToFit.ts` + comprehensive `.test.ts`.

### Phase 3 — Shared validation (1 task, gated by T5)

**T6. `validation-checks`**
- Write `src/validate/checks.ts` exporting pure functions:
  - `decodeAndAssertStructure(bytes: Uint8Array): DecodedSummary` — round-trip with Decoder, return `{ recordCount, sport, subSport, totalDistance, totalElapsedSeconds }` or throw.
  - `conservationReport(session: PolarSession, decoded: DecodedSummary): ValidationReport` — emits `{ ok, distanceDeltaPct, durationDeltaSec, recordCountExpected, recordCountActual, sportMatches, warnings: string[] }`.
- Reused by both the webapp validate stage AND the CLI's batch validator.
- Tests: hand-craft a synthetic PolarSession + run a real polarToFit→checks round-trip on each fixture, assert all report fields.
- **Inputs:** T5. **Outputs:** `src/validate/checks.ts` + tests.

### Phase 3.5 — Early Strava acceptance gate (manual, blocks Track A)

**T6.5. `early-strava-gate`** — pause the orchestrator BEFORE Track A.
- Run `pnpm convert polar-user-data-export_de647c3a-0cdf-4e0f-afcb-1a64eaa77441.zip out/` (this depends on a tiny version of T7-B-cli-convert; build that first if not yet built — see ordering note below).
- Surface to the user: the path to the smallest GPS `.fit` (likely the 2022 outdoor running session) AND the path to the smallest indoor `.fit` (likely a 2022 indoor session).
- User uploads BOTH at `https://www.strava.com/upload/select` and reports back: ACCEPTED + correct sport + correct metrics, ACCEPTED + misclassified, or REJECTED with error message.
- Branch:
  - **Accepted, looks right** → unblock Track A (webapp). Track B (other CLI helpers) and Track A run in parallel from here.
  - **Misclassified or rejected** → loop back to T5 with the specific error. Re-run T7-B-convert. Re-ask user. Track A stays blocked.
- **Why this gate exists:** the webapp produces byte-identical FIT bytes to the CLI (same `polarToFit` module). If Strava rejects the CLI output, the webapp would too. Validating early means we don't waste Track A effort on a broken converter.
- **Ordering note:** T7-B (cli-convert) is logically in Phase 4 Track B but is needed by T6.5. The orchestrator should pull T7-B forward to run immediately after T6, then run T6.5, then unblock everything else.
- **Inputs:** T6, T7-B (early). **Outputs:** user-reported acceptance log; if PASS, the green light to start Phase 4.

### Phase 4 — Two parallel tracks (gated by T6)

These tracks are independent of each other and can run fully in parallel. Track A is the webapp (the deliverable). Track B is the CLI (used for first-light validation, faster to hand-test).

#### Track A — Webapp (4 tasks, parallel within track after T7-A is done)

**T7-A. `webapp-pipeline-and-worker`** — gates the rest of Track A.
- `src/webapp/pipeline.ts`: a stateful orchestrator that takes a `File` (the ZIP), unzips with `fflate.unzipSync`, iterates entries matching `training-session-*.json`, calls `parsePolarJson` then `polarToFit`, runs `decodeAndAssertStructure` + `conservationReport`, emits per-session events `{ status, fileName, blob?, report?, error? }`.
- `src/webapp/worker.ts`: a Web Worker wrapper that runs `pipeline.ts` and `postMessage`s progress events. Keeps the UI thread responsive during conversion.
- Tests: vitest `@vitest/browser` mode runs the full pipeline against a synthetic minimal-zip `File` constructed in the test, asserts the right sequence of progress events and final blob non-emptiness.
- **Inputs:** T3, T5, T6. **Outputs:** `src/webapp/pipeline.ts`, `src/webapp/worker.ts` + tests.

**T8-A. `webapp-ui-shell`** — runs in parallel with T9-A and T10-A after T7-A.
- `src/webapp/main.ts`, `src/webapp/App.svelte`. Top-level Svelte 5 component implementing the 5-stage state machine (drop → manifest → progress → validate → download).
- Wires the worker from T7-A: posts the file, listens for progress events, threads them into reactive state.
- No styling beyond a minimal CSS reset + readable typography. Plain HTML inputs where possible; CSS variables for the theme so a future skin pass is cheap.
- Acceptance: `pnpm dev`, drag the user's ZIP, watch all 5 stages render in sequence and produce 29 download links.
- **Inputs:** T7-A. **Outputs:** `src/webapp/App.svelte`, `src/webapp/main.ts`, `index.html`.

**T9-A. `webapp-row-components`** — parallel with T8-A and T10-A after T7-A.
- `src/webapp/DropZone.svelte` — drag-drop and click-to-pick `.zip`.
- `src/webapp/ManifestList.svelte` — per-session row: date, name, sport label, GPS y/n, duration, sample summary, checkbox.
- `src/webapp/ProgressList.svelte` — per-session row with status (`pending|converting|ready|warning|error`), spinner, record count when ready.
- `src/webapp/DownloadPanel.svelte` — "download all as ZIP" + per-row download buttons + Strava upload-URL copy button.
- Each component is a dumb prop-driven view. Tests via `@vitest/browser` mounting each component with sample props and asserting rendered text + emitted events.
- **Inputs:** T7-A. **Outputs:** the 4 `.svelte` components + tests.

**T10-A. `webapp-sport-override`** — parallel with T8-A and T9-A after T7-A.
- A small `SportOverridePanel.svelte` listing every row whose sport mapping fell back to GENERIC. Dropdown of `Profile.Sport` enum members + optional `Profile.SubSport` for re-classification.
- On change: re-runs that single session's `polarToFit` with the override and updates the download blob.
- Test: synthesize a session with name `"Made-up sport"`, assert it surfaces in the override panel; assert that selecting RUNNING/STREET produces a session with `sport=RUNNING/sub_sport=STREET`.
- **Inputs:** T7-A. **Outputs:** `src/webapp/SportOverridePanel.svelte` + test.

#### Track B — Node CLI (3 tasks, fully parallel after T6)

**T7-B. `cli-convert`**
- `src/cli/convert.ts`: `pnpm convert <zip-path> <out-dir>`.
- Walk ZIP with `adm-zip`, call `parsePolarJson` → `polarToFit`, write `<out>/<stem>.fit` and `<out>/<stem>.polar.json` (slim sidecar with calories, training benefit, weight, FTP, time-in-zone — drop sample arrays and waypoints since those are in the FIT).
- Filename `{startTimeUTC}-{sportLabel}-{shortId}.fit` with `:` → `-`.
- Smoke test: invoke against the user's real ZIP and assert 29 outputs.
- **Inputs:** T3, T5. **Outputs:** `src/cli/convert.ts`.

**T7-B-2. `cli-inspect`**
- `src/cli/inspect.ts`: `pnpm inspect <fit>` — decode with `@garmin/fitsdk` Decoder, pretty-print messages as JSON to stdout.
- Test: round-trip a fixture .fit, assert dump contains `file_id`, `session`, `activity`.
- **Inputs:** T5. **Outputs:** `src/cli/inspect.ts`.

**T7-B-3. `cli-validate`**
- `src/cli/validate.ts`: `pnpm validate <out-dir>`. For every `.fit`: run T6's `decodeAndAssertStructure` + `conservationReport`. Pretty-print pass/fail per file, aggregate totals.
- Test on the real conversion output.
- **Inputs:** T6, T7-B. **Outputs:** `src/cli/validate.ts`.

### Phase 5 — Real-world acceptance (1 task, manual)

**T11. `strava-acceptance`**
- Use the CLI (faster than the webapp for first-light) to convert the user's ZIP. Pick smallest GPS file and smallest indoor file from `out/`. User uploads both at `https://www.strava.com/upload/select`.
- Confirm: file accepted, sport classification matches, distance / duration / HR plot / route render correctly.
- If a file is rejected: feed Strava's error message back into a fix-it pass on T5.
- After acceptance passes for both file types, the user batch-uploads the remaining 27 (Strava UI accepts up to 25 per batch).
- This is the only task that requires user-in-the-loop.
- **Blocks:** webapp deploy (T12).

### Phase 6 — Deploy (1 task, gated by T11)

**T12. `deploy-to-pages`**
- Add a `.github/workflows/pages.yml` action that runs `pnpm build` and publishes `dist/` to GitHub Pages.
- Verify the live URL loads, accepts the user's ZIP, runs the full pipeline, produces working downloads.
- Add a brief `README.md` explaining the privacy claim, supported formats, and how to verify zero network requests.

## Dependency graph

```
T0 (scaffold)
 │
 ├─► T1 (types+fixtures) ─┐
 ├─► T2 (sportMap) ───────┤
 ├─► T3 (parsePolarJson) ─┼─► T5 (polarToFit) ─► T6 (validation/checks) ─┐
 └─► T4 (time utils) ─────┘                                              │
                                                                         │
            ┌────────────────────────────────────────────────────────────┤
            │                                                            │
            ▼ Track A (webapp, gated by T7-A then 3-wide parallel)       ▼ Track B (CLI, 3-wide parallel)
            T7-A (pipeline+worker)                                       T7-B  (cli-convert)
            ├── T8-A  (UI shell)                                         T7-B-2 (cli-inspect)
            ├── T9-A  (row components)                                   T7-B-3 (cli-validate)
            └── T10-A (sport override)                                          │
                                                                                ▼
                                                          T11 (Strava acceptance, manual; uses CLI output)
                                                                                │
                                                                                ▼
                                                          T12 (deploy webapp to GitHub Pages)
```

## Parallelism summary

- **Phase 0 (T0):** 1 task, blocks all.
- **Phase 1 (T1–T4):** **4-wide.**
- **Phase 2 (T5):** 1 task, gated.
- **Phase 3 (T6):** 1 task, gated.
- **Phase 4 Track A:** T7-A first (1 task), then **3-wide** (T8-A, T9-A, T10-A).
- **Phase 4 Track B:** **3-wide** after T6, plus runs concurrently with Track A.
- **Phase 5 (T11):** manual user step.
- **Phase 6 (T12):** 1 task.

Peak concurrency window is during Phase 4: up to 3 (Track A inner) + 3 (Track B) = 6 tasks running in parallel.

## Per-task interface contract (orchestrator-friendly)

Each task spec above is self-contained with explicit inputs and outputs. An orchestrator hands a task ID + this plan + the named research file to a worker. Worker produces the named source file(s) + tests, runs `pnpm test --run` for its own tests, and returns:

- `PASS` with a list of files written, OR
- `FAIL` with the first failing test name and assertion message.

This is the only protocol the orchestrator needs to wire up multi-agent execution.

## Verification (end-to-end)

1. `pnpm test` — all unit/integration tests pass.
2. `pnpm convert polar-user-data-export_*.zip out/` — 29 `.fit` + 29 `.polar.json`, no errors, 0 unmapped sport labels in this dataset.
3. `pnpm validate out/` — all conservation + round-trip checks pass.
4. `pnpm dev`, drop the user's ZIP onto the page — all 5 stages render, 29 downloads available.
5. Drag the smallest GPS .fit and the smallest indoor .fit to `https://www.strava.com/upload/select`. Confirm both are accepted with correct sport classification, time, distance, HR plot, route.
6. Batch-upload the remaining 27 in 2 batches of <25.
7. After T12, the live GitHub Pages URL works end-to-end with DevTools showing zero network requests during conversion.

---

## Decisions log

Reverse-chronological. Captures the "why" behind each choice so we don't re-litigate later.

- **2026-06-01 — Project name: `polar-to-strava-fit`.** Used as repo name, package name, and GitHub Pages URL slug. *Why:* explicit about both endpoints (Polar source, Strava destination) and the format (FIT). Plain over cute — anyone reading a URL or import path knows immediately what this is.
- **2026-06-01 — UI: single-page wizard layout.** All five stages stacked on one page; completed stages collapse to a one-line summary, active stage expanded, pending stages dim. Chosen over a multi-step stepper or two-pane manifest+detail. *Why:* the user runs this tool once for a one-time backfill, not repeatedly. A wizard makes the sequence obvious; a stepper adds clicks; a two-pane layout is overkill for 29 sessions.
- **2026-06-01 — Component library: shadcn-svelte + Tailwind.** Chosen over Skeleton UI, Flowbite, DaisyUI, vanilla Tailwind, or bare bits-ui. *Why:* copy-paste components mean no runtime library dep (smallest bundle), the design language is neutral enough to re-skin later, all needed components (Button, Card, Checkbox, Progress, Badge, Alert, Select) are available, Svelte 5 support is current.
- **2026-06-01 — Add early Strava-acceptance gate (T6.5) before Track A.** Pull T7-B-cli-convert forward so we can manually upload a converted .fit before building the webapp. *Why:* webapp produces byte-identical bytes via the same `polarToFit`; if Strava rejects the CLI output, the webapp would too. Validating early avoids wasted Track A effort.
- **2026-06-01 — Output format: FIT (not TCX).** *Why:* fidelity tenet. TCX limits to Running/Biking/Other and forces post-upload manual re-classification for every other sport. FIT supports the full Polar sport catalog natively, and Polar publishes the exact label→FIT-enum mapping. Cost is binary debuggability (mitigated by `inspect` helper) and ~80KB bundle (acceptable for static-host single-purpose tool).
- **2026-06-01 — Sport mapping keyed on Polar `name` field, not `sport.id`.** *Why:* the numeric `sport.id` in the bulk-export JSON is undocumented by Polar (verified absent from their public docs and swagger). The `name` field is Polar's official human-readable Sport-in-Polar-Flow label, which is the key Polar's own published "Sport type mapping in FIT-files" appendix uses. Sidesteps reverse-engineering an undocumented enum.
- **2026-06-01 — Stack: TypeScript end-to-end (Svelte 5 + Vite + Node CLI).** Chosen over Python-CLI-then-rewrite-to-JS. *Why:* the same pure converter module powers both the webapp and the Node CLI with zero rewrite. The webapp is the deliverable; the CLI is a faster path to first-light Strava validation. Both consume `polarToFit.ts` unchanged.
- **2026-06-01 — Static-site, browser-only deployment.** *Why:* matches the privacy tenet — user's data never leaves their machine, and they can verify in DevTools. Free hosting (GitHub Pages / Cloudflare Pages). No server, no backend, no auth, no rate limits, no cost.
- **2026-06-01 — No Strava OAuth, manual upload only.** *Why:* one-time backfill; OAuth adds API integration, rate limits (100/15min, 1000/day), and a registered-app dependency. Manual drag-drop at `https://www.strava.com/upload/select` is sufficient for 29 files (Strava UI accepts 25/batch).
- **2026-06-01 — JSON sidecar emitted alongside each .fit.** *Why:* keeps Polar-specific richness (training benefit, weight, FTP, time-in-zone) available for future tools without bloating the FIT. The sample arrays and waypoints are dropped from the sidecar — they're already in the FIT.
- **2026-06-01 — No local upload-tracking manifest.** *Why:* Strava already deduplicates uploads by start time. A local manifest just duplicates that logic.
- **2026-06-01 — `NaN` handling: text-level preprocessing.** Replace `\bNaN\b` → `null` before `JSON.parse`. *Why:* `JSON.parse` rejects the literal `NaN` token; the preprocessing is local to one regex and treats parsed `null`s as missing values throughout the converter.
- **2026-06-01 — FIT writer: `@garmin/fitsdk` (official npm package).** Chosen over hand-rolling a FIT writer. *Why:* CRC + record/definition message protocol is easy to get subtly wrong in ways Strava silently rejects. Official SDK is ESM, browser-compatible, zero runtime deps, ~80KB min+gzip. License is the FIT Protocol License (non-OSI but free for this use).

---

## How to orchestrate the work with multiple agents

The plan is structured to be run by an orchestrator (Ralph Wiggum, Workflow tool, or any task runner that can dispatch agents). Each task above is self-contained: an agent reads this plan and the named research file, produces the named output files + tests, runs `pnpm test --run` for its own tests, and reports PASS or structured FAIL.

### Setup (do this once before kicking off)

1. **Working directory: `/Users/wenlee/dev/polar-strava/`** — keep the existing directory; don't rename. The project is *named* `polar-to-strava-fit` (in `package.json`, repo URL, Pages URL) but the local checkout stays where it is to avoid disturbing the user's filesystem.
2. **Save this plan into the project directory** so every agent can read it: copy `/Users/wenlee/.claude/plans/we-want-to-assist-linked-candle.md` to `/Users/wenlee/dev/polar-strava/PLAN.md` and the research file `/Users/wenlee/.claude/plans/we-want-to-assist-linked-candle-agent-a9c3a939142443db6.md` to `/Users/wenlee/dev/polar-strava/RESEARCH.md`. Agents working in worktrees off this repo see both at the project root.
3. **Confirm the user's ZIP is in place** at `polar-user-data-export_de647c3a-0cdf-4e0f-afcb-1a64eaa77441.zip` in the project root. T1 needs it to extract fixtures.
4. **Initialize git** in the project root if not already (`git init`, initial commit of just the ZIP + PLAN.md + RESEARCH.md). All subsequent task work goes in worktrees off this repo.
5. **Run T0 (scaffold) sequentially.** Do NOT parallelize this — every other task imports from the scaffold. One agent, one PR-equivalent, merge before fan-out.

### Recommended execution sequence

```
Step 1 (sequential, 1 agent):
  T0 scaffold-project
   ↓ (commit/merge)

Step 2 (parallel, 4 agents in 4 worktrees):
  T1 types-and-fixtures │ T2 sport-map │ T3 parse-polar-json │ T4 time-utils
   ↓ (all four commit/merge)

Step 3 (sequential, 1 agent):
  T5 polar-to-fit
   ↓ (commit/merge)

Step 4 (sequential, 1 agent):
  T6 validation-checks
   ↓ (commit/merge)

Step 5 (sequential, 1 agent — pulled forward from Track B):
  T7-B cli-convert
   ↓ (commit/merge)

Step 6 (manual, USER):
  T6.5 early-strava-gate — pause here, hand the user the two test files
   ↓ (PASS = unblock; FAIL = back to T5)

Step 7 (parallel, up to 6 agents in 6 worktrees):
  Track A: T7-A pipeline+worker (gates the rest of Track A)
            → T8-A UI shell │ T9-A row components │ T10-A sport override
  Track B: T7-B-2 cli-inspect │ T7-B-3 cli-validate
   ↓ (all commit/merge)

Step 8 (manual, USER):
  T11 strava-acceptance — full batch upload
   ↓

Step 9 (sequential, 1 agent):
  T12 deploy-to-pages
```

### Per-agent prompt template

Hand each agent a prompt of this shape:

> You are implementing task `<TASK_ID>` from `PLAN.md` in the project root. Read PLAN.md and RESEARCH.md before starting. Produce ONLY the files listed under your task's "Outputs". Run `pnpm test --run` for any new tests you add. If everything passes, report `PASS` with the list of files written. If anything fails, report `FAIL` with the failing test name and the assertion message — DO NOT try to fix tasks outside your scope.

Plus task-specific notes: e.g. for T2, "fetch the live `https://www.polar.com/accesslink-api/#sport-type-mapping-in-fit-files` page to capture all ~150 rows; the canonical sample is in RESEARCH.md."

### Worktree isolation

For Step 2 and Step 7, use `isolation: "worktree"` when dispatching agents (the Workflow tool supports this directly). Each agent gets a fresh git worktree off the current HEAD. They edit only their own files; conflicts are impossible. After each agent reports PASS, fast-forward-merge their worktree branch into main (or the integration branch).

### Failure handling

- **Test failures inside an agent's scope** → the agent fixes them.
- **Test failures outside the agent's scope** (e.g. T5 fails because T2 had a bug) → the agent reports FAIL with details and stops. Orchestrator dispatches a fix-up agent against the upstream task.
- **Strava rejection at T6.5** → orchestrator parses the error, dispatches a T5 fix-up agent with the error message, redoes T7-B + T6.5.

### Why this structure works

- **T0 first, alone** — every other task depends on the scaffold. Parallelizing T0 with anything else creates conflicting `package.json` edits.
- **T1–T4 fully parallel** — they touch disjoint files (`types.ts`, `sportMap.ts`, `parsePolarJson.ts`, `time.ts`) and have no inter-dependencies.
- **T5 alone** — it's the keystone. Single-author, single-commit, single-test-file.
- **T6.5 manual gate before Track A** — saves wasted webapp effort if the FIT output is broken.
- **Track A and Track B parallel** — they touch different directories (`src/webapp/` vs `src/cli/`) and consume the same shared core unchanged.
- **T11 + T12 sequential at the end** — both are gates the user must walk through.

Peak parallelism: 6 agents during Step 7. Wall-clock estimate (assuming each task takes 10–30 minutes of agent time):

- Step 1 (T0): ~15 min
- Step 2 (T1–T4 parallel): ~25 min (slowest task)
- Steps 3–4 (T5, T6 sequential): ~50 min
- Step 5 (T7-B): ~15 min
- Step 6 (user): bounded by you
- Step 7 (parallel): ~30 min (slowest task, T7-A or T8-A)
- Steps 8–9: bounded by you + ~15 min for T12

Total agent time: ~2.5 hours wall-clock if everything passes first try; double it for one fix-up loop somewhere.
