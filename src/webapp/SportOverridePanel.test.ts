// @vitest-environment happy-dom
/**
 * SportOverridePanel.test.ts — vitest happy-dom tests for the
 * out-of-band sport-override UI. Mounts the component directly with
 * Svelte 5's `mount`/`unmount`, then asserts on the resulting DOM and
 * `onChange` callback invocations.
 *
 * Why mount instead of @testing-library/svelte: this repo doesn't pull
 * in the testing-library shim, and the surface we care about is small
 * enough that direct DOM queries are fine — happy-dom gives us a real
 * `document` and `<select>` element with a working `change` event.
 */

import { mount, unmount, flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import SportOverridePanel from './SportOverridePanel.svelte'
import type { FallbackSessionRow } from './SportOverridePanel.svelte'

function makeRow(overrides: Partial<FallbackSessionRow> = {}): FallbackSessionRow {
  return {
    fileName: 'training-session-fake.json',
    sessionName: 'Fake session',
    sportName: 'Made-up sport',
    isFallback: true,
    currentSport: 0, // GENERIC
    currentSubSport: undefined,
    ...overrides,
  }
}

function mountPanel(props: {
  sessions: FallbackSessionRow[]
  onChange?: (fileName: string, newSport: number, newSubSport?: number) => void
}) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const onChange = props.onChange ?? (() => {})
  const component = mount(SportOverridePanel, {
    target,
    props: { sessions: props.sessions, onChange },
  })
  return {
    target,
    component,
    cleanup: () => {
      unmount(component)
      target.remove()
    },
  }
}

describe('SportOverridePanel', () => {
  it('renders nothing when there are no fallback sessions', () => {
    const { target, cleanup } = mountPanel({ sessions: [] })
    // No card rendered → no toggle button.
    expect(target.querySelector('[data-testid="sport-override-toggle"]')).toBeNull()
    // And no rows.
    expect(target.querySelector('[data-testid="sport-override-row"]')).toBeNull()
    cleanup()
  })

  it('also renders nothing when sessions exist but none are fallbacks', () => {
    const { target, cleanup } = mountPanel({
      sessions: [makeRow({ isFallback: false })],
    })
    expect(target.querySelector('[data-testid="sport-override-toggle"]')).toBeNull()
    cleanup()
  })

  it('renders a row for each fallback session, expanded after click', () => {
    const row = makeRow({
      fileName: 'training-session-2025-01-01-foo.json',
      sessionName: 'My weird workout',
      sportName: 'Made-up sport',
    })
    const { target, cleanup } = mountPanel({ sessions: [row] })

    // Title summarises the count and reads as the spec demands.
    const toggle = target.querySelector(
      '[data-testid="sport-override-toggle"]',
    ) as HTMLButtonElement | null
    expect(toggle).not.toBeNull()
    expect(toggle?.textContent ?? '').toContain('1 session')
    expect(toggle?.textContent ?? '').toContain('unmapped sports')

    // Collapsed by default.
    expect(target.querySelector('[data-testid="sport-override-list"]')).toBeNull()

    // Expand.
    toggle?.click()
    flushSync()

    const rows = target.querySelectorAll('[data-testid="sport-override-row"]')
    expect(rows).toHaveLength(1)
    const onlyRow = rows[0] as HTMLElement
    expect(onlyRow.dataset.filename).toBe(row.fileName)
    expect(onlyRow.textContent).toContain('Made-up sport')
    expect(onlyRow.textContent).toContain('My weird workout')

    // Sport <select> is wired up; it has at least the GENERIC + RUNNING
    // options sourced from the SDK enum.
    const sportSelect = onlyRow.querySelector(
      `select[id="sport-${row.fileName}"]`,
    ) as HTMLSelectElement | null
    expect(sportSelect).not.toBeNull()
    const optionLabels = Array.from(sportSelect?.options ?? []).map((o) => o.textContent)
    expect(optionLabels).toContain('Generic')
    expect(optionLabels).toContain('Running')

    cleanup()
  })

  it('emits onChange with (fileName, newSport, currentSubSport) when the sport select changes', () => {
    const onChange = vi.fn()
    const row = makeRow({ currentSport: 0, currentSubSport: undefined })
    const { target, cleanup } = mountPanel({ sessions: [row], onChange })

    // Expand the panel.
    ;(target.querySelector('[data-testid="sport-override-toggle"]') as HTMLButtonElement).click()
    flushSync()

    const sportSelect = target.querySelector(
      `select[id="sport-${row.fileName}"]`,
    ) as HTMLSelectElement
    // Pick the option labelled "Running" — id 1 in the fitsdk enum.
    const runningOption = Array.from(sportSelect.options).find(
      (o) => o.textContent === 'Running',
    )
    expect(runningOption).toBeDefined()
    sportSelect.value = runningOption!.value
    sportSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(row.fileName, Number(runningOption!.value), undefined)

    cleanup()
  })

  it('emits onChange with (fileName, currentSport, undefined) when the sub-sport "none" option is picked', () => {
    const onChange = vi.fn()
    const row = makeRow({ currentSport: 1, currentSubSport: 2 })
    const { target, cleanup } = mountPanel({ sessions: [row], onChange })
    ;(target.querySelector('[data-testid="sport-override-toggle"]') as HTMLButtonElement).click()
    flushSync()

    const subSelect = target.querySelector(
      `select[id="subsport-${row.fileName}"]`,
    ) as HTMLSelectElement
    // "— none —" option has empty value.
    subSelect.value = ''
    subSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(row.fileName, 1, undefined)

    cleanup()
  })
})
