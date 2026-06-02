import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// This file lives at <repo>/src/cli/validate.test.ts → repo root is two levels up.
const REPO_ROOT = resolve(__dirname, '..', '..')
const CONVERT_CLI = join(REPO_ROOT, 'src', 'cli', 'convert.ts')
const VALIDATE_CLI = join(REPO_ROOT, 'src', 'cli', 'validate.ts')

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

describe('cli/validate', () => {
  itIfZip(
    'converts the real Polar export then validates the output dir, exit 0 + summary line',
    () => {
      const zip = zipPath as string
      const outDir = mkdtempSync(join(tmpdir(), 'polar-validate-'))
      try {
        // Stage 1: convert. We need real .fit + .polar.json pairs to validate.
        execFileSync('pnpm', ['exec', 'tsx', CONVERT_CLI, zip, outDir], {
          stdio: 'pipe',
          cwd: REPO_ROOT,
          encoding: 'utf8',
        })

        const fits = readdirSync(outDir).filter((n) => n.endsWith('.fit'))
        expect(fits.length).toBeGreaterThan(0)

        // Stage 2: validate. Should exit 0 because the converter just wrote
        // these files — there should be zero decode failures.
        const stdout = execFileSync(
          'pnpm',
          ['exec', 'tsx', VALIDATE_CLI, outDir],
          {
            stdio: 'pipe',
            cwd: REPO_ROOT,
            encoding: 'utf8',
          },
        )

        // Summary line shape: "<n> files: <ok> ok, <warned> warned, <failed> failed".
        const summaryRe = /(\d+) files: (\d+) ok, (\d+) warned, (\d+) failed/
        const match = stdout.match(summaryRe)
        expect(match, `expected summary line in stdout:\n${stdout}`).not.toBeNull()
        const m = match as RegExpMatchArray
        const total = Number(m[1])
        const failed = Number(m[4])

        expect(total).toBe(fits.length)
        expect(failed).toBe(0)
      } finally {
        rmSync(outDir, { recursive: true, force: true })
      }
    },
    180_000,
  )

  it('prints usage and exits with code 2 when no out-dir is given', () => {
    let exitCode = 0
    let stderr = ''
    try {
      execFileSync('pnpm', ['exec', 'tsx', VALIDATE_CLI], {
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
