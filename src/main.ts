import axios from 'axios'
import { DiscordApi } from './discord'
import { Logger } from './logger'
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
  // process.env.INSTANCE_DOMAIN
  // process.env.LIST_ID
  // process.env.DISCORD_WEBHOOK_URL

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
  const response = await axios.post<NotesUserListTimelineResponse>(
    `https://${process.env.INSTANCE_DOMAIN}/api/notes/user-list-timeline`,
    {
      i: accessToken,
      listId,
      limit: 100
    },
    {
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  if (response.status !== 200) {
    throw new Error(
      `Failed to get user list timeline: ${response.status} ${response.statusText}`
    )
  }
  return response.data
}

async function main() {
  const logger = Logger.configure('main')
  logger.info('✨ main()')

  logger.info('🔎 Check environment variables')
  checkEnvironment()

  const environment: IEnvironment = process.env as IEnvironment
  const instanceDomain = environment.INSTANCE_DOMAIN

  const discord = new DiscordApi(environment.DISCORD_WEBHOOK_URL)
  const isFirst = Notified.isFirst()
  logger.info(`📝 isFirst: ${isFirst}`)

  logger.info('🚀 Launch Puppeteer')
  const browser = await initPuppeteerBrowser()

  logger.info('📝 Get list timeline')
  const notes = await getUserListTimeline(
    environment.API_ACCESS_TOKEN,
    environment.LIST_ID
  )

  for (const note of notes.reverse()) {
    const noteId = note.id
    if (Notified.isNotified(noteId)) {
      continue
    }

    if (isFirst) {
      Notified.addNotified(noteId)
      continue
    }

    // リアクション分も含める関係上、投稿から5分以降のノートを通知する
    const createdAt = new Date(note.createdAt)
    const now = new Date()
    const diff = now.getTime() - createdAt.getTime()
    if (diff < 1000 * 60 * 5) {
      logger.info(`⏭️ Skipped: ${noteId}`)
      continue
    }

    const url = `https://${instanceDomain}/notes/${noteId}`

    logger.info(`📷 Downloading image: ${url}`)
    const result = await downloadNotePreviewImage(
      browser,
      instanceDomain,
      noteId
    )
    const imagePath = result.imagePath
    if (!result || !imagePath) {
      logger.warn(`📝 Failed to download image: ${url}`)
      continue
    }

    logger.info('📝 Send messages to Discord')

    await discord.sendMessage(
      '',
      {
        title: `👀 ${instanceDomain} で見る`,
        url
      },
      imagePath,
      result.isCW || result.isNSFWImage
    )

    Notified.addNotified(noteId)
  }

  logger.info('👋 Closing Puppeteer')
  await browser.close()
}

;(async () => {
  const logger = Logger.configure('main')
  await main().catch((error) => {
    logger.error(error)
  })
})()
