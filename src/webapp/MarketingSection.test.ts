// @vitest-environment happy-dom
/**
 * MarketingSection smoke tests. Confirms the section renders the key
 * headings + first FAQ entry + the AI-cost prop with both default and
 * overridden values.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import MarketingSection from './MarketingSection.svelte'

let mounted: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (mounted) {
    unmount(mounted)
    mounted = null
  }
  document.body.innerHTML = ''
})

describe('MarketingSection', () => {
  it('renders the section headings and first FAQ entry with the default AI-cost prop', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(MarketingSection, { target, props: {} })
    flushSync()

    const section = target.querySelector('[data-testid="marketing-section"]')
    expect(section).not.toBeNull()

    // Section headings.
    const text = target.textContent ?? ''
    expect(text).toContain('Why this tool exists')
    expect(text).toContain('Privacy')
    expect(text).toContain('How to get your Polar export ZIP')
    expect(text).toContain('FAQ')

    // FAQ summaries.
    const faq = target.querySelector('[data-testid="marketing-faq"]')
    expect(faq).not.toBeNull()
    expect(faq?.textContent).toContain('Why did you build this?')
    expect(faq?.textContent).toContain('Was AI used in building this?')
    expect(faq?.textContent).toContain('Is there a CLI?')
    expect(faq?.textContent).toContain('Why FIT instead of TCX or GPX?')

    // Default AI cost is sourced from Claude Code's /usage panel
    // ($229.82 as of 2026-06-03).
    expect(faq?.textContent).toContain('~$230')

    // Footer with repo link.
    const footer = target.querySelector('[data-testid="marketing-footer"]')
    expect(footer?.textContent).toContain('leewc/polar-to-strava-fit')
    expect(footer?.textContent).toContain('MIT')
  })

  it('honors a custom aiCostUsd prop in the FAQ entry', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(MarketingSection, {
      target,
      props: { aiCostUsd: '$123.45' },
    })
    flushSync()

    const faq = target.querySelector('[data-testid="marketing-faq"]')
    expect(faq?.textContent).toContain('$123.45')
    expect(faq?.textContent).not.toContain('~$60')
  })
})
