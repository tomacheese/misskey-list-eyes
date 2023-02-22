import puppeteer, { Browser } from 'puppeteer-core'
import fs from 'node:fs'

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

export async function downloadNotePreviewImage(
  browser: Browser,
  instanceDomain: string,
  noteId: string
) {
  // /tmp がなかったら作る
  if (!fs.existsSync('/tmp')) {
    fs.mkdirSync('/tmp')
  }

  const url = `https://${instanceDomain}/notes/${noteId}`
  const imagePath = `/tmp/${noteId}.png`

  const page = await browser.newPage()
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'dark' }
  ])
  await page.goto(url, { waitUntil: 'networkidle2' })

  await page.waitForSelector('div.note').finally(async () => {
    const imageFullPath = `/data/${noteId}.full.png`
    await page.screenshot({
      path: imageFullPath,
      fullPage: true
    })
  })

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
