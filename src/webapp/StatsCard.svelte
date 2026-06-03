<!--
  StatsCard — post-conversion stats dashboard.

  Renders Strava's "Best Efforts" widget plus simple totals over the user's
  converted Polar sessions. Mounted between Stage 4 (Validating) and Stage 5
  (Download) in App.svelte, OUTSIDE the wizard's Card.Roots so it stands out
  against the stage flow.

  Renders nothing when:
    - `stats` is null (computation hasn't run yet), or
    - the report has no signal at all (no Running session reached any best
      effort distance AND zero activities — i.e. an empty batch).

  Format conventions:
    - Best-effort times: "MM:SS" if < 1h; "H:MM:SS" if >= 1h.
    - Distance shown in km AND mi (people care about both, especially when
      moving from Polar's mostly-metric world to Strava).
    - Time as "Hh Mm".
    - Elevation in m AND ft when present.
-->
<script lang="ts">
  import type { StatsReport } from '@core/stats'
  import * as Card from '$lib/components/ui/card'
  import { Activity, Clock, Info, MapPin, Mountain, Trophy } from 'lucide-svelte'

  let { stats }: { stats: StatsReport | null } = $props()

  /** True when there's nothing meaningful to render (every BE row is null
   *  AND zero activities). The `stats === null` short-circuit happens
   *  outside this derived. */
  const isEmpty = $derived.by(() => {
    if (!stats) return true
    const allBestNull = stats.bestEfforts.every((b) => b.bestSeconds === null)
    return allBestNull && stats.totals.activityCount === 0
  })

  /** Best-effort rows that actually have data. */
  const populatedBest = $derived.by(() =>
    stats ? stats.bestEfforts.filter((b) => b.bestSeconds !== null) : [],
  )

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
      <!-- ─── Best Efforts ─── -->
      {#if populatedBest.length > 0}
        <section data-testid="stats-best-efforts">
          <h3 class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Best Efforts
            <!-- T24: explicit (i) hover/title affordance noting that Best
                 Efforts is currently Running-only. Other sport families
                 (cycling, swimming, hiking) would each need their own
                 reference distances; if/when an export contains them, this
                 expands. -->
            <span
              class="cursor-help"
              title="Best Efforts is computed for Running sessions only. Cycling, swimming, hiking, etc. each have their own reference distances and aren't included here yet."
              aria-label="Best Efforts is computed for Running sessions only."
            >
              <Info class="size-3.5" aria-hidden="true" />
            </span>
          </h3>
          <ul class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {#each populatedBest as row (row.label)}
              <li class="flex items-baseline justify-between gap-2 border-b border-border/40 py-1">
                <span class="text-muted-foreground">{row.label}</span>
                <span class="font-mono font-medium">
                  {fmtBestTime(row.bestSeconds!)}
                </span>
              </li>
            {/each}
          </ul>
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
