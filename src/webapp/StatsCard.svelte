<!--
  StatsCard — post-conversion stats dashboard.

  Renders Strava-style "Best Efforts" widgets per sport family (running,
  cycling, swimming, walking) plus simple totals over the user's converted
  Polar sessions. Mounted between Stage 4 (Validating) and Stage 5 (Download)
  in App.svelte, OUTSIDE the wizard's Card.Roots so it stands out against
  the stage flow.

  Renders nothing when:
    - `stats` is null (computation hasn't run yet), or
    - the report has no signal at all (no family reached any best-effort
      distance AND zero activities — i.e. an empty batch).

  Format conventions:
    - Best-effort times: "MM:SS" if < 1h; "H:MM:SS" if >= 1h.
    - Distance shown in km AND mi (people care about both, especially when
      moving from Polar's mostly-metric world to Strava).
    - Time as "Hh Mm".
    - Elevation in m AND ft when present.
-->
<script lang="ts">
  import type { BestEffort, SportFamily, StatsReport } from '@core/stats'
  import * as Card from '$lib/components/ui/card'
  import { Activity, Clock, MapPin, Mountain, Trophy } from 'lucide-svelte'

  let { stats }: { stats: StatsReport | null } = $props()

  /** Order in which family sections render. Mirrors SPORT_FAMILIES. */
  const FAMILY_ORDER: SportFamily[] = ['running', 'cycling', 'swimming', 'walking']

  /** True when there's nothing meaningful to render: no family produced any
   *  best-effort row AND zero activities. The `stats === null` short-circuit
   *  happens outside this derived. */
  const isEmpty = $derived.by(() => {
    if (!stats) return true
    const anyBest = FAMILY_ORDER.some((f) => {
      const rows = stats.bestEfforts[f]
      return rows && rows.some((r) => r.bestSeconds !== null)
    })
    return !anyBest && stats.totals.activityCount === 0
  })

  /** The list of (family, populated-rows) pairs we'll render — in canonical
   *  order, with empty families filtered out. Only rows whose bestSeconds is
   *  non-null make it through. */
  const populatedFamilies = $derived.by(() => {
    if (!stats) return [] as Array<{ family: SportFamily; rows: BestEffort[] }>
    const out: Array<{ family: SportFamily; rows: BestEffort[] }> = []
    for (const family of FAMILY_ORDER) {
      const rows = stats.bestEfforts[family]
      if (!rows) continue
      const populated = rows.filter((r) => r.bestSeconds !== null)
      if (populated.length === 0) continue
      out.push({ family, rows: populated })
    }
    return out
  })

  /** "Running", "Cycling", … — capitalised family name for section headers. */
  function familyTitle(family: SportFamily): string {
    return family.charAt(0).toUpperCase() + family.slice(1)
  }

  /** "MM:SS" if < 1h; "H:MM:SS" otherwise. Pure. */
  function fmtBestTime(seconds: number): string {
    const total = Math.round(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    }
    return `${m}:${String(s).padStart(2, '0')}`
  }

  /** "Hh Mm" — drops the hour part when zero. */
  function fmtDuration(seconds: number): string {
    const total = Math.round(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  function metersToKm(m: number): string {
    return (m / 1000).toFixed(1)
  }
  function metersToMiles(m: number): string {
    return (m / 1609.344).toFixed(1)
  }
  function metersToFeet(m: number): string {
    return (m * 3.28084).toFixed(0)
  }
</script>

{#if stats && !isEmpty}
  <Card.Root data-testid="stats-card" class="border-primary/20 bg-primary/5">
    <Card.Header>
      <Card.Title class="flex items-center gap-2 text-base">
        <Trophy class="size-4 text-amber-600" aria-hidden="true" />
        Your data
      </Card.Title>
    </Card.Header>
    <Card.Content class="space-y-5">
      <!-- ─── Best Efforts (per family) ─── -->
      {#if populatedFamilies.length > 0}
        <section data-testid="stats-best-efforts">
          {#each populatedFamilies as { family, rows }, i (family)}
            <div
              data-testid={`stats-best-efforts-${family}`}
              class={i < populatedFamilies.length - 1 ? 'mb-4' : ''}
            >
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {familyTitle(family)} Best Efforts
              </h3>
              <ul class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {#each rows as row (row.label)}
                  <li
                    class="flex items-baseline justify-between gap-2 border-b border-border/40 py-1"
                  >
                    <span class="text-muted-foreground">{row.label}</span>
                    <span class="font-mono font-medium">
                      {fmtBestTime(row.bestSeconds!)}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </section>
      {/if}

      <!-- ─── Totals ─── -->
      {#if stats.totals.activityCount > 0}
        <section data-testid="stats-totals">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Totals
          </h3>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div class="flex flex-col">
              <dt class="flex items-center gap-1 text-xs text-muted-foreground">
                <Activity class="size-3.5" aria-hidden="true" />
                Activities
              </dt>
              <dd class="font-mono text-base font-medium" data-testid="stats-activity-count">
                {stats.totals.activityCount}
              </dd>
            </div>
            <div class="flex flex-col">
              <dt class="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin class="size-3.5" aria-hidden="true" />
                Distance
              </dt>
              <dd class="font-mono text-base font-medium" data-testid="stats-distance">
                {metersToKm(stats.totals.totalDistanceMeters)} km
                <span class="block text-xs font-normal text-muted-foreground">
                  {metersToMiles(stats.totals.totalDistanceMeters)} mi
                </span>
              </dd>
            </div>
            <div class="flex flex-col">
              <dt class="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock class="size-3.5" aria-hidden="true" />
                Time
              </dt>
              <dd class="font-mono text-base font-medium" data-testid="stats-time">
                {fmtDuration(stats.totals.totalDurationSec)}
              </dd>
            </div>
            {#if stats.totals.totalElevationGainMeters !== null}
              <div class="flex flex-col">
                <dt class="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mountain class="size-3.5" aria-hidden="true" />
                  Elev Gain
                </dt>
                <dd class="font-mono text-base font-medium" data-testid="stats-elevation">
                  {Math.round(stats.totals.totalElevationGainMeters)} m
                  <span class="block text-xs font-normal text-muted-foreground">
                    {metersToFeet(stats.totals.totalElevationGainMeters)} ft
                  </span>
                </dd>
              </div>
            {/if}
          </dl>
        </section>
      {/if}
    </Card.Content>
  </Card.Root>
{/if}
