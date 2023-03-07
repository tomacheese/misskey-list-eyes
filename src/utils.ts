import puppeteer, { Browser, Page } from 'puppeteer-core'
import fs from 'node:fs'
import { Logger } from '@book000/node-utils'

export async function initPuppeteerBrowser() {
  const puppeteerArguments = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--lang=ja',
    '--window-size=1920,1080'
  ]
  return await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: puppeteerArguments,
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  })
}

async function waitForNoteElement(page: Page, noteId: string) {
  const logger = Logger.configure(`waitForNoteElement:${noteId}`)
  // div.noteが出てくるのを10秒待って、出てこなかったらリロード + リトライ
  await page
    .waitForSelector('div.note', {
      timeout: 10_000
    })
    .catch(async () => {
      logger.warn(`🔄 Failed to wait note element. Retrying...`)
      await page.reload()
    })

  await page.waitForSelector('div.note').finally(async () => {
    const imageFullPath = `/data/${noteId}.full.png`
    await page.screenshot({
      path: imageFullPath,
      fullPage: true
    })
  })
}

async function removeReplyElements(page: Page) {
  // div.reply の削除
  await page.evaluate(() => {
    const elements = document.querySelectorAll('div.reply')
    // eslint-disable-next-line unicorn/no-array-for-each
    elements.forEach((element) => {
      element.remove()
    })
  })
}

async function isContentWarning(page: Page) {
  // div.body > p.cw があるかどうかで判定する

  return (await page.$('div.body > p.cw')) != null
}

async function showContentWarning(page: Page) {
  await page
    .waitForSelector('div.body > div.content[style="display: none;"]')
    .then((element) =>
      // display: none;を削除する
      page.evaluate((element) => {
        ;(element as HTMLElement).removeAttribute('style')
      }, element)
    )
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .catch(() => {})
}

async function isNSFW(page: Page) {
  // アプローチとして微妙な気がするが、style="filter: brightness(0.5);" があるかどうかで判定する
  return (
    (await page.$(
      'div.content div.image > div[style="filter: brightness(0.5);"]'
    )) != null
  )
}

async function showNSFW(page: Page) {
  await page
    .waitForSelector(
      'div.content div.image > div[style="filter: brightness(0.5);"]'
    )
    .then((element) => element?.click())
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .catch(() => {})

  // 画像が開いてしまうので、閉じる
  await page
    .waitForSelector('div.pswp.pswp--open')
    .then((element) => element?.click())
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .catch(() => {})
}

async function captureNote(page: Page, noteId: string) {
  const imagePath = `/tmp/${noteId}.png`

  // スクショを撮る範囲の計算
  const clip = await page.evaluate((s) => {
    const element = document.querySelector(s)
    if (!element) {
      return null
    }
    element.scrollIntoView()

    const { width, height, top: y, left: x } = element.getBoundingClientRect()
    return { width, height, x, y }
  }, 'div.note > div.note')

  if (!clip) {
    return null
  }

  await page.screenshot({
    path: imagePath,
    clip
  })

  return imagePath
}

export async function downloadNotePreviewImage(
  browser: Browser,
  instanceDomain: string,
  noteId: string
) {
  const logger = Logger.configure('downloadNotePreviewImage')
  // /tmp がなかったら作る
  if (!fs.existsSync('/tmp')) {
    fs.mkdirSync('/tmp')
  }

  const url = `https://${instanceDomain}/notes/${noteId}`

  logger.info('✨ Access to note page')
  const page = await browser.newPage()
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'dark' }
  ])
  await page.goto(url, { waitUntil: 'networkidle2' })

  logger.info('✨ Wait for note element')
  await waitForNoteElement(page, noteId)

  logger.info('✨ Check content warning')
  const isCW = await isContentWarning(page)
  if (isCW) {
    logger.info('✨ Show content warning')
    await showContentWarning(page)
  }

  logger.info('✨ Check NSFW')
  const isNSFWImage = await isNSFW(page)
  if (isNSFWImage) {
    logger.info('✨ Show NSFW')
    await showNSFW(page)
  }

  logger.info('✨ Remove reply elements')
  await removeReplyElements(page)

  logger.info('✨ Capture note screenshot')
  return {
    imagePath: await captureNote(page, noteId),
    isCW,
    isNSFWImage
  }
}
