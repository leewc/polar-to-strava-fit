#!/usr/bin/env node
/**
 * `pnpm validate <out-dir>` — walk a directory of `.fit` + matching
 * `.polar.json` sidecar pairs (the output of `pnpm convert`) and run the
 * shared validation checks against each pair. Pretty-prints a one-line
 * status per file and a summary footer.
 *
 * Conservative on exit codes: non-zero ONLY when a `.fit` fails to decode
 * or its required sidecar is missing/invalid. Mere conservation warnings
 * (distance Δ outside tolerance, etc.) are surfaced but do not flip the
 * exit code — the user often wants to upload them anyway.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parsePolarJson } from '../core/parsePolarJson'
import { conservationReport, decodeAndAssertStructure } from '../validate/checks'

// ANSI helpers. Disabled when stdout isn't a TTY (e.g. CI logs, redirects).
const isTty = Boolean(process.stdout.isTTY)
const wrap = (open: string, close: string) => (s: string) =>
  isTty ? `${open}${s}${close}` : s
const green = wrap('\x1b[32m', '\x1b[0m')
const yellow = wrap('\x1b[33m', '\x1b[0m')
const red = wrap('\x1b[31m', '\x1b[0m')
const dim = wrap('\x1b[2m', '\x1b[0m')

interface FileResult {
  fileName: string
  status: 'ok' | 'warned' | 'failed'
  warnings: string[]
  error?: string
}

export interface ValidateSummary {
  total: number
  ok: number
  warned: number
  failed: number
  results: FileResult[]
}

/** Walk `outDir` for every `.fit`, locate its `.polar.json` sidecar, and
 *  emit per-file results. Side-effect-only logging is in `main()`; this
 *  function is pure-ish (returns the structured summary) so it's testable
 *  without parsing stdout. */
export function runValidate(outDir: string): ValidateSummary {
  if (!statSync(outDir).isDirectory()) {
    throw new Error(`not a directory: ${outDir}`)
  }

  const fitFiles = readdirSync(outDir)
    .filter((n) => n.endsWith('.fit'))
    .sort()

  const results: FileResult[] = []

  for (const fitName of fitFiles) {
    const stem = fitName.slice(0, -'.fit'.length)
    const sidecarName = `${stem}.polar.json`
    const fitPath = join(outDir, fitName)
    const sidecarPath = join(outDir, sidecarName)

    try {
      const fitBytes = new Uint8Array(readFileSync(fitPath))
      const decoded = decodeAndAssertStructure(fitBytes)

      let sidecarText: string
      try {
        sidecarText = readFileSync(sidecarPath, 'utf8')
      } catch {
        results.push({
          fileName: fitName,
          status: 'failed',
          warnings: [],
          error: `missing sidecar: ${sidecarName}`,
        })
        printRow(fitName, 'failed', [], `missing sidecar: ${sidecarName}`)
        continue
      }

      // The sidecar is a slim subset of the original Polar session, but
      // shape-compatible enough for `conservationReport` (which only reads
      // `durationMillis` and `distanceMeters`). Reuse the same parser as
      // the conversion path so behavior stays consistent.
      const polar = parsePolarJson(sidecarText)
      // No expectedSport assertion at the CLI layer: convert-time already
      // checked sport mapping, and the sidecar drops the original exercises
      // in any case. Pass null per the task contract.
      const report = conservationReport(polar, decoded, null)

      const status: FileResult['status'] = report.ok ? 'ok' : 'warned'
      results.push({ fileName: fitName, status, warnings: report.warnings })
      printRow(fitName, status, report.warnings)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ fileName: fitName, status: 'failed', warnings: [], error: msg })
      printRow(fitName, 'failed', [], msg)
    }
  }

  const ok = results.filter((r) => r.status === 'ok').length
  const warned = results.filter((r) => r.status === 'warned').length
  const failed = results.filter((r) => r.status === 'failed').length
  const total = results.length

  // Summary line. Exact phrasing matters — tests assert against it.
  const summary = `${total} files: ${ok} ok, ${warned} warned, ${failed} failed`
  console.log('')
  console.log(summary)

  return { total, ok, warned, failed, results }
}

function printRow(
  fileName: string,
  status: FileResult['status'],
  warnings: string[],
  error?: string,
): void {
  if (status === 'ok') {
    console.log(`${green('✓')} ${fileName}`)
    return
  }
  if (status === 'warned') {
    const tail = warnings.length > 0 ? ` ${dim('-')} ${warnings.join('; ')}` : ''
    console.log(`${yellow('⚠')} ${fileName}${tail}`)
    return
  }
  // failed
  const tail = error ? ` ${dim('-')} ${error}` : ''
  console.log(`${red('✗')} ${fileName}${tail}`)
}

/** Subcommand entrypoint usable by the standalone script (`tsx validate.ts ...`)
 *  AND by the bundled `polar-to-strava-fit validate ...` dispatcher. Argv is
 *  the tail (everything after the subcommand name). */
export function runValidateCli(argv: readonly string[], usage: string): number {
  const [outDir] = argv
  if (!outDir) {
    process.stderr.write(`${usage}\n`)
    return 2
  }
  const summary = runValidate(outDir)
  // Per task spec: exit 0 if no decode failures. Warnings don't flip exit code.
  return summary.failed > 0 ? 1 : 0
}

function main(): number {
  return runValidateCli(process.argv.slice(2), 'Usage: pnpm validate <out-dir>')
}

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

// See convert.ts for the long version: bundling defeats the bare
// `invokedDirectly()` guard, so we also check argv[1]'s basename.
function invokedAsThisScript(): boolean {
  if (!invokedDirectly()) return false
  const entry = process.argv[1] ?? ''
  return /(^|[\\/])validate\.[mc]?[tj]s$/.test(entry)
}
if (invokedAsThisScript()) {
  process.exit(main())
}
