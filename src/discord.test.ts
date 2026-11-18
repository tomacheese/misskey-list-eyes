import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscordApi, DiscordApiError } from './discord'

vi.mock('node:fs', () => ({
  default: { readFileSync: vi.fn(() => Buffer.from('png')) }
}))

const WEBHOOK_URL = 'https://discord.example/api/webhooks/123/secret-token'

/** Sends one message and returns the thrown error, or undefined on success. */
async function sendAndCatch(): Promise<unknown> {
  try {
    await new DiscordApi(WEBHOOK_URL).sendMessage('', {}, '/tmp/image.png')
  } catch (error) {
    return error
  }
  return undefined
}

/** Stubs global `fetch` to return a bodiless response and returns the mock. */
function stubResponse(status: number, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(null, { status, headers }))
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('DiscordApi.sendMessage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([200, 204])('resolves on %i', async (status) => {
    stubResponse(status)
    expect(await sendAndCatch()).toBeUndefined()
  })

  it.each([400, 413, 503])(
    'status %i is a per-note failure (abortBatch false)',
    async (status) => {
      stubResponse(status)
      const error = await sendAndCatch()
      expect(error).toBeInstanceOf(DiscordApiError)
      expect((error as DiscordApiError).abortBatch).toBe(false)
      expect((error as DiscordApiError).status).toBe(status)
      expect((error as DiscordApiError).message).not.toContain(WEBHOOK_URL)
    }
  )

  it.each([401, 403, 404])(
    'status %i means the webhook is unusable (abortBatch true)',
    async (status) => {
      stubResponse(status)
      const error = (await sendAndCatch()) as DiscordApiError
      expect(error).toBeInstanceOf(DiscordApiError)
      expect(error.abortBatch).toBe(true)
      expect(error.status).toBe(status)
      expect(error.retryAfterMs).toBeUndefined()
    }
  )

  it('429 with Retry-After aborts the batch and exposes retryAfterMs', async () => {
    stubResponse(429, { 'Retry-After': '2' })
    const error = (await sendAndCatch()) as DiscordApiError
    expect(error).toBeInstanceOf(DiscordApiError)
    expect(error.abortBatch).toBe(true)
    expect(error.status).toBe(429)
    expect(error.retryAfterMs).toBe(2000)
  })

  it.each([undefined, '', 'abc', '-1'])(
    '429 with Retry-After %j leaves retryAfterMs undefined',
    async (value) => {
      stubResponse(429, value === undefined ? {} : { 'Retry-After': value })
      const error = (await sendAndCatch()) as DiscordApiError
      expect(error.abortBatch).toBe(true)
      expect(error.retryAfterMs).toBeUndefined()
    }
  )

  it('wraps a fetch rejection as an abortBatch error keeping the cause', async () => {
    const cause = new TypeError('fetch failed')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause))
    const error = (await sendAndCatch()) as DiscordApiError
    expect(error).toBeInstanceOf(DiscordApiError)
    expect(error.abortBatch).toBe(true)
    expect(error.status).toBeUndefined()
    expect(error.cause).toBe(cause)
    expect(error.message).not.toContain(WEBHOOK_URL)
  })

  it('does not wrap a readFileSync failure and does not call fetch', async () => {
    const { default: fs } = await import('node:fs')
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    const fetchMock = stubResponse(200)
    const error = await sendAndCatch()
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(DiscordApiError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
