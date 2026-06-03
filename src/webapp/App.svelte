<!--
  Top-level wizard component for the polar-to-strava-fit static webapp.

  The page is a vertical stack of FIVE stages. Each stage carries one of
  three states:
    - completed → shows a one-line summary (✓), click header to re-expand
    - active    → expanded with full detail (▼)
    - pending   → dimmed (◯)

  Stage 1: ZIP loaded             — DropZone (drag-drop / click-to-pick file)
  Stage 2: Sessions found         — ManifestList (per-session checkbox + sport)
  Stage 3: Converting…            — ProgressList (live per-row status)
  Stage 4: Validating             — per-row validation report (Alert on warn)
  Stage 5: Download               — DownloadPanel (zip-all + per-row .fit)

  Privacy footer is always visible.

  Wiring:
    - The Web Worker from `./worker.ts` runs `runPipeline()` off-main-thread.
    - `worker.postMessage({ type: 'start', file })` kicks the conversion.
    - `worker.onmessage` events are forwarded into reactive `$state` here so
      Svelte re-renders each stage as data flows in.

  Integration note (T9-A, T10-A): the per-stage UI is currently rendered
  inline so this commit type-checks standalone. When T9-A's row components
  land (DropZone, ManifestList, ProgressList, DownloadPanel) and T10-A's
  SportOverridePanel lands, the inline blocks below are swapped out for
  `<DropZone bind:file />`, `<ManifestList sessions … bind:selected />`,
  `<ProgressList sessions={…} progress={…} />`, `<DownloadPanel … />`, and
  `<SportOverridePanel … />` respectively. The state shapes here already
  match those components' props, so the swap is mechanical.
-->

<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import type { ManifestEntry, PipelineEvent } from './pipeline'
  import type { ValidationReport } from '@validate/checks'
  import * as Card from '$lib/components/ui/card'
  import { Button } from '$lib/components/ui/button'
  import { Progress } from '$lib/components/ui/progress'
  import { Badge } from '$lib/components/ui/badge'
  import * as Alert from '$lib/components/ui/alert'
  import {
    Check,
    ChevronDown,
    Circle,
    Loader2,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Download,
    Copy,
    Upload,
    MapPin,
    Dumbbell,
    RotateCcw,
    Sparkles,
  } from 'lucide-svelte'

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------
  // We track the stage as a numeric `currentStage` plus per-stage flags so
  // collapsed-completed vs expanded-active can be derived. Keeping it numeric
  // (rather than an enum) keeps the "current >= n means n is done/active"
  // arithmetic simple in the markup.

  /** 1..5; the stage currently expanded. Stages with index < current are
   *  completed (✓). Stages with index > current are pending (◯). */
  let currentStage = $state<1 | 2 | 3 | 4 | 5>(1)

  /** ZIP file the user dropped; `null` until they pick one. */
  let file = $state<File | null>(null)

  /** Manifest sessions parsed from the ZIP (stage 2 input). */
  let manifest = $state<ManifestEntry[]>([])

  /** Have we received the `manifest` event yet? Lets us distinguish the
   *  "still parsing" state from "parsed but found zero sessions". */
  let manifestReceived = $state(false)

  /** Selected file names — for now everything is selected; UI wires this in
   *  when ManifestList lands. The ZIP packs everything that completes. */
  let selected = $state<Set<string>>(new Set())

  /** Per-session conversion status (stage 3). Keyed by ZIP entry name. */
  let progress = $state<
    Record<
      string,
      {
        status: 'pending' | 'converting' | 'ready' | 'error'
        bytes?: Uint8Array
        report?: ValidationReport
        error?: string
      }
    >
  >({})

  /** Final ZIP-of-FITs blob, populated once the worker emits `all-done`. */
  let outFitBlob = $state<Blob | null>(null)
  /** Aggregate counts surfaced in the download stage summary. */
  let allDoneSummary = $state<{ sessionCount: number; warningCount: number } | null>(
    null,
  )
  /** Worker fatal error, if any. */
  let fatalError = $state<string | null>(null)

  // ---------------------------------------------------------------------------
  // Worker plumbing
  // ---------------------------------------------------------------------------
  // Lazily create the worker on first file pick. We could spin it at mount,
  // but staying lazy keeps the empty-state minimal (no idle worker if the
  // user navigates away).

  let worker: Worker | null = null

  function ensureWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'event'; event: PipelineEvent }
        | { type: 'fatal'; error: string }
      if (msg.type === 'fatal') {
        fatalError = msg.error
        return
      }
      handleEvent(msg.event)
    }
    return worker
  }

  function handleEvent(event: PipelineEvent): void {
    switch (event.kind) {
      case 'manifest': {
        manifest = event.sessions
        manifestReceived = true
        // Default-select every session — matches the manifest stage UX
        // ("29 sessions ready. Convert all →").
        selected = new Set(event.sessions.map((s) => s.fileName))
        // Pre-seed pending status for each row.
        const seed: typeof progress = {}
        for (const s of event.sessions) {
          seed[s.fileName] = { status: 'pending' }
        }
        progress = seed
        // Stage 2 active.
        currentStage = 2
        // Conversion kicks off immediately in the worker, so we move to
        // stage 3 the moment the first session-start arrives — see below.
        break
      }
      case 'session-start': {
        progress = {
          ...progress,
          [event.fileName]: { ...progress[event.fileName], status: 'converting' },
        }
        if (currentStage < 3) currentStage = 3
        break
      }
      case 'session-done': {
        progress = {
          ...progress,
          [event.fileName]: {
            status: 'ready',
            bytes: event.bytes,
            report: event.report,
          },
        }
        break
      }
      case 'session-error': {
        progress = {
          ...progress,
          [event.fileName]: { status: 'error', error: event.error },
        }
        break
      }
      case 'all-done': {
        outFitBlob = event.outFitBlob
        allDoneSummary = {
          sessionCount: event.sessionCount,
          warningCount: event.warningCount,
        }
        // Validation is computed inline during conversion (the pipeline
        // already runs `decodeAndAssertStructure` + `conservationReport`),
        // so by all-done we have everything for stages 4 & 5. Jump to 5 —
        // stage 4's content is rendered alongside stage 3 for now (see the
        // "validation" block in the active stage 3 markup); when the
        // dedicated validate stage is broken out, we'll pause on 4 first.
        currentStage = 5
        break
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Stage transitions
  // ---------------------------------------------------------------------------

  function onFilePicked(picked: File): void {
    file = picked
    fatalError = null
    outFitBlob = null
    allDoneSummary = null
    manifest = []
    manifestReceived = false
    progress = {}
    selected = new Set()
    const w = ensureWorker()
    w.postMessage({ type: 'start', file: picked })
    // Stage 1 is now complete; the manifest event will move us to 2.
    currentStage = 2
  }

  /** Reset everything back to stage 1 so the user can drop a different ZIP.
   *  Also tears down the worker — a fresh one spawns on the next file pick.
   *  Object URLs from the previous run are revoked by the existing $effects
   *  via the `outFitBlob`/`progress` state changes. */
  function startOver(): void {
    file = null
    fatalError = null
    outFitBlob = null
    allDoneSummary = null
    manifest = []
    manifestReceived = false
    progress = {}
    selected = new Set()
    if (worker) {
      worker.terminate()
      worker = null
    }
    currentStage = 1
  }

  /** File-input handler used by the inline drop zone. */
  function handleInputChange(e: Event): void {
    const target = e.target as HTMLInputElement
    const f = target.files?.[0]
    if (f) onFilePicked(f)
  }

  /** Drag-and-drop handler used by the inline drop zone. */
  function handleDrop(e: DragEvent): void {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (f) onFilePicked(f)
  }

  /** "Try with sample data" CTA. Fetches the bundled, fully-anonymized
   *  Polar export (5 Running + 2 indoor sessions, including one with a known
   *  GPS teleport so the warning UI is exercised), wraps it as a `File`, and
   *  feeds it through the same `onFilePicked` path as a real drop. The
   *  `import.meta.url`-relative URL keeps it correct under any base path —
   *  GitHub Pages serves the deploy at `/polar-to-strava-fit/` rather than `/`. */
  let sampleLoading = $state(false)
  let sampleError = $state<string | null>(null)
  async function loadSample(): Promise<void> {
    if (sampleLoading) return
    sampleLoading = true
    sampleError = null
    try {
      const url = new URL('./sample-polar-export.zip', import.meta.url)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`)
      const blob = await res.blob()
      const f = new File([blob], 'polar-export-sample.zip', {
        type: 'application/zip',
      })
      onFilePicked(f)
    } catch (err) {
      sampleError = err instanceof Error ? err.message : String(err)
    } finally {
      sampleLoading = false
    }
  }

  /** Click-to-collapse: jump back to a completed stage to inspect it. */
  function reexpand(stage: 1 | 2 | 3 | 4 | 5): void {
    if (stage < currentStage) currentStage = stage
  }

  // ---------------------------------------------------------------------------
  // Derived: stage state helpers
  // ---------------------------------------------------------------------------

  const stage1State = $derived(currentStage > 1 ? 'completed' : 'active')
  const stage2State = $derived(
    currentStage === 2 ? 'active' : currentStage > 2 ? 'completed' : 'pending',
  )
  const stage3State = $derived(
    currentStage === 3 ? 'active' : currentStage > 3 ? 'completed' : 'pending',
  )
  const stage4State = $derived(
    currentStage === 4 ? 'active' : currentStage > 4 ? 'completed' : 'pending',
  )
  const stage5State = $derived(currentStage === 5 ? 'active' : 'pending')

  /** Per-session count summary used in the converting-stage progress bar. */
  const progressSummary = $derived.by(() => {
    const values = Object.values(progress)
    const total = manifest.length || values.length
    const done = values.filter((v) => v.status === 'ready' || v.status === 'error').length
    const warning = values.filter(
      (v) => v.status === 'ready' && v.report && !v.report.ok,
    ).length
    return { total, done, warning }
  })

  /** Sessions with non-`ok` validation reports (stage 4). */
  const warnings = $derived.by(() =>
    Object.entries(progress)
      .filter(([, v]) => v.status === 'ready' && v.report && !v.report.ok)
      .map(([fileName, v]) => ({ fileName, report: v.report! })),
  )

  /** Object URL for the final ZIP-of-FITs. Stable across re-renders. */
  let outFitUrl = $state<string | null>(null)
  $effect(() => {
    // Revoke previous URL when the blob changes; create a new one. Keeps
    // memory tidy if the user re-runs against another ZIP.
    if (!outFitBlob) {
      if (outFitUrl) URL.revokeObjectURL(outFitUrl)
      outFitUrl = null
      return
    }
    const url = URL.createObjectURL(outFitBlob)
    outFitUrl = url
    return () => {
      URL.revokeObjectURL(url)
    }
  })

  /** Per-session object URLs for individual .fit downloads. Each ready row
   *  gets its own URL; revoked when the row's bytes change. */
  let perFileUrls = $state<Record<string, string>>({})
  $effect(() => {
    const next: Record<string, string> = {}
    for (const [fileName, v] of Object.entries(progress)) {
      if (v.status === 'ready' && v.bytes) {
        // The pipeline pre-allocates a fresh ArrayBuffer; safe to wrap.
        const blob = new Blob([v.bytes.buffer.slice(v.bytes.byteOffset, v.bytes.byteOffset + v.bytes.byteLength) as ArrayBuffer], {
          type: 'application/octet-stream',
        })
        next[fileName] = URL.createObjectURL(blob)
      }
    }
    // Revoke any stale URLs from the previous snapshot. Use untrack() so
    // reading `perFileUrls` here doesn't make this effect a dependency on
    // its own output — without it we get an infinite update loop the
    // moment we write `perFileUrls = next` below.
    untrack(() => {
      for (const [k, oldUrl] of Object.entries(perFileUrls)) {
        if (next[k] !== oldUrl) URL.revokeObjectURL(oldUrl)
      }
    })
    perFileUrls = next
  })

  // ---------------------------------------------------------------------------
  // Cleanup on unmount: terminate the worker so it doesn't leak.
  // ---------------------------------------------------------------------------
  onDestroy(() => {
    worker?.terminate()
    worker = null
    if (outFitUrl) URL.revokeObjectURL(outFitUrl)
    for (const url of Object.values(perFileUrls)) URL.revokeObjectURL(url)
    if (copyResetTimer) clearTimeout(copyResetTimer)
  })

  // ---------------------------------------------------------------------------
  // Tiny formatters used by inline rendering. All pure.
  // ---------------------------------------------------------------------------
  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  function fmtDuration(sec: number): string {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    if (h > 0) return `${h}h ${m}m ${s}s`
    return `${m}m ${s}s`
  }
  function fmtDate(s: string): string {
    return s ? s.slice(0, 10) : ''
  }

  // ---------------------------------------------------------------------------
  // Copy-to-clipboard for the Strava upload URL.
  // ---------------------------------------------------------------------------
  let stravaUrlCopied = $state(false)
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null
  async function copyStravaUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText('https://www.strava.com/upload/select')
      stravaUrlCopied = true
      if (copyResetTimer) clearTimeout(copyResetTimer)
      copyResetTimer = setTimeout(() => {
        stravaUrlCopied = false
      }, 1500)
    } catch {
      // Clipboard unavailable (e.g. insecure context); silently no-op — the
      // visible link is still right there for the user to copy manually.
    }
  }
</script>

<main class="mx-auto max-w-3xl p-6 sm:p-10 space-y-6">
  <header class="flex items-start justify-between gap-4">
    <div>
      <h1 class="text-3xl font-semibold tracking-tight">Polar → Strava</h1>
      <p class="mt-1 text-muted-foreground">
        Convert your Polar export to Strava-ready FIT — locally in your browser.
      </p>
    </div>
    {#if file !== null}
      <Button variant="ghost" size="sm" onclick={startOver} class="shrink-0">
        <RotateCcw class="size-4 mr-1" aria-hidden="true" />
        Start over
      </Button>
    {/if}
  </header>

  {#if fatalError}
    <Alert.Root variant="destructive">
      <Alert.Title>Conversion failed</Alert.Title>
      <Alert.Description>{fatalError}</Alert.Description>
    </Alert.Root>
  {/if}

  <!-- ────────────────────────────── STAGE 1 ────────────────────────────── -->
  <Card.Root>
    <Card.Header>
      <button
        type="button"
        class="flex w-full items-center justify-between text-left"
        onclick={() => reexpand(1)}
      >
        <Card.Title class="flex items-center gap-2">
          {#if stage1State === 'completed'}
            <Check class="size-4 text-emerald-600" aria-hidden="true" />
          {:else if stage1State === 'active'}
            <ChevronDown class="size-4" aria-hidden="true" />
          {:else}
            <Circle class="size-4 text-muted-foreground" aria-hidden="true" />
          {/if}
          1. ZIP loaded
        </Card.Title>
        {#if stage1State === 'completed' && file}
          <span class="text-sm text-muted-foreground">
            {file.name} · {fmtSize(file.size)}
          </span>
        {/if}
      </button>
    </Card.Header>
    {#if stage1State === 'active'}
      <Card.Content>
        <!-- Inline drop-zone; T9-A's <DropZone bind:file /> swaps in here. -->
        <label
          ondrop={handleDrop}
          ondragover={(e) => e.preventDefault()}
          class="flex h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 text-center transition-colors hover:border-primary/40 hover:bg-muted/50"
        >
          <Upload class="mb-2 size-8 text-muted-foreground" aria-hidden="true" />
          <span class="text-base font-medium">Drop your Polar export ZIP here</span>
          <span class="mt-1 text-sm text-muted-foreground">or click to browse</span>
          <input
            type="file"
            accept=".zip,application/zip"
            class="hidden"
            onchange={handleInputChange}
          />
        </label>
        <!-- T15: subordinate CTA below the drop zone. The sample is a
             pre-anonymized 7-session Polar export bundled at build time;
             clicking this is a one-click demo of the entire pipeline. -->
        <div class="mt-3 flex flex-col items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onclick={loadSample}
            disabled={sampleLoading}
          >
            <Sparkles class="size-4 mr-1.5" aria-hidden="true" />
            {sampleLoading ? 'Loading sample…' : 'Try with sample data →'}
          </Button>
          <span class="text-xs text-muted-foreground">
            7 anonymized sessions (5 runs + 2 indoor)
          </span>
          {#if sampleError}
            <span class="text-xs text-destructive">Could not load sample: {sampleError}</span>
          {/if}
        </div>
      </Card.Content>
    {/if}
  </Card.Root>

  <!-- ────────────────────────────── STAGE 2 ────────────────────────────── -->
  <Card.Root class={stage2State === 'pending' ? 'opacity-50' : ''}>
    <Card.Header>
      <button
        type="button"
        class="flex w-full items-center justify-between text-left"
        onclick={() => reexpand(2)}
        disabled={stage2State === 'pending'}
      >
        <Card.Title class="flex items-center gap-2">
          {#if stage2State === 'completed'}
            <Check class="size-4 text-emerald-600" aria-hidden="true" />
          {:else if stage2State === 'active'}
            <ChevronDown class="size-4" aria-hidden="true" />
          {:else}
            <Circle class="size-4 text-muted-foreground" aria-hidden="true" />
          {/if}
          2. {manifest.length > 0 ? `${manifest.length} sessions found` : 'Sessions found'}
        </Card.Title>
        {#if stage2State === 'completed'}
          <span class="text-sm text-muted-foreground">{selected.size} selected</span>
        {/if}
      </button>
    </Card.Header>
    {#if stage2State === 'active'}
      <Card.Content>
        {#if !manifestReceived}
          <!-- Pipeline is parsing the ZIP; manifest event hasn't arrived yet. -->
          <div class="flex items-center gap-3 py-4 text-sm text-muted-foreground">
            <span class="inline-block h-3 w-3 animate-pulse rounded-full bg-current" aria-hidden="true"></span>
            Reading ZIP…
          </div>
        {:else if manifest.length === 0}
          <!-- Manifest came back empty. Most common cause: the ZIP isn't a Polar bulk export. -->
          <div class="space-y-3 rounded-md border border-dashed border-border bg-muted/30 p-4 text-sm">
            <p class="font-medium">No training sessions found in this ZIP.</p>
            <p class="text-muted-foreground">
              This converter looks for entries named
              <code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">training-session-*.json</code>
              — the format Polar Flow uses in its bulk-export ZIP. If you uploaded a different kind of file,
              try downloading your data again from
              <a class="underline" href="https://flow.polar.com/" target="_blank" rel="noreferrer">flow.polar.com</a>
              under <em>Settings → Account → Export training data</em>.
            </p>
            <div class="flex justify-end">
              <Button onclick={startOver}>← Try a different file</Button>
            </div>
          </div>
        {:else}
          <!-- Inline manifest list; T9-A's <ManifestList sessions={…} bind:selected />
               swaps in here. -->
          <ul class="divide-y divide-border rounded-md border">
            {#each manifest as entry (entry.fileName)}
              <li class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div class="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.fileName)}
                    onchange={(e) => {
                      const next = new Set(selected)
                      if ((e.target as HTMLInputElement).checked) next.add(entry.fileName)
                      else next.delete(entry.fileName)
                      selected = next
                    }}
                    aria-label="Include {entry.fileName}"
                  />
                  <span class="font-mono text-xs text-muted-foreground">
                    {fmtDate(entry.startTime)}
                  </span>
                  <Badge variant="secondary">{entry.sportLabel}</Badge>
                  <span class="truncate">{entry.sessionName}</span>
                  <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{fmtDuration(entry.durationSec)}</span>
                    <span aria-hidden="true">·</span>
                    {#if entry.hasGps}
                      <MapPin
                        class="size-3.5 text-muted-foreground"
                        aria-label="GPS"
                      />
                    {:else}
                      <Dumbbell
                        class="size-3.5 text-muted-foreground"
                        aria-label="Indoor"
                      />
                    {/if}
                  </span>
                </div>
              </li>
            {/each}
          </ul>
          <div class="mt-4 flex justify-between gap-3">
            <Button variant="ghost" onclick={startOver}>← Use a different file</Button>
            <Button onclick={() => (currentStage = 3)}>
              Convert {selected.size} →
            </Button>
          </div>
        {/if}
      </Card.Content>
    {/if}
  </Card.Root>

  <!-- ────────────────────────────── STAGE 3 ────────────────────────────── -->
  <Card.Root class={stage3State === 'pending' ? 'opacity-50' : ''}>
    <Card.Header>
      <button
        type="button"
        class="flex w-full items-center justify-between text-left"
        onclick={() => reexpand(3)}
        disabled={stage3State === 'pending'}
      >
        <Card.Title class="flex items-center gap-2">
          {#if stage3State === 'completed'}
            <Check class="size-4 text-emerald-600" aria-hidden="true" />
          {:else if stage3State === 'active'}
            <ChevronDown class="size-4" aria-hidden="true" />
          {:else}
            <Circle class="size-4 text-muted-foreground" aria-hidden="true" />
          {/if}
          3. Converting{stage3State === 'active' ? '…' : ''}
        </Card.Title>
        {#if stage3State === 'completed'}
          <span class="text-sm text-muted-foreground">
            {progressSummary.done}/{progressSummary.total} done
          </span>
        {/if}
      </button>
    </Card.Header>
    {#if stage3State === 'active' || stage3State === 'completed'}
      <Card.Content>
        <Progress
          value={progressSummary.done}
          max={Math.max(1, progressSummary.total)}
        />
        <p class="mt-2 text-sm text-muted-foreground">
          {progressSummary.done} / {progressSummary.total}
          {#if progressSummary.warning > 0}
            · <span class="text-amber-600">{progressSummary.warning} warning{progressSummary.warning === 1 ? '' : 's'}</span>
          {/if}
        </p>
        <!-- Inline progress list; T9-A's <ProgressList sessions={…} progress={…} /> swaps in here. -->
        <ul class="mt-3 space-y-1 text-sm">
          {#each manifest as entry (entry.fileName)}
            {@const p = progress[entry.fileName]}
            <li class="flex items-center justify-between gap-2">
              <span class="flex items-center gap-2">
                {#if p?.status === 'converting'}
                  <Loader2 class="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                {:else if p?.status === 'ready' && p.report && !p.report.ok}
                  <AlertTriangle class="size-4 text-amber-600" aria-hidden="true" />
                {:else if p?.status === 'ready'}
                  <CheckCircle2 class="size-4 text-emerald-600" aria-hidden="true" />
                {:else if p?.status === 'error'}
                  <XCircle class="size-4 text-destructive" aria-hidden="true" />
                {:else}
                  <Circle class="size-4 text-muted-foreground" aria-hidden="true" />
                {/if}
                <span class="font-mono text-xs text-muted-foreground">
                  {fmtDate(entry.startTime)}
                </span>
                <span>{entry.sessionName}</span>
              </span>
              {#if p?.status === 'ready' && p.report}
                <span class="text-xs text-muted-foreground">
                  {p.report.recordCount} records
                </span>
              {:else if p?.status === 'error'}
                <span class="text-xs text-destructive">{p.error}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </Card.Content>
    {/if}
  </Card.Root>

  <!-- ────────────────────────────── STAGE 4 ────────────────────────────── -->
  <Card.Root class={stage4State === 'pending' ? 'opacity-50' : ''}>
    <Card.Header>
      <button
        type="button"
        class="flex w-full items-center justify-between text-left"
        onclick={() => reexpand(4)}
        disabled={stage4State === 'pending'}
      >
        <Card.Title class="flex items-center gap-2">
          {#if stage4State === 'completed'}
            <Check class="size-4 text-emerald-600" aria-hidden="true" />
          {:else if stage4State === 'active'}
            <ChevronDown class="size-4" aria-hidden="true" />
          {:else}
            <Circle class="size-4 text-muted-foreground" aria-hidden="true" />
          {/if}
          4. Validating
        </Card.Title>
        {#if stage4State === 'completed'}
          <span class="text-sm text-muted-foreground">
            {warnings.length === 0 ? 'all clean' : `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
          </span>
        {/if}
      </button>
    </Card.Header>
    {#if stage4State === 'active' || (stage4State === 'completed' && warnings.length > 0)}
      <Card.Content class="space-y-2">
        {#if warnings.length === 0}
          <p class="text-sm text-muted-foreground">
            All conversions passed conservation checks (distance, duration, sport).
          </p>
        {:else}
          {#each warnings as w (w.fileName)}
            <Alert.Root
              variant={w.report.gpsReport?.severity === 'severe' ? 'destructive' : 'default'}
            >
              <Alert.Title class="flex items-center gap-2">
                <AlertTriangle class="size-4" aria-hidden="true" />
                {w.fileName.replace(/^.*\//, '')}
              </Alert.Title>
              <Alert.Description>
                <ul class="list-disc pl-5">
                  {#each w.report.warnings as msg}
                    <li>{msg}</li>
                  {/each}
                </ul>
              </Alert.Description>
            </Alert.Root>
          {/each}
        {/if}
      </Card.Content>
    {/if}
  </Card.Root>

  <!-- ────────────────────────────── STAGE 5 ────────────────────────────── -->
  <Card.Root class={stage5State === 'pending' ? 'opacity-50' : ''}>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        {#if stage5State === 'active'}
          <ChevronDown class="size-4" aria-hidden="true" />
        {:else}
          <Circle class="size-4 text-muted-foreground" aria-hidden="true" />
        {/if}
        5. Download
      </Card.Title>
    </Card.Header>
    {#if stage5State === 'active' && outFitUrl}
      <Card.Content class="space-y-3">
        <!-- Inline download panel; T9-A's <DownloadPanel blob={…} sessions={…} /> swaps in. -->
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="font-medium">
              {allDoneSummary?.sessionCount ?? 0} FIT files ready
            </p>
            <p class="text-sm text-muted-foreground inline-flex items-center gap-2 flex-wrap">
              <span>Upload at</span>
              <a
                href="https://www.strava.com/upload/select"
                target="_blank"
                rel="noopener noreferrer"
                class="underline"
              >
                strava.com/upload/select
              </a>
              <button
                type="button"
                onclick={copyStravaUrl}
                class="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs hover:bg-muted"
                aria-label="Copy Strava upload URL"
                title="Copy Strava upload URL"
              >
                <Copy class="size-3" aria-hidden="true" />
                <span>{stravaUrlCopied ? 'Copied' : 'Copy'}</span>
              </button>
            </p>
          </div>
          <Button>
            <a
              href={outFitUrl}
              download="polar-to-strava-fit-export.zip"
              class="inline-flex items-center gap-2"
            >
              <Download class="size-4" aria-hidden="true" />
              Download all as ZIP
            </a>
          </Button>
        </div>

        <details class="rounded-md border bg-muted/20 p-3 text-sm">
          <summary class="cursor-pointer">Individual files</summary>
          <ul class="mt-2 space-y-1">
            {#each Object.entries(perFileUrls) as [name, url] (name)}
              <li class="flex items-center justify-between gap-2">
                <span class="truncate">{name.replace(/^.*\//, '')}</span>
                <a
                  href={url}
                  download={name.replace(/^.*\//, '').replace(/\.json$/i, '.fit')}
                  class="text-primary underline"
                >
                  download
                </a>
              </li>
            {/each}
          </ul>
        </details>
      </Card.Content>
    {/if}
  </Card.Root>

  <!-- ─────────────────────────── PRIVACY FOOTER ────────────────────────── -->
  <footer class="pt-4 text-center text-xs text-muted-foreground">
    Your data never leaves your browser. No uploads. No analytics. Verify in DevTools.
  </footer>
</main>
