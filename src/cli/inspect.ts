#!/usr/bin/env node
/**
 * `pnpm inspect <fit-file> [--summary]` — decode a FIT file with
 * `@garmin/fitsdk`'s Decoder and pretty-print the messages as JSON.
 *
 * The FIT format is a binary protocol; debugging a converter requires being
 * able to look at what the encoder produced. This is the eyeball tool. By
 * default it dumps the entire decoded message tree (one section per message
 * group: `fileIdMesgs`, `recordMesgs`, `sessionMesgs`, `activityMesgs`, …).
 * `--summary` collapses to a one-line count per group plus the first and last
 * record message, which is useful for triaging large activity files where the
 * full record stream is thousands of lines of noise.
 *
 * Exits 0 on success, 1 if the file is unreadable or fails the SDK's CRC
 * check, 2 on a usage error.
 */

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Decoder, Stream } from '@garmin/fitsdk'

interface InspectOptions {
  fitPath: string
  summary: boolean
}

interface InspectResult {
  /** Stable JSON-stringifiable object: `messages` for full mode, or a summary
   *  object for `--summary` mode. Caller serializes — keeping it pure makes
   *  testing the shape painless without spawning a subprocess. */
  output: unknown
}

/**
 * Parse argv tail (i.e. `process.argv.slice(2)`) into options. Throws with a
 * usage-friendly message on malformed input; the CLI shell catches and exits.
 */
export function parseArgs(argv: readonly string[]): InspectOptions {
  let fitPath: string | undefined
  let summary = false
  for (const arg of argv) {
    if (arg === '--summary') {
      summary = true
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`unknown flag: ${arg}`)
    }
    if (fitPath !== undefined) {
      throw new Error(`unexpected extra argument: ${arg}`)
    }
    fitPath = arg
  }
  if (!fitPath) throw new Error('missing <fit-file> argument')
  return { fitPath, summary }
}

/**
 * Pure inspector: read FIT bytes, decode with the SDK, return either the full
 * message tree or a summary (per-group counts + first/last record).
 *
 * Throws on CRC failure or decoder errors so the CLI shell can map to exit 1.
 */
export function inspectFit(bytes: Uint8Array, options: { summary: boolean }): InspectResult {
  const stream = Stream.fromByteArray(bytes)
  const decoder = new Decoder(stream)
  if (!decoder.checkIntegrity()) {
    throw new Error('FIT file failed CRC integrity check')
  }
  const result = decoder.read()
  if (result.errors && result.errors.length > 0) {
    throw new Error(
      `FIT decoder reported ${result.errors.length} error(s): ${String(result.errors[0])}`,
    )
  }

  const messages = result.messages as Record<string, unknown>

  if (!options.summary) {
    return { output: messages }
  }

  // Summary mode: per-group count + first/last record message.
  const counts: Record<string, number> = {}
  for (const [key, value] of Object.entries(messages)) {
    counts[key] = Array.isArray(value) ? value.length : 1
  }
  const records = (messages['recordMesgs'] ?? []) as unknown[]
  const firstRecord = records.length > 0 ? records[0] : null
  const lastRecord = records.length > 0 ? records[records.length - 1] : null

  return {
    output: {
      counts,
      firstRecord,
      lastRecord,
    },
  }
}

function main(argv: readonly string[]): number {
  let opts: InspectOptions
  try {
    opts = parseArgs(argv)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`${msg}\n`)
    process.stderr.write('Usage: pnpm inspect <fit-file> [--summary]\n')
    return 2
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(opts.fitPath))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`failed to read ${opts.fitPath}: ${msg}\n`)
    return 1
  }

  let result: InspectResult
  try {
    result = inspectFit(bytes, { summary: opts.summary })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`${msg}\n`)
    return 1
  }

  // Emit the dump as one stdout write. The CLI shell below sets
  // `process.exitCode` instead of calling `process.exit`, so a large dump
  // (173 KB+ for indoor-tiny) gets fully drained to the OS pipe buffer
  // before the event loop terminates. Calling `process.exit` would truncate
  // at 64 KB on macOS.
  process.stdout.write(`${JSON.stringify(result.output, jsonReplacer, 2)}\n`)
  return 0
}

/**
 * `JSON.stringify` replacer that turns Date objects into ISO strings (the
 * fitsdk decoder emits real `Date`s for timestamp fields) and converts any
 * stray `BigInt`s to a string with an `n` suffix so they round-trip visibly.
 * Without this, Date instances stringify to `{}` and BigInts throw.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return `${value.toString()}n`
  return value
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

if (invokedDirectly()) {
  const code = main(process.argv.slice(2))
  // Wait for stdout to drain before exiting. A 173 KB write through
  // `process.stdout` (a non-blocking pipe in our test harness) can be
  // truncated to the OS pipe-buffer size (64 KB on macOS) if the process
  // exits before the kernel finishes writing. Setting `exitCode` and
  // letting the event loop drain naturally avoids both truncation and the
  // need for a manual flush.
  process.exitCode = code
}
