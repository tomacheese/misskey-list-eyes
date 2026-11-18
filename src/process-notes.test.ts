import type { Browser } from 'puppeteer-core'
import type { Logger } from '@book000/node-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscordApi, DiscordApiError } from './discord'
import type { Note } from './misskey'
import { processNotes } from './process-notes'
import { downloadNotePreviewImage } from './utils'

const { isNotified, addNotified } = vi.hoisted(() => ({
  isNotified: vi.fn<(noteId: string) => boolean>(),
  addNotified: vi.fn<(noteId: string) => void>()
}))
vi.mock('./notified', () => ({
  Notified: { isNotified, addNotified }
}))
vi.mock('./utils', () => ({
  downloadNotePreviewImage: vi.fn()
}))

const NOW = new Date('2026-01-01T12:00:00Z')
const OLD = new Date('2026-01-01T11:00:00Z')
const WEBHOOK_URL = 'https://discord.example/api/webhooks/123/secret-token'

/** Builds a minimal text-only note. */
function makeNote(id: string, createdAt: Date = OLD): Note {
  return {
    id,
    createdAt,
    text: 'hello',
    cw: null,
    files: []
  } as unknown as Note
}

/** Builds a logger whose methods are all spies. */
function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

/** Runs `processNotes` with fake dependencies around the given `sendMessage`. */
function run(
  notes: Note[],
  sendMessage: ReturnType<typeof vi.fn>,
  logger = makeLogger(),
  isFirst = false
) {
  return processNotes(notes, {
    browser: {} as Browser,
    discord: { sendMessage } as unknown as DiscordApi,
    instanceDomain: 'misskey.example',
    isFirst,
    logger: logger as unknown as Logger
  })
}

describe('processNotes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    isNotified.mockReturnValue(false)
    vi.mocked(downloadNotePreviewImage).mockResolvedValue({
      imagePath: '/tmp/image.png'
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it.each([
    [
      '413',
      new DiscordApiError('Failed to send message to Discord: 413', {
        status: 413,
        abortBatch: false
      })
    ],
    [
      '503',
      new DiscordApiError('Failed to send message to Discord: 503', {
        status: 503,
        abortBatch: false
      })
    ],
    ['a non-Discord error', new Error('ENOENT')]
  ])(
    'still sends the second note when the first send fails with %s',
    async (_name, failure) => {
      const sendMessage = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(undefined)

      await run([makeNote('a'), makeNote('b')], sendMessage)

      expect(sendMessage).toHaveBeenCalledTimes(2)
      expect(addNotified).toHaveBeenCalledTimes(1)
      expect(addNotified).toHaveBeenCalledWith('b')
    }
  )

  it('stops the run without marking notes when the failure aborts the batch', async () => {
    const sendMessage = vi.fn().mockRejectedValueOnce(
      new DiscordApiError('Failed to send message to Discord: 429', {
        status: 429,
        abortBatch: true,
        retryAfterMs: 2000
      })
    )
    const logger = makeLogger()

    await run([makeNote('a'), makeNote('b')], sendMessage, logger)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(addNotified).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      '⚠️ Discord is unavailable or rate limited, stopping this run: https://misskey.example/notes/a (Failed to send message to Discord: 429, retryAfterMs: 2000)'
    )
  })

  it('never logs an Error object or the webhook URL from a failed send', async () => {
    const sendMessage = vi.fn().mockRejectedValue(
      new DiscordApiError('Failed to send message to Discord: network error', {
        abortBatch: true,
        cause: new TypeError(`fetch failed ${WEBHOOK_URL}`)
      })
    )
    const logger = makeLogger()

    await run([makeNote('a')], sendMessage, logger)

    for (const args of logger.warn.mock.calls) {
      for (const arg of args) {
        expect(arg).not.toBeInstanceOf(Error)
        expect(String(arg)).not.toContain(WEBHOOK_URL)
      }
    }
  })

  it('skips notes that are already notified', async () => {
    isNotified.mockImplementation((id) => id === 'a')
    const sendMessage = vi.fn().mockResolvedValue(undefined)

    await run([makeNote('a'), makeNote('b')], sendMessage)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(addNotified).toHaveBeenCalledWith('b')
  })

  it('skips notes younger than 5 minutes', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined)

    await run([makeNote('a', new Date(NOW.getTime() - 60_000))], sendMessage)

    expect(sendMessage).not.toHaveBeenCalled()
    expect(addNotified).not.toHaveBeenCalled()
  })

  it('records notes without sending on the first run', async () => {
    const sendMessage = vi.fn()

    await run([makeNote('a'), makeNote('b')], sendMessage, makeLogger(), true)

    expect(sendMessage).not.toHaveBeenCalled()
    expect(addNotified).toHaveBeenCalledTimes(2)
  })

  it('continues to the next note when the screenshot fails', async () => {
    vi.mocked(downloadNotePreviewImage)
      .mockRejectedValueOnce(new Error('capture failed'))
      .mockResolvedValueOnce({ imagePath: '/tmp/image.png' })
    const sendMessage = vi.fn().mockResolvedValue(undefined)

    await run([makeNote('a'), makeNote('b')], sendMessage)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(addNotified).toHaveBeenCalledWith('b')
  })
})
