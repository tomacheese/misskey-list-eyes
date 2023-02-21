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

    Notified.addNotified(noteId)
    if (isFirst) {
      continue
    }

    const url = `https://${instanceDomain}/notes/${noteId}`

    logger.info('📷 Downloading image')
    const imagePath = await downloadNotePreviewImage(
      browser,
      instanceDomain,
      noteId
    )
    if (!imagePath) {
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
      imagePath
    )
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
