import puppeteer, { Browser, ElementHandle, Page } from 'puppeteer-core'
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

/**
 * ノート本体の article 要素の特定に失敗した場合に送出されるエラー。
 */
export class NoteElementNotFoundError extends Error {
  constructor(noteId: string) {
    super(`Failed to identify note article element for noteId=${noteId}`)
    this.name = 'NoteElementNotFoundError'
  }
}

/**
 * article 要素から selectNoteArticleIndex 用の候補情報を抽出する。
 * ElementHandle.evaluate() の引数として渡され、ブラウザコンテキストで実行される。
 * @param article - 対象の article DOM 要素
 * @returns 判定用の候補情報
 */
function extractArticleCandidate(article: Element): ArticleCandidate {
  let element: Element | null = article
  let hasScrollAnchorAncestor = false
  while (element) {
    if ((element as HTMLElement).dataset.scrollAnchor !== undefined) {
      hasScrollAnchorAncestor = true
      break
    }
    element = element.parentElement
  }
  return {
    hasScrollAnchorAncestor,
    textContent: article.textContent || ''
  }
}

const WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS = 3

/**
 * ノート詳細ページから本体ノートの article 要素を特定するまで待機する。
 * misskey.io のフロントエンド更新で DOM 構造が変わっても壊れないよう、
 * CSS Modules のハッシュ化クラス名には依存せず、サイドバー除外 + 本文照合
 * （selectNoteArticleIndex）で本体を判定する。
 *
 * 最大 {@link WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS} 回まで、article 要素の
 * 出現待ち → 本体特定 を試行し、reload を挟みながらリトライする。
 * 全て失敗した場合は最終試行時点で全画面デバッグスクショを撮った上で
 * {@link NoteElementNotFoundError} を送出する。
 *
 * @param page - 対象の Puppeteer ページ
 * @param noteId - 対象ノートの ID（ログ・デバッグスクショのファイル名に使用）
 * @param expectedText - 本体ノートの本文（note.cw ?? note.text ?? ''）
 * @returns 本体ノートの article 要素の ElementHandle
 */
async function waitForNoteElement(
  page: Page,
  noteId: string,
  expectedText: string
): Promise<ElementHandle> {
  const logger = Logger.configure(`waitForNoteElement:${noteId}`)

  for (
    let attempt = 1;
    attempt <= WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS;
    attempt++
  ) {
    const isLastAttempt = attempt === WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS

    try {
      await page.waitForSelector('article', { timeout: 10_000 })

      const articleHandles = await page.$$('article')
      const candidates = await Promise.all(
        articleHandles.map((handle) => handle.evaluate(extractArticleCandidate))
      )
      const selection = selectNoteArticleIndex(candidates, expectedText)

      if (selection) {
        if (selection.isAmbiguous) {
          logger.warn(
            `⚠️ Could not uniquely identify note article by text match. Using last candidate. (attempt ${attempt}/${WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS})`
          )
        }
        return articleHandles[selection.index]
      }

      logger.warn(
        `🔄 No non-sidebar article candidate found. (attempt ${attempt}/${WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS})`
      )
    } catch {
      logger.warn(
        `🔄 Failed to wait note element. (attempt ${attempt}/${WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS})`
      )
    }

    if (isLastAttempt) {
      const imageFullPath = `/data/${noteId}.full.png` as const
      await page
        .screenshot({ path: imageFullPath, fullPage: true })
        .catch(() => {
          logger.error(`🚨 Failed to capture full page screenshot`)
        })
      throw new NoteElementNotFoundError(noteId)
    }

    await page.reload()
  }

  // WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS >= 1 である限りここには到達しない
  throw new NoteElementNotFoundError(noteId)
}

/**
 * waitForNoteElement のテスト専用エクスポート。
 * プロダクションコードからは呼び出さず、src/utils.test.ts からのみ利用する。
 */
export const waitForNoteElementForTesting = waitForNoteElement

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
  noteId: string,
  noteText?: string,
  noteCw?: string | null
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
  const expectedText = noteCw ?? noteText ?? ''
  await waitForNoteElement(page, noteId, expectedText)

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
