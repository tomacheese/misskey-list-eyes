import puppeteer, { Browser, Page } from 'puppeteer-core'
import fs from 'node:fs'
import { Logger } from '@book000/node-utils'

/**
 * ノート本体候補の article 要素についての判定用情報。
 * ブラウザコンテキストで抽出した結果を Node.js 側に渡すためのプレーンなデータ構造。
 */
export interface ArticleCandidate {
  /** タイムラインプレビューウィジェット等、サイドバー由来の要素かどうか */
  hasScrollAnchorAncestor: boolean
  /** article 要素のテキスト内容 */
  textContent: string
}

/**
 * selectNoteArticleIndex の判定結果。
 */
export interface NoteArticleSelection {
  /** candidates 配列内で選択された要素のインデックス */
  index: number
  /** 本文照合で一意に決定できず、フォールバックで選択した場合に true */
  isAmbiguous: boolean
}

/**
 * ノート詳細ページ内の複数の article 候補から、本体ノートの article を選択する。
 *
 * misskey.io は未ログイン状態で /notes/:id にアクセスすると、サイドバーの
 * タイムラインプレビューウィジェット内にも無関係な article 要素が大量に
 * 描画される。これらは data-scroll-anchor 属性を持つ要素の子孫であるため、
 * まずそれらを除外し、残った候補を API 取得済みの本文（cw があれば cw、
 * なければ text）と照合して本体を特定する。
 *
 * @param candidates - ページ内の全 article 要素から抽出した候補一覧
 * @param expectedText - 本体ノートの本文（note.cw ?? note.text ?? ''）
 * @returns 選択結果。除外後の候補が0件の場合は null
 */
export function selectNoteArticleIndex(
  candidates: ArticleCandidate[],
  expectedText: string
): NoteArticleSelection | null {
  const nonSidebarIndices = candidates
    .map((_, index) => index)
    .filter((index) => !candidates[index].hasScrollAnchorAncestor)

  if (nonSidebarIndices.length === 0) {
    return null
  }

  if (nonSidebarIndices.length === 1) {
    return { index: nonSidebarIndices[0], isAmbiguous: false }
  }

  if (expectedText !== '') {
    const matchedIndices = nonSidebarIndices.filter((index) =>
      candidates[index].textContent.includes(expectedText)
    )
    if (matchedIndices.length > 0) {
      return { index: matchedIndices[0], isAmbiguous: false }
    }
  }

  const lastIndex = nonSidebarIndices.at(-1)
  if (lastIndex === undefined) {
    // nonSidebarIndices.length === 0 は関数冒頭で return 済みのため到達しない
    return null
  }

  return {
    index: lastIndex,
    isAmbiguous: true
  }
}

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
  // div.contents articleが出てくるのを10秒待って、出てこなかったらリロード + リトライ
  await page
    .waitForSelector('div.contents article', {
      timeout: 10_000
    })
    .catch(async () => {
      logger.warn(`🔄 Failed to wait note element. Retrying...`)
      await page.reload()
    })

  await page.waitForSelector('div.contents article').finally(() => {
    const imageFullPath = `/data/${noteId}.full.png` as const
    page
      .screenshot({
        path: imageFullPath,
        fullPage: true
      })
      .catch(() => {
        logger.error(`🚨 Failed to capture full page screenshot`)
      })
  })
}

async function isContentWarning(page: Page) {
  // div.contents article button.xd2wm があるかどうかで判定する
  return (await page.$('div.contents article button.xd2wm')) != null
}

async function showContentWarning(page: Page) {
  await page
    .waitForSelector('div.contents article button.xd2wm')
    .then((element) =>
      // display: none;を削除する
      page.evaluate((element) => {
        ;(element as HTMLElement).dispatchEvent(new Event('mousedown'))
      }, element)
    )
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .catch(() => {})
}

async function isNSFW(page: Page) {
  // とりあえず、div.xuA87.xesxEがあるかどうかで判定する。多分変わるだろうと思うから適宜
  return (await page.$('div.xuA87.xesxE')) != null
}

async function showNSFW(page: Page) {
  await page
    .waitForSelector('div.xuA87.xesxE')
    .then((element) => element?.click())
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .catch(() => {})

  // 画像が開いてしまうので、閉じる
  await page
    .waitForSelector('button.pswp__button--close')
    .then((element) => element?.click())
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .catch(() => {})
}

async function captureNote(page: Page, noteId: string) {
  const imagePath = `/tmp/${noteId}.png` as const

  // スクショを撮る範囲の計算
  const clip = await page.evaluate((s) => {
    const element = document.querySelector(s)
    if (!element) {
      return null
    }
    element.scrollIntoView()

    const { width, height, top: y, left: x } = element.getBoundingClientRect()
    return { width, height, x, y }
  }, 'div.contents article')

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

  logger.info('✨ Capture note screenshot')
  return {
    imagePath: await captureNote(page, noteId),
    isCW,
    isNSFWImage
  }
}
