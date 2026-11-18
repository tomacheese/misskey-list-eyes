import fs from 'node:fs'

export interface DiscordEmbedFooter {
  text: string
  icon_url?: string
  proxy_icon_url?: string
}

export interface DiscordEmbedImage {
  url?: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface DiscordEmbedThumbnail {
  url?: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface DiscordEmbedVideo {
  url?: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface DiscordEmbedProvider {
  name?: string
  url?: string
}

export interface DiscordEmbedAuthor {
  name?: string
  url?: string
  icon_url?: string
  proxy_icon_url?: string
}

export interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordEmbed {
  title?: string
  type?: 'rich' | 'image' | 'video' | 'gifv' | 'article' | 'link'
  description?: string
  url?: string
  timestamp?: string
  color?: number
  footer?: DiscordEmbedFooter
  image?: DiscordEmbedImage
  thumbnail?: DiscordEmbedThumbnail
  video?: DiscordEmbedVideo
  provider?: DiscordEmbedProvider
  author?: DiscordEmbedAuthor
  fields?: DiscordEmbedField[]
}

/**
 * Error thrown when delivering a message to the Discord webhook fails.
 *
 * `abortBatch` is true for conditions that affect every later send in the same
 * run (HTTP 429 rate limiting, 401/403/404 for a revoked or deleted webhook,
 * network failure), so the caller should stop and
 * retry on the next run. It is false for everything else, including 5xx, since
 * those can be caused by a single note's payload.
 */
export class DiscordApiError extends Error {
  readonly status?: number
  readonly abortBatch: boolean
  readonly retryAfterMs?: number

  constructor(
    message: string,
    options: {
      status?: number
      abortBatch: boolean
      retryAfterMs?: number
      cause?: unknown
    }
  ) {
    super(message, { cause: options.cause })
    this.name = 'DiscordApiError'
    this.status = options.status
    this.abortBatch = options.abortBatch
    this.retryAfterMs = options.retryAfterMs
  }
}

/**
 * Parse a `Retry-After` header (seconds) into milliseconds.
 *
 * @param value Header value, or null when absent
 * @returns Milliseconds, or undefined when absent or not a non-negative number
 */
function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

export class DiscordApi {
  private webhookUrl: string

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl
  }

  async sendMessage(
    content: string,
    embed: DiscordEmbed,
    imagePath: string,
    isSpoiler = false
  ) {
    const formData = new FormData()
    formData.append(
      'payload_json',
      new Blob(
        [
          JSON.stringify({
            content,
            embeds: [embed]
          })
        ],
        { type: 'application/json' }
      )
    )

    const arraybuffer = fs.readFileSync(imagePath)
    formData.append(
      'file',
      new Blob([arraybuffer]),
      `${isSpoiler ? 'SPOILER_' : ''}image.png`
    )
    let res: Response
    try {
      res = await fetch(this.webhookUrl, {
        method: 'POST',
        body: formData
      })
    } catch (error) {
      // The cause is kept for debugging but must not be logged by callers
      throw new DiscordApiError(
        'Failed to send message to Discord: network error',
        {
          abortBatch: true,
          cause: error
        }
      )
    }
    if (res.ok) {
      return
    }
    const rateLimited = res.status === 429
    const webhookRejected = [401, 403, 404].includes(res.status)
    throw new DiscordApiError(
      `Failed to send message to Discord: ${res.status}`,
      {
        status: res.status,
        abortBatch: rateLimited || webhookRejected,
        retryAfterMs: rateLimited
          ? parseRetryAfterMs(res.headers.get('Retry-After'))
          : undefined
      }
    )
  }
}
