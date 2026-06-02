<!--
  DownloadPanel — final stage of the wizard. Renders:
    - one big "Download all as ZIP" button (uses `outFitBlob`),
    - per-session download buttons (each gets its own object URL),
    - and a small "Copy upload URL" affordance for Strava bulk upload.

  Dumb prop-driven component:
    - `outFitBlob`, `sessions`, `warningCount` are passed in.
    - The component itself owns only ephemeral UI state (the "Copied!"
      tooltip flag), object URLs created on demand, and the timer that
      hides the tooltip.
-->
<script lang="ts">
  import { Button } from '$lib/components/ui/button'

  type SessionFile = { fileName: string; bytes: Uint8Array }

  let {
    outFitBlob,
    sessions,
    warningCount,
  }: {
    outFitBlob: Blob | null
    sessions: SessionFile[]
    warningCount: number
  } = $props()

  let copied = $state(false)
  const STRAVA_UPLOAD_URL = 'https://www.strava.com/upload/select'

  /** Trigger a browser download by clicking a synthetic anchor. We revoke
   *  the object URL on the next macrotask so the browser has time to start
   *  the download before the URL is freed. */
  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function downloadAll() {
    if (!outFitBlob) return
    downloadBlob(outFitBlob, 'polar-to-strava-fit-export.zip')
  }

  function downloadOne(s: SessionFile) {
    // Wrap the bytes in a fresh ArrayBuffer-backed view to satisfy strict
    // BlobPart typing under modern lib.dom (same dance as the pipeline).
    const ab = new ArrayBuffer(s.bytes.byteLength)
    new Uint8Array(ab).set(s.bytes)
    const blob = new Blob([ab], { type: 'application/octet-stream' })
    downloadBlob(blob, s.fileName)
  }

  async function copyUploadUrl() {
    try {
      await navigator.clipboard.writeText(STRAVA_UPLOAD_URL)
    } catch {
      // Clipboard API can fail in non-secure contexts / older browsers; we
      // fall back to a hidden text-area + execCommand. Keeps the demo robust
      // when served from `file://` during development.
      const ta = document.createElement('textarea')
      ta.value = STRAVA_UPLOAD_URL
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* noop */
      }
      document.body.removeChild(ta)
    }
    copied = true
    setTimeout(() => {
      copied = false
    }, 1500)
  }
</script>

<section data-testid="download-panel" class="space-y-4">
  <div class="flex flex-col gap-2">
    <Button onclick={downloadAll} disabled={!outFitBlob} data-testid="download-all">
      Download all as ZIP
    </Button>
    {#if warningCount > 0}
      <p class="text-xs text-muted-foreground">
        {warningCount} session{warningCount === 1 ? '' : 's'} flagged with warnings — review before uploading.
      </p>
    {/if}
  </div>

  {#if sessions.length > 0}
    <ul class="divide-y divide-border rounded-md border">
      {#each sessions as s (s.fileName)}
        <li class="flex items-center gap-3 px-3 py-2 text-sm">
          <span class="truncate" title={s.fileName}>{s.fileName}</span>
          <Button
            variant="outline"
            size="sm"
            class="ml-auto"
            onclick={() => downloadOne(s)}
            data-testid={`download-${s.fileName}`}
          >
            Download .fit
          </Button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="relative flex items-center gap-2">
    <Button variant="outline" size="sm" onclick={copyUploadUrl} data-testid="copy-strava-url">
      Copy Strava upload URL
    </Button>
    <code class="text-xs text-muted-foreground">{STRAVA_UPLOAD_URL}</code>
    {#if copied}
      <span
        role="status"
        class="absolute -top-7 left-0 rounded bg-foreground px-2 py-1 text-xs text-background shadow"
        data-testid="copied-tooltip"
      >
        Copied!
      </span>
    {/if}
  </div>
</section>
