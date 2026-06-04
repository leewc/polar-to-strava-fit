#!/usr/bin/env node
/**
 * `pnpm convert <zip-path> <out-dir>` — convert a Polar bulk-export ZIP into
 * one Strava-ready `.fit` per `training-session-*.json` plus a slim Polar
 * sidecar JSON (sample arrays + waypoints stripped — those live in the FIT).
 *
 * Pure-converter glue only. All format work lives in `@core/polarToFit`;
 * this module is the file-system / ZIP-walking shell around it.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import AdmZip from 'adm-zip'

import { parsePolarJson } from '../core/parsePolarJson'
import { polarToFit } from '../core/polarToFit'
import { lookupSport } from '../core/sportMap'
import { polarLocalToUtcDate } from '../core/time'
import type { PolarExercise, PolarSession } from '../core/types'
import { decodeAndAssertStructure } from '../validate/checks'

interface SidecarExercise {
  identifier?: PolarExercise['identifier']
  startTime?: string
  stopTime?: string
  durationMillis?: number
  distanceMeters?: number
  sport?: PolarExercise['sport']
  zones?: unknown
  [extra: string]: unknown
}

interface Sidecar {
  identifier: PolarSession['identifier']
  name: string
  startTime: string
  stopTime: string
  durationMillis: number
  distanceMeters?: number
  hrAvg?: number
  hrMax?: number
  calories?: number
  sport: PolarSession['sport']
  application?: PolarSession['application']
  product?: PolarSession['product']
  physicalInformation?: unknown
  trainingBenefit?: unknown
  recoveryTimeMillis?: unknown
  fatPercentage?: unknown
  zones?: unknown
  exercises?: SidecarExercise[]
}

/** Build the sidecar JSON: a small subset of the Polar session. The big
 *  arrays (`samples`, `routes`) are dropped because they are already encoded
 *  in the FIT. We do keep a per-exercise stub with metadata + zones because
 *  the time-in-zone breakdown is genuinely Polar-only data we want to keep
 *  for future tools. */
function buildSidecar(session: PolarSession): Sidecar {
  const sidecar: Sidecar = {
    identifier: session.identifier,
    name: session.name,
    startTime: session.startTime,
    stopTime: session.stopTime,
    durationMillis: session.durationMillis,
    distanceMeters: session.distanceMeters,
    hrAvg: session.hrAvg,
    hrMax: session.hrMax,
    calories: session.calories,
    sport: session.sport,
    application: session.application,
    product: session.product,
  }

  // Pass through any of these top-level Polar-only fields when present.
  const passthrough = [
    'physicalInformation',
    'trainingBenefit',
    'recoveryTimeMillis',
    'fatPercentage',
    'zones',
  ] as const
  const sessionRecord = session as unknown as Record<string, unknown>
  const sidecarRecord = sidecar as unknown as Record<string, unknown>
  for (const key of passthrough) {
    if (sessionRecord[key] !== undefined) {
      sidecarRecord[key] = sessionRecord[key]
    }
  }

  // Per-exercise stubs: metadata + zones, but NOT samples/routes (those are
  // in the FIT) and not other large blobs we don't need.
  if (Array.isArray(session.exercises)) {
    sidecar.exercises = session.exercises.map((ex) => {
      const stub: SidecarExercise = {
        identifier: ex.identifier,
        startTime: ex.startTime,
        stopTime: ex.stopTime,
        durationMillis: ex.durationMillis,
        distanceMeters: ex.distanceMeters,
        sport: ex.sport,
      }
      const exRecord = ex as unknown as Record<string, unknown>
      if (exRecord['zones'] !== undefined) {
        stub.zones = exRecord['zones']
      }
      return stub
    })
  }

  return sidecar
}

/** Convert a Polar Flow display label into a filename-safe sport tag.
 *  "Running" → "Running"; "Other indoor" → "Other-indoor". */
function sportLabel(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** UTC ISO timestamp scrubbed for a filename: drop `:` and trailing `.NNN`. */
function startTimeForFilename(session: PolarSession): string {
  const utc = polarLocalToUtcDate(session.startTime, session.timezoneOffsetMinutes)
  return utc.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')
}

function shortId(session: PolarSession): string {
  return session.identifier.id.slice(0, 8)
}

function buildFilename(session: PolarSession): string {
  return `${startTimeForFilename(session)}-${sportLabel(session.name)}-${shortId(session)}`
}

interface ConvertResult {
  /** True if at least one session failed; the CLI will exit non-zero. */
  failed: boolean
  count: number
  fallbackCount: number
}

/** Walk the ZIP, convert each `training-session-*.json` entry, write outputs.
 *  Pure data-flow except for the I/O at the edges (logging + writeFile). */
export function runConvert(zipPath: string, outDir: string): ConvertResult {
  mkdirSync(outDir, { recursive: true })

  const zip = new AdmZip(zipPath)
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && /(^|\/)training-session-[^/]+\.json$/.test(e.entryName))

  let failed = false
  let fallbackCount = 0
  let count = 0

  for (const entry of entries) {
    let stem = ''
    let sessionId = '<unparsed>'
    try {
      const text = entry.getData().toString('utf8')
      const session = parsePolarJson(text)
      sessionId = session.identifier.id
      stem = buildFilename(session)

      const fitBytes = polarToFit(session)
      const fitPath = join(outDir, `${stem}.fit`)
      writeFileSync(fitPath, fitBytes)

      const sidecarPath = join(outDir, `${stem}.polar.json`)
      writeFileSync(sidecarPath, JSON.stringify(buildSidecar(session), null, 2))

      const lookup = lookupSport(session.name)
      if (lookup.isFallback) fallbackCount += 1

      const decoded = decodeAndAssertStructure(fitBytes)
      const sport = decoded.sport ?? '?'
      const subSport = decoded.subSport ?? '?'
      console.log(
        `wrote ${stem}.fit (${decoded.recordCount} records, sport=${sport}/${subSport}, ${fitBytes.byteLength} bytes)`,
      )
      count += 1
    } catch (err) {
      failed = true
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`FAILED ${entry.entryName} (id=${sessionId}): ${msg}`)
    }
  }

  console.log(`${count} sessions converted, ${fallbackCount} sport-mapping fallbacks`)
  return { failed, count, fallbackCount }
}

/** Subcommand entrypoint usable by the standalone script (`tsx convert.ts ...`)
 *  AND by the bundled `polar-to-strava-fit convert ...` dispatcher in
 *  `src/cli/bin.ts`. Argv is the tail (everything after the subcommand name);
 *  exit code semantics match the script form: 2 on usage error, 1 on
 *  conversion failure, 0 on success. */
export function runConvertCli(argv: readonly string[], usage: string): number {
  const [zipPath, outDir] = argv
  if (!zipPath || !outDir) {
    process.stderr.write(`${usage}\n`)
    return 2
  }
  const result = runConvert(zipPath, outDir)
  return result.failed ? 1 : 0
}

function main(): number {
  return runConvertCli(process.argv.slice(2), 'Usage: pnpm convert <zip-path> <out-dir>')
}

// Run-as-script check: only execute `main` when invoked directly (not when
// imported by tests). Compare resolved absolute paths to dodge symlink issues
// (e.g. macOS `/tmp` ↔ `/private/tmp`).
function invokedDirectly(): boolean {
  if (typeof process === 'undefined' || !process.argv[1]) return false
  try {
    const here = realpathSync(fileURLToPath(import.meta.url))
    const entry = realpathSync(process.argv[1])
    return here === entry
  } catch {
    return false
  }
}

// The published `polar-to-strava-fit` bin bundles all three CLI modules
// together; tsup rewrites `import.meta.url` so EVERY module's
// `invokedDirectly()` would return true and race their `main`s. Add a
// basename guard: this script self-runs only if argv[1] looks like
// `convert.ts`/`convert.js`/`convert.mjs` — never the bundled bin.
function invokedAsThisScript(): boolean {
  if (!invokedDirectly()) return false
  const entry = process.argv[1] ?? ''
  return /(^|[\\/])convert\.[mc]?[tj]s$/.test(entry)
}
if (invokedAsThisScript()) {
  process.exit(main())
}
