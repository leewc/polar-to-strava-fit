// @vitest-environment happy-dom
/**
 * pipeline.test.ts — unit tests for the browser pipeline.
 *
 * We synthesize a small in-memory ZIP using `fflate.zipSync` (mirroring how
 * Polar's bulk export packages sessions), wrap it as a `File`, then iterate
 * the pipeline's event generator and assert the event sequence + the final
 * output blob's contents. The happy-dom env supplies `Blob`, `File`, and
 * `Blob.prototype.arrayBuffer`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'

import { runPipeline, type PipelineEvent } from './pipeline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../../fixtures')

function readFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8')
}

/** Build a ZIP that looks like a Polar bulk export: training-session-*.json
 *  files inside an outer folder, plus an unrelated metadata file the
 *  pipeline must ignore. Returns a `File` wrapping the ZIP bytes. */
function buildPolarLikeZip(opts: {
  sessions: Array<{ name: string; text: string }>
  noiseFiles?: Array<{ name: string; text: string }>
}): File {
  const root = 'polar-export'
  const entries: Record<string, Uint8Array> = {}
  for (const s of opts.sessions) {
    entries[`${root}/${s.name}`] = strToU8(s.text)
  }
  for (const n of opts.noiseFiles ?? []) {
    entries[`${root}/${n.name}`] = strToU8(n.text)
  }
  const zipped = zipSync(entries)
  // Copy into a plain ArrayBuffer so the `File` constructor accepts it under
  // strict `BlobPart` typing (lib.dom requires `ArrayBufferView<ArrayBuffer>`,
  // not the looser `ArrayBufferLike` modern Uint8Array carries).
  const ab = new ArrayBuffer(zipped.byteLength)
  new Uint8Array(ab).set(zipped)
  return new File([ab], 'polar-export.zip', { type: 'application/zip' })
}

async function collect(events: AsyncIterable<PipelineEvent>): Promise<PipelineEvent[]> {
  const out: PipelineEvent[] = []
  for await (const ev of events) out.push(ev)
  return out
}

describe('webapp/pipeline', () => {
  it('emits manifest → session-start/done* → all-done for a happy-path ZIP', async () => {
    const indoor = readFixture('indoor-tiny.json')
    const file = buildPolarLikeZip({
      sessions: [
        { name: 'training-session-2022-06-18T18-50-02-7520219187.json', text: indoor },
      ],
      noiseFiles: [{ name: 'account-information.json', text: '{"x":1}' }],
    })

    const events = await collect(runPipeline(file))

    // Sequence: manifest first, all-done last.
    expect(events[0].kind).toBe('manifest')
    expect(events[events.length - 1].kind).toBe('all-done')

    // Manifest excludes the noise file.
    const manifest = events[0]
    if (manifest.kind !== 'manifest') throw new Error('expected manifest event')
    expect(manifest.sessions).toHaveLength(1)
    expect(manifest.sessions[0].sessionName).toBe('Other indoor')
    expect(manifest.sessions[0].hasGps).toBe(false)
    expect(manifest.sessions[0].durationSec).toBeCloseTo(2071.005, 2)

    // Per-session start/done pair.
    const starts = events.filter((e) => e.kind === 'session-start')
    const dones = events.filter((e) => e.kind === 'session-done')
    expect(starts).toHaveLength(1)
    expect(dones).toHaveLength(1)

    const done = dones[0]
    if (done.kind !== 'session-done') throw new Error('typeguard')
    expect(done.bytes).toBeInstanceOf(Uint8Array)
    expect(done.bytes.length).toBeGreaterThan(100)
    expect(done.report.recordCount).toBeGreaterThan(0)

    const allDone = events[events.length - 1]
    if (allDone.kind !== 'all-done') throw new Error('typeguard')
    expect(allDone.sessionCount).toBe(1)
    expect(allDone.outFitBlob).toBeInstanceOf(Blob)

    // The output ZIP must contain exactly one .fit file whose bytes are
    // identical to those reported in `session-done`.
    const outBytes = new Uint8Array(await allDone.outFitBlob.arrayBuffer())
    const outEntries = unzipSync(outBytes)
    const outNames = Object.keys(outEntries)
    expect(outNames).toHaveLength(1)
    expect(outNames[0]).toMatch(/\.fit$/)
    expect(outNames[0]).toMatch(/Other-indoor/)
    expect(outEntries[outNames[0]]).toEqual(done.bytes)
  })

  it('handles multiple sessions and counts warnings', async () => {
    const indoor = readFixture('indoor-tiny.json')
    const recent = readFixture('running-recent.json')
    const file = buildPolarLikeZip({
      sessions: [
        { name: 'training-session-a.json', text: indoor },
        { name: 'training-session-b.json', text: recent },
      ],
    })

    const events = await collect(runPipeline(file))
    const allDone = events[events.length - 1]
    if (allDone.kind !== 'all-done') throw new Error('typeguard')
    expect(allDone.sessionCount).toBe(2)
    // No warnings expected for clean fixtures (within 1% / 1s tolerance).
    expect(allDone.warningCount).toBe(0)

    const dones = events.filter((e) => e.kind === 'session-done')
    expect(dones).toHaveLength(2)
  })

  it('emits session-error for an unparseable session and continues to all-done', async () => {
    const valid = readFixture('indoor-tiny.json')
    const file = buildPolarLikeZip({
      sessions: [
        { name: 'training-session-broken.json', text: '{not json at all' },
        { name: 'training-session-ok.json', text: valid },
      ],
    })

    const events = await collect(runPipeline(file))
    const errors = events.filter((e) => e.kind === 'session-error')
    expect(errors).toHaveLength(1)
    if (errors[0].kind !== 'session-error') throw new Error('typeguard')
    expect(errors[0].fileName).toMatch(/training-session-broken\.json$/)
    expect(errors[0].error.length).toBeGreaterThan(0)

    const allDone = events[events.length - 1]
    if (allDone.kind !== 'all-done') throw new Error('typeguard')
    expect(allDone.sessionCount).toBe(1) // Only the valid one made it.
  })

  it('produces an empty all-done blob when ZIP has no training sessions', async () => {
    const file = buildPolarLikeZip({
      sessions: [],
      noiseFiles: [{ name: 'account-information.json', text: '{}' }],
    })
    const events = await collect(runPipeline(file))
    const manifest = events[0]
    if (manifest.kind !== 'manifest') throw new Error('typeguard')
    expect(manifest.sessions).toHaveLength(0)

    const allDone = events[events.length - 1]
    if (allDone.kind !== 'all-done') throw new Error('typeguard')
    expect(allDone.sessionCount).toBe(0)
    expect(allDone.warningCount).toBe(0)
  })
})
