/**
 * Browser pipeline: orchestrates Polar bulk-export ZIP → per-session FIT
 * conversion → validation → final ZIP-of-FITs blob, emitting structured
 * progress events as it goes.
 *
 * Pure-ish: no DOM access, no `window` references, no fetch. Takes a `File`
 * (which is a Blob with a name) and uses `fflate` for in-memory ZIP I/O.
 * Runs identically in the main thread or a Web Worker — see `worker.ts`.
 *
 * The pipeline is intentionally a single async generator so the caller can
 * stream events. The Web Worker wrapper just relays each event over
 * `postMessage`. A non-worker test harness (`pipeline.test.ts`) iterates the
 * generator directly to make assertions.
 */

import { Profile } from '@garmin/fitsdk'
import { unzipSync, zipSync, strFromU8 } from 'fflate'

import { parsePolarJson } from '@core/parsePolarJson'
import { polarToFit } from '@core/polarToFit'
import { lookupSport } from '@core/sportMap'
import { polarLocalToUtcDate } from '@core/time'
import type { PolarSession } from '@core/types'
import { conservationReport, decodeAndAssertStructure } from '@validate/checks'
import type { ValidationReport } from '@validate/checks'

/** A single session entry surfaced in the manifest before conversion runs. */
export interface ManifestEntry {
  /** ZIP entry path, e.g. `"training-session-2025-08-16T17-12-22.json"`. */
  fileName: string
  /** Polar Flow display name, e.g. `"Running"`, `"Other indoor"`. */
  sessionName: string
  /** Session start time as the original local civil string from Polar. */
  startTime: string
  /** Resolved FIT sport label (or "generic" fallback). */
  sportLabel: string
  /** Session duration in seconds (durationMillis / 1000). */
  durationSec: number
  /** Whether the source has any GPS waypoints. */
  hasGps: boolean
}

/** Per-session output filename inside the final ZIP. Mirrors the CLI scheme. */
function buildFitFilename(session: PolarSession): string {
  const utc = polarLocalToUtcDate(session.startTime, session.timezoneOffsetMinutes)
  const stamp = utc.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')
  const sport = session.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const shortId = session.identifier.id.slice(0, 8)
  return `${stamp}-${sport}-${shortId}.fit`
}

/** A streamed event from the pipeline. Discriminated by `kind`. */
export type PipelineEvent =
  | { kind: 'manifest'; sessions: ManifestEntry[] }
  | { kind: 'session-start'; fileName: string }
  | {
      kind: 'session-done'
      fileName: string
      bytes: Uint8Array
      report: ValidationReport
    }
  | { kind: 'session-error'; fileName: string; error: string }
  | {
      kind: 'all-done'
      outFitBlob: Blob
      sessionCount: number
      warningCount: number
    }

/** Read a `Blob` (or `File`) into a `Uint8Array` — works in browsers and
 *  jsdom/happy-dom test environments. Vitest's happy-dom env exposes
 *  `Blob.prototype.arrayBuffer`. */
async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}

/** Copy a `Uint8Array<ArrayBufferLike>` into a fresh `ArrayBuffer`-backed
 *  view so it satisfies the strict `BlobPart` typing in modern lib.dom. The
 *  copy is one allocation per output ZIP — not on a hot path. */
function toAB(u: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u.byteLength)
  new Uint8Array(ab).set(u)
  return ab
}

/** Match Polar bulk-export ZIP entry names. The ZIP nests entries under a
 *  top-level folder, e.g. `polar-user-data-export.../training-session-XYZ.json`,
 *  so we match on the basename. */
function isTrainingSessionEntry(path: string): boolean {
  return /(^|\/)training-session-[^/]+\.json$/i.test(path)
}

/** Build the manifest preview from the unzipped entries — does not run the
 *  expensive convert step. Throws nothing: a malformed entry surfaces as a
 *  manifest row whose `sportLabel` is `'(parse error)'` and the session
 *  conversion will then emit a `session-error` event when its turn comes. */
function buildManifest(entries: Record<string, Uint8Array>): {
  manifest: ManifestEntry[]
  sessions: Array<{ fileName: string; session: PolarSession | null; parseError?: string }>
} {
  const fileNames = Object.keys(entries).filter(isTrainingSessionEntry).sort()
  const manifest: ManifestEntry[] = []
  const sessions: Array<{
    fileName: string
    session: PolarSession | null
    parseError?: string
  }> = []

  for (const fileName of fileNames) {
    const bytes = entries[fileName]
    let session: PolarSession | null = null
    let parseError: string | undefined
    try {
      session = parsePolarJson(strFromU8(bytes))
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
    }

    if (session) {
      const lookup = lookupSport(session.name)
      const hasGps = Boolean(
        session.exercises[0]?.routes &&
          'route' in session.exercises[0].routes &&
          (session.exercises[0].routes.route?.wayPoints?.length ?? 0) > 0,
      )
      manifest.push({
        fileName,
        sessionName: session.name,
        startTime: session.startTime,
        sportLabel: lookup.isFallback
          ? 'generic'
          : numberToFitSport(lookup.sport, lookup.subSport),
        durationSec: session.durationMillis / 1000,
        hasGps,
      })
      sessions.push({ fileName, session })
    } else {
      manifest.push({
        fileName,
        sessionName: '(unparsed)',
        startTime: '',
        sportLabel: '(parse error)',
        durationSec: 0,
        hasGps: false,
      })
      sessions.push({ fileName, session: null, parseError })
    }
  }

  return { manifest, sessions }
}

/** Tiny helper: render the FIT sport+subSport pair as a slash-joined label
 *  for the manifest UI. The numeric → string lookup happens in @garmin/fitsdk
 *  inside polarToFit; here we just want a human-readable summary so we
 *  reuse the lookup result's numeric values directly. */
function numberToFitSport(sport: number, subSport?: number): string {
  if (subSport !== undefined && subSport !== 0) return `sport=${sport}/sub=${subSport}`
  return `sport=${sport}`
}

/** Run the full pipeline against `file`, yielding events. The caller is
 *  responsible for forwarding events to wherever they need to go. */
export async function* runPipeline(file: Blob): AsyncGenerator<PipelineEvent, void, void> {
  const zipBytes = await blobToBytes(file)
  const entries = unzipSync(zipBytes)

  const { manifest, sessions } = buildManifest(entries)

  yield { kind: 'manifest', sessions: manifest }

  const fitEntries: Record<string, Uint8Array> = {}
  let warningCount = 0
  let sessionCount = 0

  for (const item of sessions) {
    yield { kind: 'session-start', fileName: item.fileName }

    if (!item.session) {
      yield {
        kind: 'session-error',
        fileName: item.fileName,
        error: item.parseError ?? 'parse failed',
      }
      continue
    }

    try {
      const session = item.session
      const bytes = polarToFit(session)
      const decoded = decodeAndAssertStructure(bytes)
      const lookup = lookupSport(session.name)
      const expected = lookup.isFallback
        ? null
        : {
            sport: numberToSportName(lookup.sport),
            ...(lookup.subSport !== undefined && {
              subSport: numberToSubSportName(lookup.subSport),
            }),
          }
      const report = conservationReport(session, decoded, expected)

      const outName = buildFitFilename(session)
      fitEntries[outName] = bytes
      sessionCount += 1
      if (!report.ok) warningCount += 1

      yield {
        kind: 'session-done',
        fileName: item.fileName,
        bytes,
        report,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      yield { kind: 'session-error', fileName: item.fileName, error: msg }
    }
  }

  // Bundle every produced .fit into one ZIP. fflate's `zipSync` is the cheap
  // synchronous variant — for our scale (~30 files, single-MB total) the
  // async/streaming variant isn't worth the API complexity.
  const zipped = zipSync(fitEntries)
  // `Blob`'s `BlobPart` requires an `ArrayBufferView<ArrayBuffer>` (not the
  // looser `ArrayBufferLike` modern lib.dom carries on `Uint8Array`). Wrap
  // through the underlying buffer to drop the Shared* possibility.
  const outFitBlob = new Blob([toAB(zipped)], {
    type: 'application/zip',
  })

  yield {
    kind: 'all-done',
    outFitBlob,
    sessionCount,
    warningCount,
  }
}

/** Convert a Profile.Sport enum number → string. The decoder normalizes
 *  these to camelCase strings, so the conservationReport sport check needs
 *  the same form. */
function numberToSportName(n: number): string {
  const name = (Profile.types.sport as Record<number, string>)[n]
  return name ?? 'generic'
}

function numberToSubSportName(n: number): string {
  const name = (Profile.types.subSport as Record<number, string>)[n]
  return name ?? 'generic'
}
