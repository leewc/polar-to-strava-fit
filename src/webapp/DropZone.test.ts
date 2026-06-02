// @vitest-environment happy-dom
/**
 * DropZone — minimal mount + interaction smoke test. We're not testing
 * Svelte itself; we just want to assert the component (a) renders the
 * "choose ZIP" affordance when no file is set, and (b) shows the file
 * name once a file prop is supplied.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import DropZone from './DropZone.svelte'

let mounted: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (mounted) {
    unmount(mounted)
    mounted = null
  }
  document.body.innerHTML = ''
})

describe('DropZone', () => {
  it('renders an empty drop target when no file is selected', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(DropZone, { target, props: { file: null } })
    flushSync()

    expect(target.textContent).toMatch(/Drop your Polar bulk-export/i)
    expect(target.querySelector('button')?.textContent).toMatch(/Choose ZIP/i)
  })

  it('renders the selected file name and size when a file is provided', () => {
    const file = new File(['x'.repeat(2048)], 'export.zip', { type: 'application/zip' })
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(DropZone, { target, props: { file } })
    flushSync()

    const summary = target.querySelector('[data-testid="dropzone-file"]')
    expect(summary?.textContent).toContain('export.zip')
    expect(summary?.textContent).toMatch(/KB|B/)
  })
})
