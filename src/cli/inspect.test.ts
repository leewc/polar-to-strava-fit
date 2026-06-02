import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parsePolarJson } from '../core/parsePolarJson'
import { polarToFit } from '../core/polarToFit'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// This file lives at <repo>/src/cli/inspect.test.ts → repo root is two levels up.
const REPO_ROOT = resolve(__dirname, '..', '..')
const CLI_PATH = join(REPO_ROOT, 'src', 'cli', 'inspect.ts')
const FIXTURE_JSON = join(REPO_ROOT, 'fixtures', 'indoor-tiny.json')

/** Build a real FIT byte buffer in tmp from one of the checked-in fixtures.
 *  Indoor-tiny is the smallest fixture so the inspect dump is small enough to
 *  compare against without OOM risk. */
function buildFitFixture(tmp: string): string {
  const text = readFileSync(FIXTURE_JSON, 'utf8')
  const session = parsePolarJson(text)
  const bytes = polarToFit(session)
  const fitPath = join(tmp, 'fixture.fit')
  writeFileSync(fitPath, bytes)
  return fitPath
}

describe('cli/inspect', () => {
  it('decodes a generated FIT file and dumps file_id, session, activity', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'polar-inspect-'))
    try {
      const fitPath = buildFitFixture(tmp)

      const stdout = execFileSync('pnpm', ['exec', 'tsx', CLI_PATH, fitPath], {
        stdio: 'pipe',
        cwd: REPO_ROOT,
        encoding: 'utf8',
        // Default 1 MB maxBuffer is too small: even indoor-tiny dumps ~2k
        // record messages of pretty-printed JSON, which trips the limit and
        // truncates stdout silently. Bump to 32 MB to comfortably hold the
        // largest fixture's full dump.
        maxBuffer: 32 * 1024 * 1024,
      })

      // The decoded message tree pretty-prints as JSON object-of-arrays keyed
      // on message-group names. Asserting the three required-by-Strava groups
      // appear is enough to confirm decoder round-trip works end-to-end.
      expect(stdout).toContain('fileIdMesgs')
      expect(stdout).toContain('sessionMesgs')
      expect(stdout).toContain('activityMesgs')

      // Also assert the dump is parseable — a stronger check than substring
      // matching, since substrings could appear in unrelated text. This proves
      // the output is exactly one valid JSON document.
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      expect(Array.isArray(parsed['fileIdMesgs'])).toBe(true)
      expect(Array.isArray(parsed['sessionMesgs'])).toBe(true)
      expect(Array.isArray(parsed['activityMesgs'])).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }, 30_000)

  it('--summary mode prints per-group counts plus first/last record', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'polar-inspect-'))
    try {
      const fitPath = buildFitFixture(tmp)

      const stdout = execFileSync('pnpm', ['exec', 'tsx', CLI_PATH, fitPath, '--summary'], {
        stdio: 'pipe',
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      })

      const parsed = JSON.parse(stdout) as {
        counts: Record<string, number>
        firstRecord: unknown
        lastRecord: unknown
      }
      expect(parsed.counts['fileIdMesgs']).toBe(1)
      expect(parsed.counts['sessionMesgs']).toBe(1)
      expect(parsed.counts['activityMesgs']).toBe(1)
      expect(parsed.counts['recordMesgs']).toBeGreaterThan(0)
      expect(parsed.firstRecord).not.toBeNull()
      expect(parsed.lastRecord).not.toBeNull()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }, 30_000)

  it('exits 1 when given a non-FIT file (CRC failure)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'polar-inspect-'))
    try {
      // 32 bytes of garbage — too short for a FIT header, guaranteed to fail
      // either header parse or CRC integrity.
      const garbagePath = join(tmp, 'garbage.fit')
      writeFileSync(garbagePath, new Uint8Array(32))

      let exitCode = 0
      try {
        execFileSync('pnpm', ['exec', 'tsx', CLI_PATH, garbagePath], {
          stdio: 'pipe',
          cwd: REPO_ROOT,
          encoding: 'utf8',
        })
      } catch (err) {
        const e = err as { status?: number }
        exitCode = e.status ?? -1
      }
      expect(exitCode).toBe(1)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }, 30_000)

  it('exits 2 with a usage message when no path is given', () => {
    let exitCode = 0
    let stderr = ''
    try {
      execFileSync('pnpm', ['exec', 'tsx', CLI_PATH], {
        stdio: 'pipe',
        cwd: REPO_ROOT,
        encoding: 'utf8',
      })
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string }
      exitCode = e.status ?? -1
      stderr = typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString('utf8') ?? '')
    }
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/Usage:/)
  }, 30_000)
})
