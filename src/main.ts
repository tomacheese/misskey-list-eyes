import { Browser } from 'puppeteer-core'
import { DiscordApi } from './discord'
import { Logger } from '@book000/node-utils'
import { NotesUserListTimelineResponse } from './misskey'
import { Notified } from './notified'
import { downloadNotePreviewImage, initPuppeteerBrowser } from './utils'

interface IEnvironment extends NodeJS.ProcessEnv {
  INSTANCE_DOMAIN: string
  LIST_ID: string
  API_ACCESS_TOKEN: string
  DISCORD_WEBHOOK_URL: string
}

function checkEnvironment() {
  if (!process.env.INSTANCE_DOMAIN) {
    throw new Error('INSTANCE_DOMAIN is not set')
  }
  if (!process.env.LIST_ID) {
    throw new Error('LIST_ID is not set')
  }
  if (!process.env.API_ACCESS_TOKEN) {
    throw new Error('API_ACCESS_TOKEN is not set')
  }
  if (!process.env.DISCORD_WEBHOOK_URL) {
    throw new Error('DISCORD_WEBHOOK_URL is not set')
  }
}

async function getUserListTimeline(accessToken: string, listId: string) {
  const res = await fetch(
    `https://${process.env.INSTANCE_DOMAIN}/api/notes/user-list-timeline`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        i: accessToken,
        listId,
        limit: 100
      })
    }
  )
  if (!res.ok) {
    throw new Error(
      `Failed to get user list timeline: ${res.status} ${res.statusText}`
    )
  }
  return (await res.json()) as NotesUserListTimelineResponse
}

async function main() {
  const logger = Logger.configure('main')
  logger.info('✨ main()')

  let browser: Browser | null = null

  try {
    logger.info('🔎 Check environment variables')
    checkEnvironment()

    const environment: IEnvironment = process.env as IEnvironment
    const instanceDomain = environment.INSTANCE_DOMAIN

    const discord = new DiscordApi(environment.DISCORD_WEBHOOK_URL)
    const isFirst = Notified.isFirst()
    logger.info(`📝 isFirst: ${isFirst}`)

    logger.info('🚀 Launch Puppeteer')
    browser = await initPuppeteerBrowser()

    logger.info('📝 Get list timeline')
    const notes = await getUserListTimeline(
      environment.API_ACCESS_TOKEN,
      environment.LIST_ID
    )

    for (const note of notes.toReversed()) {
      const noteId = note.id
      if (Notified.isNotified(noteId)) {
        continue
      }

      if (isFirst) {
        Notified.addNotified(noteId)
        continue
      }

      // Wait before notifying so that reactions are included in the screenshot
      const createdAt = new Date(note.createdAt)
      const now = new Date()
      const diff = now.getTime() - createdAt.getTime()
      if (diff < 1000 * 60 * 5) {
        logger.info(`⏭️ Skipped: ${noteId}`)
        continue
      }

      const url = `https://${instanceDomain}/notes/${noteId}`
      const hasCW = note.cw != null
      const sensitiveFileIds = note.files
        .filter((file) => file.isSensitive)
        .map((file) => file.id)
      // note.text can be null (e.g. media-only notes); fall back to '' so expectedText is always a string
      const expectedText = note.cw ?? note.text ?? ''

      logger.info(`📷 Downloading image: ${url}`)
      let imagePath: string
      try {
        const result = await downloadNotePreviewImage(
          browser,
          instanceDomain,
          noteId,
          expectedText,
          hasCW,
          sensitiveFileIds
        )
        imagePath = result.imagePath
      } catch (error) {
        // Catch here so one note's capture failure does not block the others.
        // Notified.addNotified is not called, so the note is retried on the next loop iteration (entrypoint.sh)
        logger.warn(`⚠️ Failed to download image: ${url}`, error as Error)
        continue
      }

      logger.info('📝 Send messages to Discord')

      const isSpoiler = hasCW || sensitiveFileIds.length > 0
      await discord.sendMessage(
        '',
        {
          title: `👀 ${instanceDomain} で見る`,
          url,
          image: {
            url: `attachment://${isSpoiler ? 'SPOILER_' : ''}image.png`
          }
        },
        imagePath,
        isSpoiler
      )

      Notified.addNotified(noteId)
    }
  } catch (error) {
    logger.error('Error', error as Error)
  } finally {
    if (browser) {
      logger.info('👋 Closing Puppeteer')
      await browser.close()
    }
  }
}

;(async () => {
  const logger = Logger.configure('main')
  await main().catch((error: unknown) => {
    logger.error('Error', error as Error)
  })
})()
