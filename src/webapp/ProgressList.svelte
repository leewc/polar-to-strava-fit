<!--
  ProgressList — live conversion status board. Driven by parent state that
  updates in response to pipeline events (`session-start`, `session-done`,
  `session-error`, plus a parent-derived `warning` flag from the validation
  report).

  Dumb prop-driven component:
    - `sessions` is the same manifest snapshot used by ManifestList.
    - `progress` maps fileName → status enum.
    - `recordCounts` maps fileName → record count from session-done's report.
-->
<script lang="ts">
  import { Progress } from '$lib/components/ui/progress'
  import { Badge } from '$lib/components/ui/badge'

  type Status = 'pending' | 'converting' | 'ready' | 'warning' | 'error'

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
    progress,
    recordCounts,
  }: {
    sessions: Session[]
    progress: Record<string, Status>
    recordCounts: Record<string, number>
  } = $props()

  const VARIANT: Record<Status, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    pending: 'outline',
    converting: 'secondary',
    ready: 'default',
    warning: 'secondary',
    error: 'destructive',
  }

  const LABEL: Record<Status, string> = {
    pending: 'Pending',
    converting: 'Converting…',
    ready: 'Ready',
    warning: 'Warning',
    error: 'Error',
  }

  function statusOf(fileName: string): Status {
    return progress[fileName] ?? 'pending'
  }

  let readyCount = $derived(
    sessions.reduce((n, s) => {
      const st = statusOf(s.fileName)
      return n + (st === 'ready' || st === 'warning' ? 1 : 0)
    }, 0),
  )

  let total = $derived(sessions.length)
</script>

<section data-testid="progress-list" class="space-y-3">
  <header class="flex items-center justify-between text-sm">
    <span class="font-medium">Converting {readyCount} / {total}</span>
  </header>

  <Progress value={readyCount} max={Math.max(total, 1)} />

  <ul class="divide-y divide-border rounded-md border">
    {#each sessions as s (s.fileName)}
      {@const st = statusOf(s.fileName)}
      <li class="flex items-center gap-3 px-3 py-2 text-sm">
        <Badge variant={VARIANT[st]} data-testid={`status-${s.fileName}`}>{LABEL[st]}</Badge>
        <span class="truncate" title={s.sessionName}>{s.sessionName}</span>
        {#if st === 'ready' || st === 'warning'}
          <span class="ml-auto text-muted-foreground tabular-nums" data-testid="record-count">
            {recordCounts[s.fileName] ?? 0} records
          </span>
        {/if}
      </li>
    {/each}
  </ul>
</section>
