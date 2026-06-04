#!/usr/bin/env node
// Build a small, fully-anonymized Polar bulk-export ZIP for the public demo.
//
// Usage:
//   node scripts/build-sample-zip.mjs
//   pnpm build:sample              # the npm-script alias
//
// What this does
// --------------
//   1. Reads the user's REAL Polar export from the project root —
//      `polar-user-data-export_de647c3a-0cdf-4e0f-afcb-1a64eaa77441.zip`.
//   2. Picks 7 representative training-session-*.json entries (5 Running +
//      2 indoor). One Running entry is the May-23 fixture with the known GPS
//      teleport — keeping it in the demo ensures the "GPS-warning" UI path
//      gets exercised when someone clicks "Try with sample data".
//   3. Runs each picked session through the existing
//      `scripts/anonymize-fixture.mjs` anonymizer in-process — strips the
//      `physicalInformation` PII block and shifts GPS coordinates to the
//      mid-Pacific so the route shape is preserved but the home/work
//      location is hidden.
//   4. Packs the 7 anonymized JSONs into `public/sample-polar-export.zip`
//      using `fflate.zipSync`. Vite serves anything under `public/` verbatim
//      at build time, so the file is fetchable at
//      `/polar-to-strava-fit/sample-polar-export.zip` once deployed.
//   5. Prints a one-line summary of the bytes/entries it wrote.
//
// Important
// ---------
//   - This script runs LOCALLY on a developer's machine. It is *not* part of
//     the Vite build (the real export is gitignored and not present in CI).
//     A developer runs it ONCE to produce `public/sample-polar-export.zip`,
//     then commits the resulting ZIP. The .gitignore has a carve-out:
//         *.zip
//         !public/sample-polar-export.zip
//   - Re-running the script is deterministic — the anonymizer's coordinate
//     shift is a fixed offset, so byte-identical output makes diffs reviewable.
//   - If the source export isn't present (e.g. another developer's machine),
//     the script exits with a helpful message and a non-zero status.

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import JSON5 from 'json5'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')

// The user's real Polar export. Gitignored. The dev who runs this script
// must have a local copy at the project root. When this script runs from
// a git worktree under `.claude/worktrees/<id>/`, the export may live at
// the *original* project root rather than the worktree root — we walk up
// the parent chain and pick the first match so the script "just works"
// from a worktree too.
const EXPORT_NAME =
  'polar-user-data-export_de647c3a-0cdf-4e0f-afcb-1a64eaa77441.zip'

function findSourceZip(startDir) {
  let dir = startDir
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, EXPORT_NAME)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const SOURCE_ZIP = findSourceZip(PROJECT_ROOT)

// Where the assembled sample ZIP lands. Vite serves `public/` as static
// assets, so this file ends up at `<base>/sample-polar-export.zip`.
const OUT_PATH = resolve(PROJECT_ROOT, 'public', 'sample-polar-export.zip')

// 7 picked sessions: 5 Running + 2 indoor. The first Running entry is the
// May-23 GPS-teleport session — keeping it in the sample lets visitors see
// the GPS-warning UI in action.
const PICKS = [
  // 5 Running (one with a known GPS teleport).
  'training-session-2026-05-23T10:46:22-0e16eab9-6090-32b2-f705-0b063ea9f20b-4a80b2d7-45b0-447c-9221-c840da96947b.json', // GPS teleport
  'training-session-2025-08-16T17:12:22-0de21131-6090-0aac-e2f2-2f873ce91c2a-01cd6bd7-d465-4fcb-81f2-bfd2707262fc.json', // large GPS run
  'training-session-2025-07-03T18:03:39-0ddc720e-7090-0465-0061-d401f41fff54-7c7329c9-58c6-4653-88ae-f34a4851b554.json',
  'training-session-2026-01-22T18:19:54-0e06d24f-6090-3b43-5e0f-256cec0e3b40-3cd69a3c-93d5-433e-8e9e-7bf699e2ad82.json',
  'training-session-2025-09-20T17:00:38-0de69102-6090-17da-031f-f0be0bebfd6c-b466f422-0a0f-4e52-89c8-41455a48e6c7.json',
  // 2 indoor (no GPS, HR-only).
  'training-session-2022-06-18T18:50:02-7520219187-28039c6b-e86f-4e0e-afa8-b30d04364871.json',
  'training-session-2024-06-24T18:57:07-7907087887-e88cd93a-1572-41fa-8e01-76d959cc66d2.json',
]

// Pull the existing anonymizer's transformation logic in-process. We import
// it as a module; the script's CLI invocation path (`process.argv` parsing)
// only fires when the file is run directly, not when imported.
//
// Note: scripts/anonymize-fixture.mjs has a script-style top half that
// performs the file IO when invoked directly. To reuse just the
// transformation, we re-implement the same shift-then-strip locally — the
// shape mirrors anonymize-fixture.mjs exactly so behavior stays identical.
// Keeping a copy here (rather than refactoring the existing script to
// export named helpers) avoids changing files outside this task's scope.

const LAT_SHIFT_TO = 0.0
const LON_SHIFT_TO = -150.0

function findFirstCoord(session) {
  if (typeof session.latitude === 'number' && typeof session.longitude === 'number') {
    return { latitude: session.latitude, longitude: session.longitude }
  }
  for (const ex of session.exercises ?? []) {
    if (typeof ex.latitude === 'number' && typeof ex.longitude === 'number') {
      return { latitude: ex.latitude, longitude: ex.longitude }
    }
    const wp = ex.routes?.route?.wayPoints?.[0]
    if (wp && typeof wp.latitude === 'number') {
      return { latitude: wp.latitude, longitude: wp.longitude }
    }
  }
  return { latitude: null, longitude: null }
}

function pickShift(originalLat, originalLon) {
  return {
    lat: LAT_SHIFT_TO - originalLat,
    lon: LON_SHIFT_TO - originalLon,
  }
}

function anonymize(session) {
  const { latitude: refLat, longitude: refLon } = findFirstCoord(session)
  const shift =
    refLat != null && refLon != null
      ? pickShift(refLat, refLon)
      : { lat: 0, lon: 0 }

  delete session.physicalInformation

  if (typeof session.latitude === 'number') session.latitude += shift.lat
  if (typeof session.longitude === 'number') session.longitude += shift.lon

  for (const ex of session.exercises ?? []) {
    delete ex.physicalInformation
    if (typeof ex.latitude === 'number') ex.latitude += shift.lat
    if (typeof ex.longitude === 'number') ex.longitude += shift.lon

    const wps = ex.routes?.route?.wayPoints
    if (Array.isArray(wps)) {
      for (const wp of wps) {
        if (typeof wp.latitude === 'number') wp.latitude += shift.lat
        if (typeof wp.longitude === 'number') wp.longitude += shift.lon
      }
    }
  }

  return session
}

function main() {
  if (!SOURCE_ZIP || !existsSync(SOURCE_ZIP)) {
    console.error(
      `ERROR: source export ZIP not found.\n\n` +
        `Looked for "${EXPORT_NAME}" walking up from:\n  ${PROJECT_ROOT}\n\n` +
        `This script needs the user's real Polar bulk-export ZIP to extract\n` +
        `seven sessions and anonymize them. The ZIP is gitignored, so it\n` +
        `won't be present on a fresh clone — only on a developer machine\n` +
        `that has dropped the export at the project root.`,
    )
    process.exit(1)
  }

  console.log(`Reading source: ${SOURCE_ZIP}`)
  const zipBytes = readFileSync(SOURCE_ZIP)
  const entries = unzipSync(zipBytes)

  const outEntries = {}
  let missing = 0
  for (const pick of PICKS) {
    const bytes = entries[pick]
    if (!bytes) {
      console.error(`MISSING: ${pick}`)
      missing += 1
      continue
    }
    // Polar's bulk export represents sensor dropouts inconsistently:
    //   - the bare `NaN` token (invalid JSON, valid JSON5), and
    //   - the quoted string `"NaN"` (valid JSON but in a numeric slot).
    // Mirror `parsePolarJson` exactly: JSON5 parse with a reviver that
    // normalizes both forms to `null`, but only inside `values` arrays
    // (not in free-text fields where "NaN" might be a legitimate string).
    // After this, the converter's existing `null = dropout` handling lights
    // up correctly when polarToFit runs against the regenerated sample.
    const text = strFromU8(bytes)
    const session = JSON5.parse(text, (key, value) => {
      if (key === 'values' && Array.isArray(value)) {
        return value.map((v) =>
          v === 'NaN' || (typeof v === 'number' && Number.isNaN(v)) ? null : v,
        )
      }
      return value
    })
    const anon = anonymize(session)
    outEntries[pick] = strToU8(JSON.stringify(anon, null, 2))
  }

  if (missing > 0) {
    console.error(
      `ERROR: ${missing} of ${PICKS.length} picks were missing from the source ZIP.`,
    )
    process.exit(2)
  }

  const zipped = zipSync(outEntries)
  writeFileSync(OUT_PATH, zipped)

  console.log(
    `wrote public/sample-polar-export.zip (${zipped.byteLength} bytes, ${
      Object.keys(outEntries).length
    } entries)`,
  )
}

main()
