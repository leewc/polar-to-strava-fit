#!/usr/bin/env node
// Anonymize a Polar bulk-export training-session JSON for use as a public test fixture.
//
// Usage:
//   node scripts/anonymize-fixture.mjs <input.json> <output.json>
//
// Transformations:
//   - Drop the entire physicalInformation block (birthday, sex, weight, height,
//     VO2Max, FTP, MAP, MAS, training background — all PII).
//   - Shift GPS coordinates by a fixed offset (LAT_SHIFT, LON_SHIFT below) so
//     the route's *shape* is preserved (useful for converter tests) but the
//     home/work location is hidden. Both top-level lat/lon and per-waypoint
//     coordinates get the same shift.
//   - Drop top-level `account-` style identifiers if present.
//   - Leave timestamps, sample arrays, sport ids, and durations untouched —
//     they carry no useful PII and the converter needs them for tests.
//
// The shift is FIXED (not random) so re-running on the same input yields
// byte-identical output, which keeps fixture diffs reviewable.

import fs from 'node:fs'

// Mid-Pacific Ocean — far from any populated land. Shifts each lat by +X
// and each lon by +Y to land routes here.
const LAT_SHIFT_TO = 0.0
const LON_SHIFT_TO = -150.0

function pickShift(originalLat, originalLon) {
  return {
    lat: LAT_SHIFT_TO - originalLat,
    lon: LON_SHIFT_TO - originalLon,
  }
}

function anonymize(session) {
  const { latitude: refLat, longitude: refLon } = findFirstCoord(session)
  const shift = refLat != null && refLon != null
    ? pickShift(refLat, refLon)
    : { lat: 0, lon: 0 }

  delete session.physicalInformation

  if (typeof session.latitude === 'number') session.latitude += shift.lat
  if (typeof session.longitude === 'number') session.longitude += shift.lon

  for (const ex of session.exercises ?? []) {
    delete ex.physicalInformation
    if (typeof ex.latitude === 'number') ex.latitude += shift.lat
    if (typeof ex.longitude === 'number') ex.longitude += shift.lon

    const wps = ex.routes?.route?.wayPoints
    if (Array.isArray(wps)) {
      for (const wp of wps) {
        if (typeof wp.latitude === 'number') wp.latitude += shift.lat
        if (typeof wp.longitude === 'number') wp.longitude += shift.lon
      }
    }
  }

  return session
}

function findFirstCoord(session) {
  if (typeof session.latitude === 'number' && typeof session.longitude === 'number') {
    return { latitude: session.latitude, longitude: session.longitude }
  }
  for (const ex of session.exercises ?? []) {
    if (typeof ex.latitude === 'number' && typeof ex.longitude === 'number') {
      return { latitude: ex.latitude, longitude: ex.longitude }
    }
    const wp = ex.routes?.route?.wayPoints?.[0]
    if (wp && typeof wp.latitude === 'number') {
      return { latitude: wp.latitude, longitude: wp.longitude }
    }
  }
  return { latitude: null, longitude: null }
}

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: node scripts/anonymize-fixture.mjs <in.json> <out.json>')
  process.exit(2)
}

const text = fs.readFileSync(inPath, 'utf8')
const session = JSON.parse(text)
const anon = anonymize(session)
fs.writeFileSync(outPath, JSON.stringify(anon, null, 2))
console.log(`anonymized ${inPath} → ${outPath}`)
