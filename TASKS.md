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

## In progress / pending

| # | Task | Status | Notes |
|---|---|---|---|
| 11 | T12: deploy to GitHub Pages + write README | 🟢 | Live at https://leewc.com/polar-to-strava-fit/ (custom CNAME, Cloudflare-fronted). leewc.github.io/polar-to-strava-fit/ 301-redirects to it. README polish folded into T16. |
| 13 | T13: animations + validation info pane | ⚪ | Post-T12 polish: spinner during convert, pulse during validate, ℹ️ Strava-warnings explainer pane, per-row gpsReport tooltip |
| 14 | T14: stats dashboard (Best Efforts, totals) | ⚪ | Post-conversion summary mirroring Strava's Best Efforts widget (400m, 1/2mi, 1K, …, Half-Marathon) plus activity/distance/time/elev totals |
| 15 | T15: bundle a sample/demo ZIP for one-click try | ⚪ | Ship 5 runs + 2 indoor workouts, fully anonymized via `scripts/anonymize-fixture.mjs`. "Try with sample data" CTA on the drop zone. Ships from `public/` so Vite bundles it. |
| 16 | T16: marketing + how-to-procure-the-zip docs | ⚪ | Turn README into a landing page: hook, screenshots, privacy claim, step-by-step "how to get your Polar export ZIP" with screenshots, FAQ, deploy URL CTA. |

## Mid-flight discoveries (logged in `PLAN.md` Decisions)

- **2026-06-02** — Polar SPEED stream is km/h, FIT enhancedSpeed is m/s (off by 3.6×). Caught by Strava "may be in a vehicle" flag during T6.5. Fix: `36542eb`.
- **2026-06-02** — One real session had a 4.5 km GPS teleport in 1 second. Strava flagged "GPS had a bad day". Converter is faithful; source data is glitched. Spawned T6.6 (detection + optional crop).
- **2026-06-02** — Wave-2 worktree-isolation merge: T8-A, T9-A, T10-A all installed/wrote shadcn primitives in their own worktrees. T9-A had the most complete (real shadcn-svelte CLI output); T8-A & T10-A's stubs were discarded in favor of T9-A's during the integration commit (`d837804`). Lesson: pin shadcn install to a single agent in future fan-outs.
- **2026-06-02** — Svelte 5 `$effect` reactive-loop bug in App.svelte's `perFileUrls` URL revoker. Reading `perFileUrls` inside its own effect re-triggered it. Fix: `untrack()` the read. (`5fe8122`)

## Artifacts in this repo

- `PLAN.md` — full implementation plan (decomposition, decisions log, orchestration playbook)
- `RESEARCH.md` — research notes on FIT format, Polar→FIT sport mapping, `@garmin/fitsdk` audit
- `TASKS.md` — this file
- `WORK_LOG.md` — per-task agent telemetry (tokens, tool uses, durations) + session cost
- `scripts/anonymize-fixture.mjs` — reusable PII-stripper for Polar exports
- `fixtures/*.json` — three anonymized training-session fixtures (one large GPS, one tiny indoor, one mid-size GPS with a known teleport)
- `src/core/*` — pure conversion logic (browser- and Node-portable)
- `src/validate/*` — round-trip + conservation + GPS-quality checks
- `src/webapp/*` — Svelte 5 wizard UI + Web Worker pipeline
- `src/cli/*` — Node CLI: `pnpm convert` / `pnpm inspect` / `pnpm validate`
- `out/` — gitignored; contains the user's converted .fit files when `pnpm convert` runs
