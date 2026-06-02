// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import ManifestList from './ManifestList.svelte'

let mounted: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (mounted) {
    unmount(mounted)
    mounted = null
  }
  document.body.innerHTML = ''
})

const sample = [
  {
    fileName: 'training-session-1.json',
    sessionName: 'Morning run',
    startTime: '2025-08-16T07:14:22.000',
    sportLabel: 'sport=1',
    durationSec: 3725,
    hasGps: true,
  },
  {
    fileName: 'training-session-2.json',
    sessionName: 'Other indoor',
    startTime: '2022-06-18T18:50:02.000',
    sportLabel: 'generic',
    durationSec: 71,
    hasGps: false,
  },
]

describe('ManifestList', () => {
  it('renders header with session count and the convert button', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(ManifestList, {
      target,
      props: { sessions: sample, selected: { 'training-session-1.json': true } },
    })
    flushSync()

    expect(target.textContent).toContain('2 sessions ready')
    const buttons = Array.from(target.querySelectorAll('button'))
    const convertBtn = buttons.find((b) => /Convert all/i.test(b.textContent ?? ''))
    expect(convertBtn).toBeDefined()
    // With one selected session the convert button must not be disabled.
    expect(convertBtn?.disabled).toBe(false)
  })

  it('renders a row per session with sport label and duration', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(ManifestList, { target, props: { sessions: sample } })
    flushSync()

    const items = target.querySelectorAll('li')
    expect(items.length).toBe(2)
    expect(target.textContent).toContain('Morning run')
    expect(target.textContent).toContain('1h 2m')
    expect(target.textContent).toContain('Other indoor')
    expect(target.textContent).toContain('1m 11s')
    // GPS marker present on the GPS row
    expect(target.textContent).toContain('📍')
  })
})
