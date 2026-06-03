// @vitest-environment happy-dom
/**
 * sample-zip.test.ts — smoke-test the bundled "Try with sample data" ZIP.
 *
 * The sample ZIP is generated locally by `pnpm build:sample` (which reads
 * the user's real Polar export and emits an anonymized 7-session subset to
 * `public/sample-polar-export.zip`). The file is committed so deploys ship
 * it, but it's only present in repos where a developer has run the
 * generator. CI clones without the source export will not see it, so this
 * test soft-skips when the file is missing — staying green for everyone
 * while still catching regressions on developer machines and in deploys.
 *
 * What we assert when the file IS present:
 *   - The file parses as a Polar-bulk-export-shaped ZIP (entries match
 *     `training-session-*.json`).
 *   - Running the existing `runPipeline` against it emits 7 successful
 *     `session-done` events (5 Running + 2 indoor — see PLAN T15) and one
 *     `all-done` with `sessionCount === 7`.
 *
 * This catches the most likely real bugs:
 *   - The script wrote a malformed/corrupt ZIP.
 *   - One of the 7 picks wasn't a parseable Polar session anymore.
 *   - The anonymizer mutation broke the session in a way that crashes
 *     `polarToFit` or `decodeAndAssertStructure`.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { runPipeline, type PipelineEvent } from './pipeline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SAMPLE_ZIP = resolve(__dirname, '../../public/sample-polar-export.zip')

describe('webapp/sample-zip', () => {
  // Use `it.skipIf(!exists)` so machines without the generated sample (e.g.
  // CI on a fresh checkout) don't fail the suite. The PASS branch only runs
  // where the dev has built the sample locally or where the deployed repo
  // ships it.
  const exists = existsSync(SAMPLE_ZIP)

  it.skipIf(!exists)(
    'pipeline produces ~7 .fit files from the bundled sample',
    async () => {
      const bytes = readFileSync(SAMPLE_ZIP)
      // Copy into a fresh ArrayBuffer so the `File` constructor accepts it
      // under strict `BlobPart` typing — the same pattern pipeline.test.ts
      // uses for synthetic ZIPs.
      const ab = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(ab).set(bytes)
      const file = new File([ab], 'sample-polar-export.zip', {
        type: 'application/zip',
      })

      const events: PipelineEvent[] = []
      for await (const ev of runPipeline(file)) events.push(ev)

      // First event is the manifest; last is all-done.
      const manifest = events[0]
      if (manifest.kind !== 'manifest') {
        throw new Error(`expected first event kind=manifest, got ${manifest.kind}`)
      }
      expect(manifest.sessions).toHaveLength(7)

      const dones = events.filter((e) => e.kind === 'session-done')
      const errors = events.filter((e) => e.kind === 'session-error')
      const errorMessages = errors
        .map((e) => (e.kind === 'session-error' ? `${e.fileName}: ${e.error}` : ''))
        .join('\n')
      expect(errors, `errors:\n${errorMessages}`).toHaveLength(0)
      expect(dones).toHaveLength(7)

      const allDone = events[events.length - 1]
      if (allDone.kind !== 'all-done') {
        throw new Error(`expected last event kind=all-done, got ${allDone.kind}`)
      }
      expect(allDone.sessionCount).toBe(7)
      // The May-23 GPS-teleport fixture is one of the picks (see PLAN T15)
      // — confirm the warning UI path is exercised by the demo data.
      expect(allDone.warningCount).toBeGreaterThanOrEqual(1)
    },
  )

  it('always-passing presence note (so the suite reports the gate either way)', () => {
    // Cheap assertion that documents the conditional in the test report:
    // when `exists` is false, the smoke test above is skipped; this keeps
    // the file from being a no-op-shaped test file.
    expect(typeof exists).toBe('boolean')
  })
})
