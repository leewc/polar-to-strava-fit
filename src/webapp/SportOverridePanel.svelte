<script lang="ts">
  /**
   * SportOverridePanel — out-of-band UI for re-classifying sessions whose
   * Polar Flow display name didn't match any entry in `POLAR_TO_FIT` and
   * therefore landed on the GENERIC sport fallback.
   *
   * Shows a collapsible shadcn `Card` listing each fallback session with
   * two `Select` dropdowns: FIT Sport (required) and FIT SubSport
   * (optional). Each option list is sourced from the `@garmin/fitsdk`
   * runtime enum (`Profile.types.sport`, `Profile.types.subSport`) so a
   * `@garmin/fitsdk` upgrade automatically surfaces any new enum values.
   *
   * On change, emits `onChange(fileName, newSport, newSubSport)` so the
   * parent (`App.svelte`) can re-run `polarToFit` for the affected
   * session with `{ sportOverride, subSportOverride }`. This component
   * is purely presentational — it neither converts FIT bytes nor
   * persists state.
   *
   * Hides itself entirely when no fallback sessions exist.
   */
  import { Profile } from '@garmin/fitsdk'

  import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card'

  // We deliberately use a native <select> here rather than the bits-ui
  // popup (`$lib/components/ui/select`) because the FIT sport enum has
  // ~75 entries — a native dropdown handles type-ahead and long lists
  // better than a custom popup, and this panel is an out-of-band side
  // concern where a perfect visual match isn't worth the cost.

  /** Camel-case-name → human label, e.g. `"openWater"` → `"Open water"`. */
  function humanize(name: string): string {
    if (!name) return ''
    const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
  }

  function buildOptions(table: Record<number, string>): Array<{ value: string; label: string }> {
    return Object.entries(table)
      .map(([id, name]) => ({ value: String(id), label: humanize(name) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  // Build once at module-load: the SDK enum tables are static.
  const SPORT_OPTIONS = buildOptions(Profile.types.sport as Record<number, string>)
  const SUB_SPORT_OPTIONS = [
    { value: '', label: '— none —' },
    ...buildOptions(Profile.types.subSport as Record<number, string>),
  ]

  export interface FallbackSessionRow {
    fileName: string
    sessionName: string
    sportName: string
    isFallback: boolean
    /** Numeric FIT `sport` enum currently assigned (default: GENERIC). */
    currentSport: number
    /** Numeric FIT `sub_sport` enum currently assigned. */
    currentSubSport?: number
  }

  interface Props {
    sessions: FallbackSessionRow[]
    onChange: (fileName: string, newSport: number, newSubSport?: number) => void
  }

  const { sessions, onChange }: Props = $props()

  const fallbacks = $derived(sessions.filter((s) => s.isFallback))

  let open = $state(false)

  function toggle() {
    open = !open
  }

  function emitSportChange(row: FallbackSessionRow, value: string) {
    const sport = Number(value)
    onChange(row.fileName, sport, row.currentSubSport)
  }

  function emitSubSportChange(row: FallbackSessionRow, value: string) {
    const subSport = value === '' ? undefined : Number(value)
    onChange(row.fileName, row.currentSport, subSport)
  }
</script>

{#if fallbacks.length > 0}
  <Card class="mt-4">
    <button
      type="button"
      class="w-full text-left"
      aria-expanded={open}
      data-testid="sport-override-toggle"
      onclick={toggle}
    >
      <CardHeader class="flex-row items-center justify-between">
        <CardTitle>
          {fallbacks.length} session{fallbacks.length === 1 ? '' : 's'} have unmapped sports — click
          to override
        </CardTitle>
        <span aria-hidden="true" class="text-muted-foreground text-sm">
          {open ? '▾' : '▸'}
        </span>
      </CardHeader>
    </button>
    {#if open}
      <CardContent>
        <ul class="space-y-3" data-testid="sport-override-list">
          {#each fallbacks as row (row.fileName)}
            <li
              class="grid grid-cols-1 gap-2 border-t pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[1fr_auto_auto]"
              data-testid="sport-override-row"
              data-filename={row.fileName}
            >
              <div class="min-w-0">
                <div class="truncate text-sm font-medium" title={row.fileName}>
                  {row.sessionName || row.fileName}
                </div>
                <div class="text-muted-foreground text-xs">
                  Polar name: <span class="font-mono">{row.sportName}</span>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <label
                  class="text-muted-foreground text-xs"
                  for={`sport-${row.fileName}`}
                >
                  FIT Sport
                </label>
                <select
                  id={`sport-${row.fileName}`}
                  aria-label={`FIT Sport for ${row.sessionName || row.fileName}`}
                  value={String(row.currentSport)}
                  onchange={(e) => emitSportChange(row, (e.currentTarget as HTMLSelectElement).value)}
                  class="border-input bg-background ring-offset-background focus:ring-ring h-9 min-w-[10rem] rounded-md border px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
                >
                  {#each SPORT_OPTIONS as opt}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              </div>
              <div class="flex flex-col gap-1">
                <label
                  class="text-muted-foreground text-xs"
                  for={`subsport-${row.fileName}`}
                >
                  FIT SubSport (optional)
                </label>
                <select
                  id={`subsport-${row.fileName}`}
                  aria-label={`FIT SubSport for ${row.sessionName || row.fileName}`}
                  value={row.currentSubSport === undefined ? '' : String(row.currentSubSport)}
                  onchange={(e) => emitSubSportChange(row, (e.currentTarget as HTMLSelectElement).value)}
                  class="border-input bg-background ring-offset-background focus:ring-ring h-9 min-w-[10rem] rounded-md border px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2"
                >
                  {#each SUB_SPORT_OPTIONS as opt}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              </div>
            </li>
          {/each}
        </ul>
      </CardContent>
    {/if}
  </Card>
{/if}
