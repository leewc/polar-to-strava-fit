# Polar JSON to FIT converter - canonical reference data

Research-only report (plan mode). Sources fetched directly via WebFetch / curl; no
side effects.

---

## Q1 — Minimal valid Activity FIT file structure

**Note on sourcing.** `developer.garmin.com` is a JS-rendered SPA and returns only
a navigation shell to non-browser fetchers, so the canonical doc text could not
be scraped. The authoritative information below comes from Garmin's own
`encode-activity-recipe.test.js` in the official `@garmin/fit-javascript-sdk`
repo (which the SDK README explicitly points to as the reference recipe), plus
Strava's uploads doc. Where I cite the Garmin "Activity Files" doc by name, I
have NOT verified the page text directly — flagged inline.

**Required messages and ordering** (from
`https://github.com/garmin/fit-javascript-sdk/blob/main/test/encode-activity-recipe.test.js`):

1. `file_id` — `type="activity"`, `manufacturer`, `product`, `time_created`,
   `serial_number`. **MUST be the first message in every FIT file.**
2. (Optional best practice) `device_info` for the creator — `device_index="creator"`,
   `manufacturer`, `product`, `product_name`, `serial_number`, `software_version`,
   `timestamp`.
3. (Optional) `developer_data_id` + `field_description` pairs (only if using
   developer fields).
4. `event` — timer **start**: `timestamp`, `event="timer"`, `event_type="start"`.
5. `record` messages — at least one; each requires `timestamp`. Other fields
   (position, distance, speed, HR, cadence, power, altitude) are optional.
6. `event` — timer **stop**: `timestamp`, `event="timer"`, `event_type="stop"`.
7. `lap` — at least one; required: `message_index`, `timestamp`, `start_time`,
   `total_elapsed_time`, `total_timer_time`.
8. `session` — exactly one (or more for multisport); required: `message_index`,
   `timestamp`, `start_time`, `total_elapsed_time`, `total_timer_time`, `sport`,
   `sub_sport`, `first_lap_index`, `num_laps`.
9. `activity` — exactly one, last; required: `timestamp`, `num_sessions`,
   `local_timestamp`, `total_timer_time`.

**Strava-specific requirements** (verified at
`https://developers.strava.com/docs/uploads/`):

- Strava reads `file_id`, `session`, `lap`, `record`, `event`, `hr`, `length`,
  `split`, `set`, `activity`.
- Activity type is determined from `session.sport` and `session.sub_sport`.
- Every `record` MUST have a `timestamp` (per FIT spec).
- Special case: strength-style activities (`WeightTraining`,
  `HighIntensityIntervalTraining`, `Workout`, `Crossfit`) using `set` messages do
  NOT need timestamped `record` messages, but DO require `activity.timestamp`
  and `session.total_elapsed_time`.

**Recommended ordering** (canonical, from the recipe): `file_id` → `device_info` →
developer-data declarations → `event(start)` → `record`s in time order →
`event(stop)` → `lap`(s) → `session`(s) → `activity`. The FIT decoder relies on
file_id being byte-0 and on activity being the terminal aggregate.

Sources:
- `https://github.com/garmin/fit-javascript-sdk/blob/main/test/encode-activity-recipe.test.js`
- `https://developers.strava.com/docs/uploads/`
- `https://developer.garmin.com/fit/file-types/activity/` (page text not scraped — JS-rendered; the message list above is consistent with the public SDK recipe and Strava's reader)

---

## Q2 — Polar sport ID to FIT sport mapping

**Important finding: numeric sport IDs are NOT in the AccessLink API.** The
Polar AccessLink REST API exposes sport as a STRING in `sport` and
`detailed_sport_info` (e.g. `"RUNNING"`, `"OTHER"`, `"WATERSPORTS_WATERSKI"`).
Verified directly in `https://www.polar.com/accesslink-api/swagger.yaml` lines
3020-3046 and 3142-3170.

The numeric `"sport": {"id": "1"}` you see comes from the **Polar Flow account
bulk export ZIP** (a separate, undocumented JSON format dumped from the Flow
web app), not from AccessLink. I could not find an official Polar-published
table mapping those numeric IDs to named sports — Polar does not document the
bulk-export schema. You will need to map them empirically from your own data
or from community projects (e.g. polar-flow-sync, flowapp exporters); Polar
does not publish this mapping.

**What Polar DOES publish** (extracted verbatim from the live page on
2026-06-01):

(a) Appendix "Detailed sport info values in exercise entity" at
`https://www.polar.com/accesslink-api/#detailed-sport-info-values-in-exercise-entity`
— a 2-column table mapping `detailed_sport_info` STRING values to the
human-readable Sport-in-Polar-Flow label. Examples: `RUNNING` → "Running",
`OTHER_INDOOR` → "Other indoor", `OTHER_OUTDOOR` → "Other outdoor",
`POOL_SWIMMING` → "Pool swimming", `MOUNTAIN_BIKING` → "Mountain biking",
`WATERSPORTS_WATERSKI` → "Water skiing", `STRENGTH_TRAINING` → "Strength
training", `INDOOR_CYCLING` → "Indoor cycling", and ~150 more entries.

(b) Appendix "Sport type mapping in FIT-files" at
`https://www.polar.com/accesslink-api/#sport-type-mapping-in-fit-files` — a
2-column table mapping the Polar Flow label to FIT `sport`
(plus optional `sub_sport`). Default for unlisted sports is `GENERIC`. Sample
rows:

- Running → `RUNNING, SubSport: STREET`
- Trail running → `RUNNING, SubSport: TRAIL`
- Treadmill running → `RUNNING, SubSport: TREADMILL`
- Cycling → `CYCLING`
- Mountain biking → `CYCLING, SubSport: MOUNTAIN`
- Indoor cycling → `CYCLING, SubSport: INDOOR_CYCLING`
- Gravel → `CYCLING, SubSport: GRAVEL_CYCLING`
- Pool swimming → `SWIMMING`
- Open water swimming → `SWIMMING, SubSport: OPEN_WATER`
- Hiking → `HIKING`
- Walking → `WALKING`
- Strength training → `TRAINING, SubSport: STRENGTH_TRAINING`
- Yoga → `GENERIC, SubSport: YOGA`
- Other indoor → `GENERIC`
- Other outdoor → `GENERIC`
- Downhill skiing → `ALPINE_SKIING`
- Backcountry skiing → `CROSS_COUNTRY_SKIING, SubSport: BACKCOUNTRY`

Full table (~150 rows) is captured in the agent transcript and can be inlined
into a `polar-sport-map.ts` module.

**Pipeline recommendation:** `bulk-export.sport.id (number)` → name (your own
mapping, derived empirically) → AccessLink-style key (e.g. `RUNNING`) →
FIT `sport`+`sub_sport` (Polar table above). If you have AccessLink data, skip
the first step.

Sources:
- `https://www.polar.com/accesslink-api/` (rendered HTML, both appendix
  sections fetched and parsed in full)
- `https://www.polar.com/accesslink-api/swagger.yaml` (4779 lines; confirms
  `sport`/`detailed_sport_info` are strings, not numeric IDs)
- Numeric `sport.id` mapping: **NOT FINDABLE in any official Polar source.**

---

## Q3 — `@garmin/fitsdk` npm package

Confirmed at `https://www.npmjs.com/package/@garmin/fitsdk`. Latest version
**21.205.0**. Tarball downloaded and inspected directly from
`https://registry.npmjs.org/@garmin/fitsdk/-/fitsdk-21.205.0.tgz`.

- **License:** "Flexible and Interoperable Data Transfer (FIT) Protocol License"
  — review terms; not OSI-standard.
- **Module format:** ESM only (`"type": "module"`, `"main": "src/index.js"`,
  `"types": "src/index.d.ts"`). No CJS build.
- **Runtime dependencies:** ZERO. Only devDependencies (`vitest`, `typescript`,
  `@types/node`).
- **Browser compatibility:** Yes. Source uses only `ArrayBuffer`,
  `Uint8Array`, `DataView`, and `TextEncoder/Decoder` — no `fs`, no `Buffer`,
  no `node:*` imports (verified by grep across all `src/*.js`). README states
  "Node.js v14.0+ or a browser with a compatible JavaScript runtime engine."
  Note: `output-stream.js` uses **resizable ArrayBuffer**
  (`new ArrayBuffer(n, { maxByteLength })`), which requires Chrome 111+,
  Safari 16.4+, Firefox 128+, Node 20+.
- **Encoder API** (from `src/encoder.js`):
  - `import { Encoder, Profile, Utils } from "@garmin/fitsdk";`
  - `const encoder = new Encoder({ fieldDescriptions? });`
  - `encoder.writeMesg(mesg)` — `mesg` includes `mesgNum` (e.g. `Profile.MesgNum.FILE_ID`).
    Internally calls `onMesg`.
  - `encoder.onMesg(mesgNum, mesg)` — alternate form, mesgNum separate.
  - `encoder.addDeveloperField(key, developerDataIdMesg, fieldDescriptionMesg)`.
  - `encoder.close()` → returns `Uint8Array` of the complete FIT file.
- **Sizes (measured from tarball):**
  - npm tarball (gzipped): 152 KB.
  - npm registry-reported unpacked size: 1,304,442 bytes (~1.30 MB).
  - Concatenated raw `src/*.js`: 999,275 bytes (~999 KB).
  - `src/profile.js` alone: 903,719 bytes (~903 KB; auto-generated profile tables).
  - **Concatenated source gzipped (no minification): ~91.7 KB.**
  - Minified+gzipped: not directly measured (bundlephobia returned 429
    Rate-Limited). A reasonable lower-bound estimate is **~70-90 KB
    min+gzip** since the bulk is `profile.js`'s repeating data tables which
    minify only modestly (already short identifiers); call it ~80 KB ± 15 KB
    for planning. Bundlers can tree-shake `Decoder` if only encoding.

Sources:
- `https://www.npmjs.com/package/@garmin/fitsdk`
- `https://registry.npmjs.org/@garmin/fitsdk` (registry metadata)
- `https://registry.npmjs.org/@garmin/fitsdk/-/fitsdk-21.205.0.tgz` (tarball, inspected locally)
- `https://github.com/garmin/fit-javascript-sdk` (README, encode-activity-recipe.test.js)

---

## Things explicitly NOT findable

1. The numeric `sport.id` → name mapping for Polar Flow **bulk export** JSON.
   Polar publishes this mapping nowhere on `polar.com` or in their swagger.
   Will require empirical/community sourcing.
2. The rendered text of `developer.garmin.com/fit/file-types/activity/` and
   `/fit/cookbook/encoding-activity-files/`. The site is a JS-rendered SPA;
   curl/WebFetch return only nav. The `encode-activity-recipe.test.js` reference
   in the official SDK is the most authoritative scrapable substitute.
3. Exact minified+gzipped size of `@garmin/fitsdk` from a public bundler
   (bundlephobia rate-limited; npm package page does not publish min+gzip).
   Estimated above from raw gzip of source.
