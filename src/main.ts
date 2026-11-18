import { Browser } from 'puppeteer-core'
import { DiscordApi } from './discord'
import { Logger } from '@book000/node-utils'
import { NotesUserListTimelineResponse } from './misskey'
import { Notified } from './notified'
import { processNotes } from './process-notes'
import { initPuppeteerBrowser } from './utils'

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

    await processNotes(notes.toReversed(), {
      browser,
      discord,
      instanceDomain,
      isFirst,
      logger
    })
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
