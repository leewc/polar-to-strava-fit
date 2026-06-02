<!--
  DropZone — single-file picker for the Polar bulk-export ZIP.

  Dumb prop-driven component:
    - `file` is the only state, exposed as `bind:file`.
    - Drag-and-drop OR click-to-pick both write into the same prop.
    - Renders the dashed-border drop target plus a pick button; once `file`
      is non-null, swaps to a tiny summary line ("Selected: name (size)").

  No business logic lives here — the parent App.svelte owns the pipeline.
-->
<script lang="ts">
  import { Card } from '$lib/components/ui/card'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils'

  let { file = $bindable<File | null>(null) }: { file?: File | null } = $props()

  let dragOver = $state(false)
  let inputEl = $state<HTMLInputElement | null>(null)

  function isZip(f: File): boolean {
    // Polar exports are .zip; we accept by extension since some browsers
    // report empty/odd MIME types for zip drops.
    return /\.zip$/i.test(f.name)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    dragOver = false
    const f = e.dataTransfer?.files?.[0]
    if (f && isZip(f)) file = f
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    dragOver = true
  }

  function handleDragLeave() {
    dragOver = false
  }

  function handlePick(e: Event) {
    const target = e.currentTarget as HTMLInputElement
    const f = target.files?.[0] ?? null
    if (f && isZip(f)) file = f
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
</script>

<Card
  class={cn(
    'flex min-h-44 flex-col items-center justify-center gap-3 border-2 border-dashed p-8 text-center transition-colors',
    dragOver ? 'border-primary bg-muted/40' : 'border-border',
  )}
  ondrop={handleDrop}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  data-testid="dropzone"
>
  {#if file}
    <p data-testid="dropzone-file" class="text-sm">
      Selected: <span class="font-medium">{file.name}</span>
      <span class="text-muted-foreground">({formatSize(file.size)})</span>
    </p>
    <Button variant="outline" size="sm" onclick={() => (file = null)}>Choose different ZIP</Button>
  {:else}
    <p class="text-sm text-muted-foreground">
      Drop your Polar bulk-export <code>.zip</code> here, or pick a file.
    </p>
    <Button onclick={() => inputEl?.click()}>Choose ZIP</Button>
  {/if}

  <input
    bind:this={inputEl}
    type="file"
    accept=".zip,application/zip"
    class="hidden"
    onchange={handlePick}
    data-testid="dropzone-input"
  />
</Card>
