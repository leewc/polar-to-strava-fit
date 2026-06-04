// @vitest-environment happy-dom
/**
 * StatsCard mount-and-render tests. Confirms:
 *   1. With a populated `stats` prop (running family), the headline,
 *      "Running Best Efforts" header, the rendered row, and the totals
 *      block all render.
 *   2. With `stats = null`, the component renders nothing.
 *   3. With multiple families populated, each gets its own section
 *      header.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import StatsCard from './StatsCard.svelte'
import type { StatsReport } from '@core/stats'

let mounted: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (mounted) {
    unmount(mounted)
    mounted = null
  }
  document.body.innerHTML = ''
})

/** Stats with one populated running family. Mirrors the shape `computeStats`
 *  emits — only the populated families appear as keys. */
function makeRunningStats(): StatsReport {
  return {
    bestEfforts: {
      running: [
        { distanceMeters: 400, label: '400m', bestSeconds: 95, sourceFileName: 'a.json' },
        { distanceMeters: 805, label: '1/2 mile', bestSeconds: null, sourceFileName: null },
        { distanceMeters: 1000, label: '1K', bestSeconds: 250, sourceFileName: 'a.json' },
        { distanceMeters: 1609, label: '1 mile', bestSeconds: null, sourceFileName: null },
        { distanceMeters: 3219, label: '2 mile', bestSeconds: null, sourceFileName: null },
        { distanceMeters: 5000, label: '5K', bestSeconds: 1250, sourceFileName: 'a.json' },
        { distanceMeters: 10000, label: '10K', bestSeconds: null, sourceFileName: null },
        { distanceMeters: 15000, label: '15K', bestSeconds: null, sourceFileName: null },
        { distanceMeters: 16093, label: '10 mile', bestSeconds: null, sourceFileName: null },
        { distanceMeters: 20000, label: '20K', bestSeconds: null, sourceFileName: null },
        {
          distanceMeters: 21097,
          label: 'Half-Marathon',
          bestSeconds: null,
          sourceFileName: null,
        },
      ],
    },
    totals: {
      activityCount: 3,
      totalDistanceMeters: 12500,
      totalDurationSec: 5400, // 1h30
      totalElevationGainMeters: 240,
    },
  }
}

/** Stats with both running AND cycling populated — exercises multi-family
 *  rendering. */
function makeRunningAndCyclingStats(): StatsReport {
  return {
    bestEfforts: {
      running: [
        { distanceMeters: 1000, label: '1K', bestSeconds: 250, sourceFileName: 'run.json' },
      ],
      cycling: [
        { distanceMeters: 5000, label: '5K', bestSeconds: 500, sourceFileName: 'bike.json' },
        { distanceMeters: 10000, label: '10K', bestSeconds: 1000, sourceFileName: 'bike.json' },
      ],
    },
    totals: {
      activityCount: 2,
      totalDistanceMeters: 35000,
      totalDurationSec: 4250,
      totalElevationGainMeters: null,
    },
  }
}

describe('StatsCard', () => {
  it('renders headline, running best-efforts rows, and totals when stats are populated', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(StatsCard, { target, props: { stats: makeRunningStats() } })
    flushSync()

    const card = target.querySelector('[data-testid="stats-card"]')
    expect(card).not.toBeNull()
    expect(target.textContent).toMatch(/Your data/i)

    // The running family section exists with the right header.
    const beSection = target.querySelector('[data-testid="stats-best-efforts"]')
    expect(beSection?.textContent).toContain('Running Best Efforts')
    const runningGroup = target.querySelector('[data-testid="stats-best-efforts-running"]')
    expect(runningGroup).not.toBeNull()
    // Best-effort rows: 1K should show "4:10" (250s = 4:10)
    expect(runningGroup?.textContent).toContain('1K')
    expect(runningGroup?.textContent).toContain('4:10')
    // 400m at 95s = 1:35
    expect(runningGroup?.textContent).toContain('400m')
    expect(runningGroup?.textContent).toContain('1:35')
    // Null rows should not render
    expect(runningGroup?.textContent).not.toContain('Half-Marathon')

    // Totals
    const totalsSection = target.querySelector('[data-testid="stats-totals"]')
    expect(totalsSection?.textContent).toContain('3') // activity count
    expect(target.querySelector('[data-testid="stats-distance"]')?.textContent).toContain(
      '12.5 km',
    )
    expect(target.querySelector('[data-testid="stats-time"]')?.textContent).toContain('1h 30m')
    expect(target.querySelector('[data-testid="stats-elevation"]')?.textContent).toContain(
      '240 m',
    )
  })

  it('renders nothing when stats is null', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(StatsCard, { target, props: { stats: null } })
    flushSync()

    expect(target.querySelector('[data-testid="stats-card"]')).toBeNull()
    expect(target.textContent?.trim() ?? '').toBe('')
  })

  it('renders one section per populated family — running + cycling both show', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(StatsCard, { target, props: { stats: makeRunningAndCyclingStats() } })
    flushSync()

    const beSection = target.querySelector('[data-testid="stats-best-efforts"]')
    expect(beSection).not.toBeNull()
    expect(beSection?.textContent).toContain('Running Best Efforts')
    expect(beSection?.textContent).toContain('Cycling Best Efforts')
    // Both family containers render.
    expect(target.querySelector('[data-testid="stats-best-efforts-running"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="stats-best-efforts-cycling"]')).not.toBeNull()
    // No swimming/walking section.
    expect(target.querySelector('[data-testid="stats-best-efforts-swimming"]')).toBeNull()
    expect(target.querySelector('[data-testid="stats-best-efforts-walking"]')).toBeNull()
  })
})
