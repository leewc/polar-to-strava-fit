// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import ProgressList from './ProgressList.svelte'

let mounted: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (mounted) {
    unmount(mounted)
    mounted = null
  }
  document.body.innerHTML = ''
})

const sessions = [
  {
    fileName: 'a.json',
    sessionName: 'Run A',
    startTime: '2025-01-01T00:00:00.000',
    sportLabel: 'sport=1',
    durationSec: 600,
    hasGps: true,
  },
  {
    fileName: 'b.json',
    sessionName: 'Run B',
    startTime: '2025-01-02T00:00:00.000',
    sportLabel: 'generic',
    durationSec: 600,
    hasGps: false,
  },
]

describe('ProgressList', () => {
  it('shows ready/total summary and renders a status badge per session', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(ProgressList, {
      target,
      props: {
        sessions,
        progress: { 'a.json': 'ready', 'b.json': 'converting' },
        recordCounts: { 'a.json': 1234, 'b.json': 0 },
      },
    })
    flushSync()

    expect(target.textContent).toContain('Converting 1 / 2')
    expect(target.textContent).toContain('Ready')
    expect(target.textContent).toContain('Converting')
    // Live record count for the ready row.
    expect(target.textContent).toContain('1234 records')
  })

  it('falls back to "Pending" when a session has no entry in progress', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(ProgressList, {
      target,
      props: { sessions, progress: {}, recordCounts: {} },
    })
    flushSync()

    const pending = target.querySelectorAll('[data-testid^="status-"]')
    expect(pending.length).toBe(2)
    expect(target.textContent).toContain('Pending')
  })
})
