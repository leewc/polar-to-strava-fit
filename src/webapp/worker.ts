/**
 * Web Worker entry: receives the user's ZIP file from the main thread,
 * runs the pipeline, and forwards each pipeline event back via
 * `postMessage`. Lives in this directory to satisfy Vite's Web Worker
 * module-syntax convention (`new Worker(new URL('./worker.ts', import.meta.url),
 * { type: 'module' })`).
 *
 * Keeping this file thin — almost all logic lives in `pipeline.ts`. That
 * way `pipeline.ts` is testable in vitest's main-thread environment without
 * spinning up an actual Worker.
 */

/// <reference lib="webworker" />

import { runPipeline, type PipelineEvent } from './pipeline'

/** Message the main thread sends to start a conversion. */
export interface StartMessage {
  type: 'start'
  file: File | Blob
}

/** Message the worker posts back. The pipeline event payload is wrapped
 *  alongside a discriminator so future control messages (`progress`,
 *  `cancel-ack`, …) can coexist without a second channel. */
export type WorkerOutboundMessage =
  | { type: 'event'; event: PipelineEvent }
  | { type: 'fatal'; error: string }

/** Type-narrow for the inbound message. Keeps the runtime robust against
 *  surprise messages from extensions or devtools. */
function isStartMessage(data: unknown): data is StartMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'start' &&
    'file' in data
  )
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.addEventListener('message', (e: MessageEvent) => {
  if (!isStartMessage(e.data)) return
  void run(e.data.file)
})

async function run(file: File | Blob): Promise<void> {
  try {
    for await (const event of runPipeline(file)) {
      const out: WorkerOutboundMessage = { type: 'event', event }
      ctx.postMessage(out)
    }
  } catch (err) {
    const out: WorkerOutboundMessage = {
      type: 'fatal',
      error: err instanceof Error ? err.message : String(err),
    }
    ctx.postMessage(out)
  }
}
