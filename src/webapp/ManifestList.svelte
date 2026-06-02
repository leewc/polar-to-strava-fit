<!--
  ManifestList — per-session preview after the ZIP is unpacked but before
  conversion runs.

  Dumb prop-driven component:
    - `sessions` lists the manifest entries (subset of pipeline.ManifestEntry).
    - `selected` is a `bind:`-able map keyed by `fileName` controlling which
      sessions are queued for conversion.
    - `onconvert` callback fires when the user hits "Convert all →".

  Parent owns the pipeline, the worker, and any persistence; this component
  only renders rows + manages the per-row checkbox state via `bind:selected`.
-->
<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'

  type Session = {
    fileName: string
    sessionName: string
    startTime: string
    sportLabel: string
    durationSec: number
    hasGps: boolean
  }

  let {
    sessions,
    selected = $bindable<Record<string, boolean>>({}),
    onconvert,
  }: {
    sessions: Session[]
    selected?: Record<string, boolean>
    onconvert?: () => void
  } = $props()

  /** Format the Polar local civil-time string ("2025-08-16T17:12:22.000")
   *  as a short, locale-friendly date. We intentionally drop the offset
   *  here — the manifest is a preview, not a precise timestamp. */
  function formatDate(iso: string): string {
    if (!iso) return ''
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
    if (!m) return iso
    const [, y, mo, d, h, mi] = m
    return `${y}-${mo}-${d} ${h}:${mi}`
  }

  function formatDuration(sec: number): string {
    const total = Math.round(sec)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${h}h ${m}m`
    return `${m}m ${s}s`
  }

  let selectedCount = $derived(
    sessions.reduce((n, s) => n + (selected[s.fileName] ? 1 : 0), 0),
  )

  function toggle(fileName: string, checked: boolean | 'indeterminate') {
    selected = { ...selected, [fileName]: checked === true }
  }
</script>

<section data-testid="manifest-list" class="space-y-3">
  <header class="flex items-center justify-between">
    <h2 class="text-lg font-medium">{sessions.length} sessions ready</h2>
    <Button onclick={() => onconvert?.()} disabled={selectedCount === 0}>
      Convert all →
    </Button>
  </header>

  <ul class="divide-y divide-border rounded-md border">
    {#each sessions as s (s.fileName)}
      <li class="flex items-center gap-3 px-3 py-2 text-sm">
        <Checkbox
          checked={selected[s.fileName] ?? false}
          onCheckedChange={(c) => toggle(s.fileName, c)}
          aria-label={`Select ${s.sessionName}`}
        />
        <span class="text-muted-foreground tabular-nums">{formatDate(s.startTime)}</span>
        <Badge variant="secondary">{s.sportLabel}</Badge>
        <span aria-label={s.hasGps ? 'has GPS' : 'no GPS'}>{s.hasGps ? '📍' : '—'}</span>
        <span class="tabular-nums">{formatDuration(s.durationSec)}</span>
        <span class="ml-auto truncate text-muted-foreground" title={s.sessionName}>
          {s.sessionName}
        </span>
      </li>
    {/each}
  </ul>
</section>
