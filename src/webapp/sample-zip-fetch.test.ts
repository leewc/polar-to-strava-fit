// @vitest-environment happy-dom
/**
 * Tests for the sample-zip fetch error handling in App.svelte's loadSample().
 *
 * The bug we're guarding against: fetching the sample with the wrong URL
 * (e.g. resolved relative to the JS bundle path under GitHub Pages) lands
 * on the SPA's index.html fallback, which fflate then chokes on with the
 * unhelpful "invalid zip data" error. We surface a clearer message and
 * test all three paths: success, 404, and HTML-served-with-200.
 *
 * We can't easily mount the full Svelte component without testing-library,
 * so this test exercises the fetch+content-type logic directly by extracting
 * it into a small pure function and asserting on its behaviour. The same
 * checks live inline in App.svelte's loadSample(); changes there should be
 * mirrored to the helper below to keep this test meaningful.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The validation logic from loadSample(), pulled out so it can be tested
 * without mounting Svelte. Throws on bad responses with friendly messages.
 */
async function fetchSampleZipBytes(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(
      `Sample data unavailable (HTTP ${res.status}). Try refreshing in a few minutes if a deploy is in progress.`,
    )
  }
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('text/html')) {
    throw new Error(
      'Sample data unavailable (server returned HTML). Try refreshing in a few minutes if a deploy is in progress.',
    )
  }
  return res.blob()
}

function mockResponse(opts: {
  ok: boolean
  status: number
  contentType: string
  body: BodyInit
}): Response {
  return new Response(opts.body, {
    status: opts.status,
    headers: { 'content-type': opts.contentType },
  })
}

describe('sample-zip fetch validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the blob when the response is a valid zip', async () => {
    // 4-byte zip-EOCD-ish placeholder; we don't actually parse, just verify
    // the function returns the body intact.
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x05, 0x06])
    const fakeFetch = vi.fn(async () =>
      mockResponse({
        ok: true,
        status: 200,
        contentType: 'application/zip',
        body: zipBytes,
      }),
    )

    const blob = await fetchSampleZipBytes('/sample-polar-export.zip', fakeFetch as any)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBe(4)
  })

  it('throws a friendly error on 404 instead of letting fflate see HTML body', async () => {
    const fakeFetch = vi.fn(async () =>
      mockResponse({
        ok: false,
        status: 404,
        contentType: 'text/html; charset=utf-8',
        body: '<!DOCTYPE html><title>404</title>',
      }),
    )

    await expect(fetchSampleZipBytes('/missing.zip', fakeFetch as any)).rejects.toThrow(
      /Sample data unavailable \(HTTP 404\)/,
    )
  })

  it('throws a friendly error when the server returns HTML with status 200 (SPA fallback)', async () => {
    // GitHub Pages and many static hosts serve a single-page fallback at
    // unknown paths with status 200 and Content-Type text/html. Without
    // this guard, fflate.unzipSync would receive the HTML body and throw
    // the generic "invalid zip data".
    const fakeFetch = vi.fn(async () =>
      mockResponse({
        ok: true,
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!DOCTYPE html><html><body>SPA fallback</body></html>',
      }),
    )

    await expect(fetchSampleZipBytes('/sample.zip', fakeFetch as any)).rejects.toThrow(
      /server returned HTML/,
    )
  })

  it('accepts application/x-zip-compressed (the type GitHub Pages serves)', async () => {
    const fakeFetch = vi.fn(async () =>
      mockResponse({
        ok: true,
        status: 200,
        contentType: 'application/x-zip-compressed',
        body: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      }),
    )

    await expect(
      fetchSampleZipBytes('/sample.zip', fakeFetch as any),
    ).resolves.toBeInstanceOf(Blob)
  })

  it('accepts application/octet-stream (fallback content-type)', async () => {
    const fakeFetch = vi.fn(async () =>
      mockResponse({
        ok: true,
        status: 200,
        contentType: 'application/octet-stream',
        body: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      }),
    )

    await expect(
      fetchSampleZipBytes('/sample.zip', fakeFetch as any),
    ).resolves.toBeInstanceOf(Blob)
  })
})
