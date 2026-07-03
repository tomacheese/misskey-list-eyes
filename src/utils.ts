import puppeteer from 'puppeteer-core'
import type { Browser, ElementHandle, Page } from 'puppeteer-core'
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
    if (matchedIndices.length === 1) {
      return { index: matchedIndices[0], isAmbiguous: false }
    }
    if (matchedIndices.length > 1) {
      // 複数候補が本文と一致した場合は一意に特定できないため、
      // 末尾（DOM 上で最後に出現する候補）を暫定選択しつつ isAmbiguous を立てる
      const lastMatchedIndex = matchedIndices.at(-1)
      if (lastMatchedIndex !== undefined) {
        return { index: lastMatchedIndex, isAmbiguous: true }
      }
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
        // 選択されなかった ElementHandle はリークしないよう破棄する
        await Promise.all(
          articleHandles
            .filter((_, index) => index !== selection.index)
            .map((handle) =>
              handle.dispose().catch(() => {
                logger.warn('⚠️ Failed to dispose unused article handle')
              })
            )
        )
        return articleHandles[selection.index]
      }

      // 本体を特定できなかった場合は全ての候補が不要になるため破棄する
      await Promise.all(
        articleHandles.map((handle) =>
          handle.dispose().catch(() => {
            logger.warn('⚠️ Failed to dispose unused article handle')
          })
        )
      )

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

/**
 * 特定済みの本体ノート article 内の CW（閲覧注意）展開ボタンをクリックし、
 * 隠れている本文を表示する。
 *
 * ボタンのクラス名（xd2wm 等）は misskey.io のビルドごとに変わりうるため、
 * ボタンのテキスト内容（「もっと見る」で始まるか）で判定する。
 * ボタンが見つからない場合は警告ログを出し、CW を閉じたまま撮影を続行する
 * （無限リトライを避けるため、ここでは例外を投げない）。
 *
 * @param article - waitForNoteElement で特定した本体ノートの article 要素
 */
async function revealContentWarning(article: ElementHandle): Promise<void> {
  const logger = Logger.configure('revealContentWarning')
  const buttons = await article.$$('button')

  for (const button of buttons) {
    // element.textContent は仕様上 Element では null にならないが、
    // extractArticleCandidate と同様に念のため空文字へフォールバックする
    // （`??` は @typescript-eslint/no-unnecessary-condition に抵触するため `||` を使う）
    const text = await button.evaluate((element) =>
      (element.textContent || '').trim()
    )
    if (text.startsWith('もっと見る')) {
      // Vue 側のハンドラが mousedown を購読しているため click ではなく
      // mousedown イベントを dispatch する（既存実装を踏襲）
      await button.evaluate((element) => {
        element.dispatchEvent(new Event('mousedown'))
      })
      return
    }
  }

  logger.warn(
    '⚠️ Content warning reveal button not found. Continuing without reveal.'
  )
}

/**
 * 特定済みの本体ノート article 内の、指定されたファイルIDに対応する
 * センシティブメディアをクリックして表示する。
 *
 * クリック対象は misskey.io がメディア添付要素に付与するセマンティックな
 * data-id 属性（Misskey API の file.id と一致する）で特定するため、
 * CSS Modules のハッシュ化クラス名には依存しない。クリックすると
 * PhotoSwipe のライトボックスが開くため、Escape キー送信で閉じる
 * （PhotoSwipe はサードパーティ製ライブラリであり、misskey.io 自身の
 * ビルドでクラス名がハッシュ化されるクラス名とは異なり比較的安定している
 * ため、ライトボックスの出現待ちには .pswp セレクタを使う）。
 *
 * @param article - waitForNoteElement で特定した本体ノートの article 要素
 * @param page - 対象の Puppeteer ページ（Escape キー送信に使用）
 * @param sensitiveFileIds - note.files のうち isSensitive が true のファイルID一覧
 */
async function revealSensitiveFiles(
  article: ElementHandle,
  page: Page,
  sensitiveFileIds: string[]
): Promise<void> {
  const logger = Logger.configure('revealSensitiveFiles')

  for (const fileId of sensitiveFileIds) {
    const mediaElement = await article.$(`div[data-id="${fileId}"]`)
    if (!mediaElement) {
      logger.warn(
        `⚠️ Sensitive media element not found for fileId=${fileId}. Continuing without reveal.`
      )
      continue
    }

    await mediaElement.click()
    await page.waitForSelector('.pswp', { timeout: 5000 }).catch(() => {
      logger.warn(`⚠️ Lightbox did not open for fileId=${fileId}. Continuing.`)
    })
    await page.keyboard.press('Escape').catch(() => undefined)
  }
}

/**
 * 特定済みの本体ノート article 要素をスクリーンショットとして保存する。
 * ElementHandle.screenshot() を使うことで、クリップ範囲の手動計算
 * （getBoundingClientRect）を不要にする。
 *
 * @param article - waitForNoteElement で特定した本体ノートの article 要素
 * @param noteId - 保存ファイル名に使用するノートID
 * @returns 保存した画像の絶対パス
 */
async function captureNote(
  article: ElementHandle,
  noteId: string
): Promise<string> {
  const imagePath = `/tmp/${noteId}.png` as const

  await article.evaluate((element) => {
    element.scrollIntoView()
  })
  await article.screenshot({ path: imagePath })

  return imagePath
}

/**
 * downloadNotePreviewImage の戻り値。
 */
export interface DownloadNotePreviewImageResult {
  /** 撮影した画像の絶対パス。本体 article の特定に失敗した場合は null */
  imagePath: string | null
}

/**
 * 指定したノートの詳細ページにアクセスし、本体ノート部分をスクリーンショットとして
 * ダウンロードする。
 *
 * CW（閲覧注意）・NSFW（センシティブメディア）の判定は DOM を見ずに、
 * 呼び出し元（main.ts）が Misskey API のレスポンスから計算した値を
 * 受け取って利用する。
 *
 * @param browser - Puppeteer の Browser インスタンス
 * @param instanceDomain - Misskey インスタンスのドメイン
 * @param noteId - 対象ノートのID
 * @param expectedText - 本体ノートの本文（note.cw ?? note.text ?? ''）。
 *   本体 article の一意特定に使用する
 * @param hasCW - 対象ノートが CW 付きかどうか（note.cw != null）
 * @param sensitiveFileIds - note.files のうち isSensitive が true のファイルID一覧
 * @returns 撮影結果
 */
export async function downloadNotePreviewImage(
  browser: Browser,
  instanceDomain: string,
  noteId: string,
  expectedText: string,
  hasCW: boolean,
  sensitiveFileIds: string[]
): Promise<DownloadNotePreviewImageResult> {
  const logger = Logger.configure('downloadNotePreviewImage')
  // /tmp がなかったら作る
  if (!fs.existsSync('/tmp')) {
    fs.mkdirSync('/tmp')
  }

  const url = `https://${instanceDomain}/notes/${noteId}`

  logger.info('✨ Access to note page')
  const page = await browser.newPage()
  try {
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: 'dark' }
    ])
    await page.goto(url, { waitUntil: 'networkidle2' })

    logger.info('✨ Wait for note element')
    const article = await waitForNoteElement(page, noteId, expectedText)

    if (hasCW) {
      logger.info('✨ Reveal content warning')
      await revealContentWarning(article)
    }

    if (sensitiveFileIds.length > 0) {
      logger.info('✨ Reveal sensitive files')
      await revealSensitiveFiles(article, page, sensitiveFileIds)
    }

    logger.info('✨ Capture note screenshot')
    const imagePath = await captureNote(article, noteId)

    return { imagePath }
  } finally {
    // ページを確実に閉じることで、複数ノート処理時のページリーク（メモリ肥大化）を防ぐ
    await page.close().catch(() => {
      logger.warn('⚠️ Failed to close page')
    })
  }
}
