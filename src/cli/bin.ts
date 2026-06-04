/**
 * Single-bin dispatcher for the published `polar-to-strava-fit` npm package.
 *
 * Usage:
 *   polar-to-strava-fit <zip> <out-dir>           # default subcommand: convert
 *   polar-to-strava-fit convert <zip> <out-dir>
 *   polar-to-strava-fit inspect <fit-file> [--summary]
 *   polar-to-strava-fit validate <out-dir>
 *
 * The unprefixed two-arg form (`polar-to-strava-fit ZIP OUT`) is the headline
 * UX from the README — it's the most common invocation, so we accept it
 * directly without forcing users to type `convert`. Anything else falls
 * through to the explicit-subcommand router.
 *
 * `@garmin/fitsdk` and `adm-zip` stay as external runtime imports here so the
 * bundle never inlines Garmin's SDK (the FIT Protocol License forbids
 * redistribution; see docs/research/cli-vending-feasibility.md).
 */

import { runConvertCli } from './convert'
import { runInspectCli } from './inspect'
import { runValidateCli } from './validate'

const HELP = `polar-to-strava-fit — convert Polar bulk-export ZIPs to Strava-ready FIT.

Usage:
  polar-to-strava-fit <zip> <out-dir>           Convert a ZIP (default subcommand).
  polar-to-strava-fit convert <zip> <out-dir>   Same as above, explicit form.
  polar-to-strava-fit inspect <fit> [--summary] Decode and pretty-print one .fit file.
  polar-to-strava-fit validate <out-dir>        Re-validate a directory of .fit + sidecars.
  polar-to-strava-fit --help                    Show this help.
  polar-to-strava-fit --version                 Show version.

Webapp version (no install): https://leewc.com/polar-to-strava-fit/
`

function readVersion(): string {
  // Filled in at publish time by reading our package.json sibling. We avoid
  // import-attribute JSON imports for older Node compat; just read the env.
  return process.env['POLAR_TO_STRAVA_FIT_VERSION'] ?? '0.0.0-dev'
}

function dispatch(argv: readonly string[]): number {
  const [first, ...rest] = argv
  if (!first || first === '--help' || first === '-h' || first === 'help') {
    process.stdout.write(HELP)
    return 0
  }
  if (first === '--version' || first === '-v') {
    process.stdout.write(`${readVersion()}\n`)
    return 0
  }
  if (first === 'convert') {
    return runConvertCli(rest, 'Usage: polar-to-strava-fit convert <zip> <out-dir>')
  }
  if (first === 'inspect') {
    return runInspectCli(rest, 'Usage: polar-to-strava-fit inspect <fit-file> [--summary]')
  }
  if (first === 'validate') {
    return runValidateCli(rest, 'Usage: polar-to-strava-fit validate <out-dir>')
  }
  // Unprefixed form: treat the first non-flag arg as a ZIP path and run convert.
  return runConvertCli(argv, 'Usage: polar-to-strava-fit <zip> <out-dir>')
}

const code = dispatch(process.argv.slice(2))
// `inspect` writes a possibly-large dump to stdout; setting exitCode (instead
// of process.exit) lets the event loop drain naturally — same trick the
// standalone inspect.ts uses to avoid 64 KB pipe-buffer truncation on macOS.
process.exitCode = code
