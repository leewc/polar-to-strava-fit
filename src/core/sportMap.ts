import { Profile } from '@garmin/fitsdk'

export interface SportMapping {
  /** FIT `sport` enum numeric value (from `Profile.types.sport`). */
  sport: number
  /** FIT `sub_sport` enum numeric value (from `Profile.types.subSport`); omitted when not applicable. */
  subSport?: number
}

export interface LookupResult extends SportMapping {
  /** True when the input name was not in `POLAR_TO_FIT` and we returned the GENERIC fallback. */
  isFallback: boolean
}

/* -------------------------------------------------------------------------- *
 *  Reverse lookups: name (camelCase as the SDK stores it) → numeric enum.
 *  We never hard-code numbers; everything is sourced from the loaded SDK so
 *  bumping `@garmin/fitsdk` automatically picks up renumberings.
 * -------------------------------------------------------------------------- */

function invert(table: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(table)) {
    out[v] = Number(k)
  }
  return out
}

const SPORT_BY_NAME = invert(Profile.types.sport)
const SUBSPORT_BY_NAME = invert(Profile.types.subSport)

/** Convert Polar's appendix style "CROSS_COUNTRY_SKIING" → SDK style "crossCountrySkiing". */
function screamingSnakeToCamel(s: string): string {
  const parts = s.toLowerCase().split('_')
  return parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

/** Resolve a Polar appendix sport token (e.g. "RUNNING") to its FIT numeric enum value. */
function sport(name: string): number {
  const camel = screamingSnakeToCamel(name)
  const n = SPORT_BY_NAME[camel]
  if (n === undefined) {
    throw new Error(`sportMap: unknown FIT sport "${name}" (resolved to "${camel}")`)
  }
  return n
}

/** Resolve a Polar appendix sub_sport token (e.g. "OPEN_WATER") to its FIT numeric enum value. */
function subSport(name: string): number {
  const camel = screamingSnakeToCamel(name)
  const n = SUBSPORT_BY_NAME[camel]
  if (n === undefined) {
    throw new Error(`sportMap: unknown FIT sub_sport "${name}" (resolved to "${camel}")`)
  }
  return n
}

/** Convenience constructor: builds a `SportMapping` from Polar's appendix tokens. */
function mk(sportName: string, subSportName?: string): SportMapping {
  return subSportName === undefined
    ? { sport: sport(sportName) }
    : { sport: sport(sportName), subSport: subSport(subSportName) }
}

/* -------------------------------------------------------------------------- *
 *  Polar Flow display label → FIT sport+sub_sport.
 *  Source: https://www.polar.com/accesslink-api/#sport-type-mapping-in-fit-files
 *  (full appendix table fetched 2026-06-01; ~145 rows).
 *  Keys are matched case-insensitively after trimming whitespace
 *  (see `lookupSport`).
 * -------------------------------------------------------------------------- */
export const POLAR_TO_FIT: Record<string, SportMapping> = {
  'Adaptive water skiing': mk('WATER_SKIING'),
  'Aerobics': mk('GENERIC'),
  'Australian football': mk('GENERIC'),
  'Aqua fitness': mk('GENERIC'),
  'Backcountry skiing': mk('CROSS_COUNTRY_SKIING', 'BACKCOUNTRY'),
  'Badminton': mk('GENERIC'),
  'Ballet': mk('GENERIC'),
  'Ballroom': mk('GENERIC'),
  'Baseball': mk('GENERIC'),
  'Basketball': mk('BASKETBALL'),
  'Beach tennis': mk('TENNIS'),
  'Beach volley': mk('GENERIC'),
  'Biathlon': mk('GENERIC'),
  'Body&Mind': mk('GENERIC'),
  'Bootcamp': mk('GENERIC'),
  'Bowling': mk('GENERIC'),
  'Boxing': mk('BOXING'),
  'Canoeing': mk('KAYAKING'),
  'Car racing': mk('DRIVING'),
  'Circuit training': mk('TRAINING'),
  'Classic roller skiing': mk('GENERIC'),
  'Classic XC skiing': mk('CROSS_COUNTRY_SKIING'),
  'Climbing (indoor)': mk('GENERIC'),
  'Climbing (outdoor)': mk('ROCK_CLIMBING'),
  'Core': mk('TRAINING'),
  'Cricket': mk('GENERIC'),
  'Cross-country running': mk('RUNNING', 'BACKCOUNTRY'),
  'Cross-trainer': mk('TRAINING', 'INDOOR_RUNNING'),
  'Curling': mk('GENERIC'),
  'Cycling': mk('CYCLING'),
  'Dancing': mk('GENERIC'),
  'Disc golf': mk('GENERIC'),
  'Dog agility': mk('GENERIC'),
  'Downhill skiing': mk('ALPINE_SKIING'),
  '(Duathlon) Cycling': mk('CYCLING'),
  '(Duathlon) Running': mk('RUNNING'),
  'Electric biking': mk('E_BIKING'),
  'Enduro': mk('MOTORCYCLING'),
  'Esports': mk('GENERIC'),
  'Field hockey': mk('GENERIC'),
  'Finnish baseball': mk('GENERIC'),
  'Fitness boxing': mk('BOXING'),
  'Fitness dancing': mk('GENERIC'),
  'Fitness martial arts': mk('GENERIC'),
  'Floorball': mk('GENERIC'),
  'Football': mk('AMERICAN_FOOTBALL'),
  'Freestyle roller skiing': mk('GENERIC'),
  'Freestyle XC skiing': mk('CROSS_COUNTRY_SKIING'),
  'Functional training': mk('TRAINING'),
  'Futsal': mk('GENERIC'),
  'Golf': mk('GOLF'),
  'Gravel': mk('CYCLING', 'GRAVEL_CYCLING'),
  'Group exercise': mk('TRAINING'),
  'Gymnastics': mk('GENERIC'),
  'Handball': mk('GENERIC'),
  'Handcycling': mk('CYCLING', 'HAND_CYCLING'),
  'Hard enduro': mk('MOTORCYCLING'),
  'High-intensity interval training': mk('TRAINING'),
  'Hiking': mk('HIKING'),
  'Ice hockey': mk('ICE_SKATING'),
  'Ice skating': mk('ICE_SKATING'),
  'Indoor cycling': mk('CYCLING', 'INDOOR_CYCLING'),
  'Indoor rowing': mk('ROWING', 'INDOOR_ROWING'),
  'Inline skating': mk('INLINE_SKATING'),
  'Jazz': mk('GENERIC'),
  'Jogging': mk('RUNNING'),
  'Judo': mk('GENERIC'),
  'Kayaking': mk('KAYAKING'),
  'Kettlebell': mk('GENERIC'),
  'Kickbiking': mk('CYCLING'),
  'Kickboxing': mk('GENERIC'),
  'Kitesurfing': mk('KITESURFING'),
  'Korfball': mk('GENERIC'),
  'Lacrosse': mk('GENERIC'),
  'Latin': mk('GENERIC'),
  'LES MILLS BARRE': mk('GENERIC'),
  'LES MILLS BODYATTACK': mk('GENERIC'),
  'LES MILLS BODYBALANCE': mk('GENERIC'),
  'LES MILLS BODYCOMBAT': mk('GENERIC'),
  'LES MILLS BODYJAM': mk('GENERIC'),
  'LES MILLS BODYPUMP': mk('GENERIC'),
  'LES MILLS BODYSTEP': mk('GENERIC'),
  'LES MILLS CORE': mk('GENERIC'),
  'LES MILLS GRIT Cardio': mk('GENERIC'),
  'LES MILLS GRIT Strength': mk('GENERIC'),
  'LES MILLS GRIT Athletic': mk('GENERIC'),
  'LES MILLS RPM': mk('GENERIC'),
  "LES MILLS SH'BAM": mk('GENERIC'),
  'LES MILLS SPRINT': mk('GENERIC'),
  'LES MILLS THE TRIP': mk('GENERIC'),
  'LES MILLS TONE': mk('GENERIC'),
  'Mobility (dynamic)': mk('GENERIC', 'FLEXIBILITY_TRAINING'),
  'Mobility (static)': mk('GENERIC', 'FLEXIBILITY_TRAINING'),
  'Modern': mk('GENERIC'),
  'Mountain bike orienteering': mk('CYCLING', 'BACKCOUNTRY'),
  'Mountain biking': mk('CYCLING', 'MOUNTAIN'),
  'Motocross': mk('MOTORCYCLING'),
  'Motor sports': mk('DRIVING'),
  'Netball': mk('GENERIC'),
  'Nordic walking': mk('WALKING'),
  'Obstacle course racing': mk('RUNNING', 'OBSTACLE'),
  '(Off-road duathlon) Mountain biking': mk('CYCLING', 'BACKCOUNTRY'),
  '(Off-road duathlon) Trail running': mk('RUNNING', 'BACKCOUNTRY'),
  '(Off-road triathlon) Mountain biking': mk('CYCLING', 'BACKCOUNTRY'),
  '(Off-road triathlon) Trail running': mk('RUNNING', 'BACKCOUNTRY'),
  '(Off-road triathlon) Open water swimming': mk('SWIMMING', 'BACKCOUNTRY'),
  'Open water swimming': mk('SWIMMING', 'OPEN_WATER'),
  'Orienteering': mk('GENERIC', 'BACKCOUNTRY'),
  'Other outdoor': mk('GENERIC'),
  'Other indoor': mk('GENERIC'),
  'Padel': mk('RACKET', 'PADEL'),
  'Pickleball': mk('RACKET', 'PICKLEBALL'),
  'Pilates': mk('GENERIC', 'PILATES'),
  'Pool swimming': mk('SWIMMING'),
  'Riding': mk('HORSEBACK_RIDING'),
  'Ringette': mk('ICE_SKATING'),
  'Road cycling': mk('CYCLING', 'ROAD'),
  'Road racing': mk('DRIVING'),
  'Road running': mk('RUNNING', 'STREET'),
  'Roller skating': mk('GENERIC'),
  'Rope skipping': mk('JUMP_ROPE'),
  'Rowing': mk('ROWING'),
  'Rugby': mk('GENERIC'),
  'Running': mk('RUNNING', 'STREET'),
  'Sailing': mk('SAILING'),
  'Shooting sport (indoor)': mk('GENERIC'),
  'Shooting sport (outdoor)': mk('GENERIC'),
  'Show': mk('GENERIC'),
  'Skateboarding': mk('GENERIC'),
  'Skating': mk('ICE_SKATING'),
  'Skiing': mk('CROSS_COUNTRY_SKIING'),
  'Ski orienteering': mk('CROSS_COUNTRY_SKIING', 'BACKCOUNTRY'),
  'Sled hockey': mk('HOCKEY'),
  'Snocross': mk('GENERIC'),
  'Snowboarding': mk('SNOWBOARDING'),
  'Snowshoe trekking': mk('SNOWSHOEING'),
  'Soccer': mk('SOCCER'),
  'Spinning': mk('GENERIC', 'INDOOR_CYCLING'),
  'Squash': mk('GENERIC'),
  'Stair workout': mk('GENERIC'),
  'Step workout': mk('GENERIC'),
  'Street': mk('GENERIC'),
  'Strength training': mk('TRAINING', 'STRENGTH_TRAINING'),
  'Stretching': mk('GENERIC', 'FLEXIBILITY_TRAINING'),
  'SUP': mk('STAND_UP_PADDLEBOARDING'),
  'Surfing': mk('SURFING'),
  'Swimming': mk('SWIMMING'),
  'Table tennis': mk('GENERIC'),
  'Taekwondo': mk('GENERIC'),
  'Telemark skiing': mk('ALPINE_SKIING'),
  'Tennis': mk('TENNIS'),
  'Track&field running': mk('RUNNING', 'TRACK'),
  'Trail running': mk('RUNNING', 'TRAIL'),
  'Treadmill running': mk('RUNNING', 'TREADMILL'),
  '(Triathlon) Cycling': mk('CYCLING'),
  '(Triathlon) Running': mk('RUNNING'),
  '(Triathlon) Open water swimming': mk('SWIMMING'),
  'Trotting': mk('GENERIC'),
  'Ultimate': mk('GENERIC'),
  'Ultra running': mk('RUNNING'),
  'Volleyball': mk('GENERIC'),
  'Wakeboarding': mk('WAKEBOARDING'),
  'Walking': mk('WALKING'),
  'Water running': mk('GENERIC'),
  'Water skiing': mk('WATER_SKIING'),
  'Water sports': mk('GENERIC'),
  'Wheelchair racing': mk('GENERIC'),
  'Wheelchair basketball': mk('BASKETBALL'),
  'Wheelchair tennis': mk('TENNIS'),
  'Windsurfing': mk('WINDSURFING'),
  'Yoga': mk('GENERIC', 'YOGA'),
}

/* -------------------------------------------------------------------------- *
 *  Case-insensitive lookup index. Built once at module load.
 * -------------------------------------------------------------------------- */
const POLAR_TO_FIT_LOWER: Record<string, SportMapping> = {}
for (const [label, mapping] of Object.entries(POLAR_TO_FIT)) {
  POLAR_TO_FIT_LOWER[label.toLowerCase()] = mapping
}

/** Numeric value of FIT `sport.GENERIC`, used as the fallback. */
const GENERIC_SPORT = sport('GENERIC')

/**
 * Resolve a Polar Flow display label (the `name` field of a training session)
 * to a FIT `sport`+`sub_sport` mapping.
 *
 * Matches case-insensitively after trimming whitespace, so "Running",
 * "running" and "  RUNNING  " all resolve identically. Unknown labels return
 * `{ sport: GENERIC, isFallback: true }` so the caller can surface a warning
 * without losing the rest of the conversion.
 */
export function lookupSport(name: string): LookupResult {
  const key = name.trim().toLowerCase()
  const hit = POLAR_TO_FIT_LOWER[key]
  if (hit !== undefined) {
    return { ...hit, isFallback: false }
  }
  return { sport: GENERIC_SPORT, isFallback: true }
}
