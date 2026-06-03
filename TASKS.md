# Tasks

Live task list mirroring Claude Code's task manager. The canonical state is in
the harness (`/tasks` slash command); this file is the durable copy that
travels with the repo. Update it alongside task transitions in the same
commit.

Status legend: 🟢 done · 🟡 in-progress · ⚪ pending · 🔵 user step · 🟥 blocked

## Done

| # | Task | Status | Commits |
|---|---|---|---|
| 1 | Setup: copy plan + research to project root | 🟢 | `acd8f37` |
| 2 | Setup: init git repo + initial commit | 🟢 | `acd8f37` |
| 3 | T0: scaffold Vite + Svelte 5 + TS + Tailwind + shadcn-svelte | 🟢 | `430e8d2` |
| 4 | Phase 1 fan-out — T1, T2, T3, T4 in parallel | 🟢 | `dc55081` `6b5a322` `d897f8f` `62adae2` `16e8309` |
| 5 | T5: polarToFit pure converter (8-message FIT activity) | 🟢 | `6bd669e` |
| 6 | T6: validation/checks shared module | 🟢 | `edcc7c8` |
| 7 | T7-B (early): cli-convert | 🟢 | `16dbd02` |
| 8 | T6.5: early Strava acceptance gate (manual upload) | 🟢 🔵 | passed 2026-06-02 |
| 12 | T6.6: GPS-quality detection + warnings + optional crop | 🟢 | `dcd201a` |
| 9 | Phase 4: webapp + CLI helpers fan-out (waves 1+2) | 🟢 | `cfbd660` `2d5c276` `b3fef3c` `90e030b→d837804` `f290a2b` `5fe8122` |
| 10 | T11: full Strava batch upload via webapp | 🟢 🔵 | Confirmed working 2026-06-02; webapp produced upload-ready files |
| 11 | T12: deploy to GitHub Pages | 🟢 | Live at https://leewc.com/polar-to-strava-fit/ (custom CNAME, Cloudflare-fronted). `leewc.github.io/polar-to-strava-fit/` 301-redirects to it. Workflow: `.github/workflows/pages.yml`. |
| 16 | T16: landing-page README (privacy + how-to-export Polar ZIP) | 🟢 | `46307d5` |
| 17 | T17: lucide-svelte icons throughout the webapp | 🟢 | `f0def2a` (15 icons across the wizard) |
| — | Empty-zip dead-end + 'Start over' button | 🟢 | `04a6432` (mid-flight UX fix) |
| 13 | T13: animations (slide / pulse / ring-flash) + Strava-warnings info pane + per-row GPS report | 🟢 | `50021ea` (merged via `300f8ff`) |
| 15 | T15: anonymized sample/demo ZIP + 'Try with sample data →' CTA | 🟢 | `feb92ec` (merged via `300f8ff`); 7 sessions, 5 runs + 2 indoor, one with deliberate GPS teleport |
| 18 | T18: gate `currentStage = 5` on `sessionCount > 0` so empty-manifest stays visible | 🟢 | `300f8ff` (folded into the wave-3b merge) |
| 19 | T19: fix sample-zip 'invalid zip data' (URL was wrong) + content-type guard + 5 fetch tests | 🟢 | `6fa03f4` |
| 14 | T14: stats dashboard (Best Efforts 400m–HM + totals) | 🟢 | `b8781b9` (merged via `2e8c469`); StatsCard renders between Stage 4 and 5 |
| 20 | T20: marketing/FAQ section below the wizard | 🟢 | `485861a` (merged via `2ac910d`); MarketingSection with 6 FAQ entries (AI transparency, Why-this-tool, FIT-vs-TCX, Strava warnings, no-OAuth, offline) + footer |
| 21 | T21: dark mode (follow system preference + optional manual cycle toggle) | 🟢 | Tailwind v4 `@custom-variant dark` + `lib/theme.ts` (system/light/dark, localStorage roundtrip, matchMedia listener) + Sun/Moon/Laptop header toggle. 10 new theme tests; 0 type errors. |
| 23 | T23: bundle-size regression fix — dynamic-import the stats path | 🟢 | Main JS 554→143 KB (gz 116→48 KB), worker unchanged at 459 KB; `@core/stats`, `@core/parsePolarJson`, `fflate` are dynamically imported inside `buildStatsReport()` so @garmin/fitsdk only ships in the on-demand stats chunk + the worker. |
| 24 | T24: stats `(i)` tooltip noting Best Efforts is Running-only | 🟢 | Cheap interim — `Info` icon next to the Best Efforts header with a hover/title explainer. Superseded by T25 if Tier-1 lands. |
| — | Polish wave: branded hero (Polar red + Strava orange icons), favicon, 2-state theme toggle | 🟢 | Live at https://leewc.com/polar-to-strava-fit/. Trademark-safe (no actual Polar/Strava logos used). |
| — | Privacy claim refined post-T23 | 🟢 | "Only same-origin code fetches; no third-party calls; no requests carrying training data; no calls to Polar or Strava." Same guarantee, more accurate now that T23 lazy-loads chunks. |

## In progress / pending

| # | Task | Status | Notes |
|---|---|---|---|
| 22 | T22: vendor a CLI install + link from website (feasibility study) | 🟡 | Sub-agent in worktree investigating: bundle size, npx UX, naming, license, publish flow. Returns ship/defer/do-not-ship recommendation + optional prototype tarball. **No npm publish yet** — user reviews report first. |
| 25 | T25: Tier-1 multi-sport Best Efforts (cycling/swimming/walking) — synthetic-data prototype | 🟡 | Sliding-window algo is sport-agnostic; only reference distances differ. Synthesized test sessions for each family. **Explicitly not committed** — user testing the synthetic flow before deciding to ship. |

## Backlog (no commitments)

- Screenshots of the wizard for the README + marketing section
- PWA service worker for true offline mode
- Multi-lap support (no real Polar data has lap markers in the user's export, but other exports do)
- **Stats Tier 2** — power-based Best Efforts for cycling (peak 5s/1min/5min/20min/60min watts), HR-zone time-in-zone breakdown for any sport. Discrete add-ons, ~3-4h each.
- **Stats Tier 3** (skip) — per-sport custom dashboards. Combinatorial, not actually useful.
- Strava OAuth direct upload — explicitly out of scope (privacy/one-time use)

## Mid-flight discoveries (logged in `PLAN.md` Decisions)

- **2026-06-02** — Polar SPEED stream is km/h, FIT enhancedSpeed is m/s (off by 3.6×). Caught by Strava "may be in a vehicle" flag during T6.5. Fix: `36542eb`.
- **2026-06-02** — One real session had a 4.5 km GPS teleport in 1 second. Strava flagged "GPS had a bad day". Converter is faithful; source data is glitched. Spawned T6.6 (detection + optional crop).
- **2026-06-02** — Wave-2 worktree-isolation merge: T8-A, T9-A, T10-A all installed/wrote shadcn primitives in their own worktrees. T9-A had the most complete (real shadcn-svelte CLI output); T8-A & T10-A's stubs were discarded in favor of T9-A's during the integration commit (`d837804`). Lesson: pin shadcn install to a single agent in future fan-outs.
- **2026-06-02** — Svelte 5 `$effect` reactive-loop bug in App.svelte's `perFileUrls` URL revoker. Reading `perFileUrls` inside its own effect re-triggered it. Fix: `untrack()` the read. (`5fe8122`)
- **2026-06-03** — Empty-manifest dead-end. The `all-done` event handler unconditionally pushed `currentStage = 5`, collapsing the stage-2 empty-state UI. Fix: gate the stage-5 transition on `sessionCount > 0`. (T18, `300f8ff`)
- **2026-06-03** — Sample-zip CTA fetched via `import.meta.url` resolved relative to the JS bundle at `/polar-to-strava-fit/assets/`, hitting a 404 and getting the SPA fallback HTML which fflate then choked on. Fix: use `import.meta.env.BASE_URL` (Vite-provided, deploy-base-aware) + content-type guard for clearer error. (T19, `6fa03f4`)
- **2026-06-03** — Wave-2 lessons applied to wave-3a/b/4: pre-installing shadcn before fan-out (T17 single-agent) prevented the duplicate-shadcn-install fight from wave-2. Subsequent waves merged with at most one minor App.svelte conflict per wave (icon imports + Stage 1 markup), all auto-resolvable.
- **2026-06-03** — T14 stats dashboard re-parsed the source ZIP in App.svelte by statically importing `@core/stats`, `@core/parsePolarJson`, and `fflate`. Those imports transitively pulled @garmin/fitsdk (~430 KB) into the *main* bundle on top of the worker bundle that already contained it. Main JS ballooned from ~125 KB → 554 KB (gz 42 → 116). Fix (T23): swap to dynamic `await import()` inside `buildStatsReport()` so Vite code-splits them into an on-demand chunk. Main JS back to 143 KB (gz 48), stats chunk 374 KB (gz 56) loads only after `all-done` fires. Cost is a single async hop before StatsCard renders. Worker bundle unchanged.

## Artifacts in this repo

- `PLAN.md` — full implementation plan (decomposition, decisions log, orchestration playbook)
- `RESEARCH.md` — research notes on FIT format, Polar→FIT sport mapping, `@garmin/fitsdk` audit
- `TASKS.md` — this file
- `WORK_LOG.md` — per-task agent telemetry (tokens, tool uses, durations) + session cost
- `docs/research/*` — original research artifacts (Strava formats, FIT format + Polar mapping)
- `scripts/anonymize-fixture.mjs` — reusable PII-stripper for Polar exports
- `sample/build-sample-zip.mjs` — generates `public/sample-polar-export.zip` from a real export
- `fixtures/*.json` — three anonymized training-session fixtures (one large GPS, one tiny indoor, one mid-size GPS with a known teleport)
- `public/sample-polar-export.zip` — committed; the "Try with sample data" demo file (337KB, 7 sessions)
- `src/core/*` — pure conversion logic (browser- and Node-portable): types, parsePolarJson (JSON5 + reviver), polarToFit, sportMap (171 mappings), time, stats
- `src/validate/*` — round-trip + conservation + GPS-quality checks
- `src/webapp/*` — Svelte 5 wizard UI + Web Worker pipeline + StatsCard + (T20) MarketingSection
- `src/cli/*` — Node CLI: `pnpm convert` / `pnpm inspect` / `pnpm validate`
- `.github/workflows/pages.yml` — deploys main → GitHub Pages on every push
- `out/` — gitignored; contains the user's converted .fit files when `pnpm convert` runs
