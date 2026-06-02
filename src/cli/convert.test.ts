import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// This file lives at <repo>/src/cli/convert.test.ts → repo root is two levels up.
const REPO_ROOT = resolve(__dirname, '..', '..')
const CLI_PATH = join(REPO_ROOT, 'src', 'cli', 'convert.ts')

const ZIP_NAME = 'polar-user-data-export_de647c3a-0cdf-4e0f-afcb-1a64eaa77441.zip'

// When running from `.claude/worktrees/<name>/`, hop out to the main checkout
// to find the user's zip (it's gitignored; only present in the main worktree).
const ZIP_CANDIDATES = [
  join(REPO_ROOT, ZIP_NAME),
  join(REPO_ROOT, '..', '..', '..', ZIP_NAME),
]

function findZip(): string | null {
  for (const p of ZIP_CANDIDATES) {
    if (existsSync(p)) return p
  }
  return null
}

const zipPath = findZip()
const itIfZip = zipPath ? it : it.skip

describe('cli/convert', () => {
  itIfZip(
    'converts the real Polar export ZIP to one .fit + one .polar.json per session',
    () => {
      // The shipping export contains 27 training-session-*.json entries (the
      // PLAN claims 29 but the zip has 27 — assert against reality, not the
      // plan, so this test stays accurate if a future re-export adds more).
      const EXPECTED_SESSIONS = 27

      const zip = zipPath as string
      const outDir = mkdtempSync(join(tmpdir(), 'polar-convert-'))
      try {
        execFileSync('pnpm', ['exec', 'tsx', CLI_PATH, zip, outDir], {
          stdio: 'pipe',
          cwd: REPO_ROOT,
          encoding: 'utf8',
        })

        const entries = readdirSync(outDir)
        const fits = entries.filter((n) => n.endsWith('.fit'))
        const sidecars = entries.filter((n) => n.endsWith('.polar.json'))

        expect(fits.length).toBe(EXPECTED_SESSIONS)
        expect(sidecars.length).toBe(EXPECTED_SESSIONS)

        for (const f of fits) {
          const size = statSync(join(outDir, f)).size
          expect(size).toBeGreaterThan(0)
        }
      } finally {
        rmSync(outDir, { recursive: true, force: true })
      }
    },
    120_000,
  )

  it('prints usage and exits with code 2 when args are missing', () => {
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
