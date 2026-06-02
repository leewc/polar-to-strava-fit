// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import DownloadPanel from './DownloadPanel.svelte'

let mounted: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (mounted) {
    unmount(mounted)
    mounted = null
  }
  document.body.innerHTML = ''
})

describe('DownloadPanel', () => {
  it('disables the bulk download button when no blob is ready', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(DownloadPanel, {
      target,
      props: { outFitBlob: null, sessions: [], warningCount: 0 },
    })
    flushSync()

    const allBtn = target.querySelector('[data-testid="download-all"]') as HTMLButtonElement
    expect(allBtn).toBeTruthy()
    expect(allBtn.disabled).toBe(true)
  })

  it('renders one download row per session and shows warning count', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/zip' })
    const sessions = [
      { fileName: '2025-01-01-Run.fit', bytes: new Uint8Array([1, 2, 3]) },
      { fileName: '2025-01-02-Run.fit', bytes: new Uint8Array([4, 5, 6]) },
    ]
    mounted = mount(DownloadPanel, {
      target,
      props: { outFitBlob: blob, sessions, warningCount: 1 },
    })
    flushSync()

    expect(target.querySelectorAll('li').length).toBe(2)
    expect(target.textContent).toContain('1 session flagged with warnings')
    expect(target.querySelector('[data-testid="copy-strava-url"]')).toBeTruthy()
    expect(target.textContent).toContain('https://www.strava.com/upload/select')
  })
})
