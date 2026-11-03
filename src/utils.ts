import puppeteer from 'puppeteer-core'
import type { Browser, ElementHandle, Page } from 'puppeteer-core'
import fs from 'node:fs'
import { Logger } from '@book000/node-utils'

/**
 * Information about a candidate note article element, used to pick the main note.
 * Plain data extracted in the browser context and passed to the Node.js side.
 */
export interface ArticleCandidate {
  /** Whether the element has a `data-scroll-anchor` ancestor (sidebar, not the main note) */
  hasScrollAnchorAncestor: boolean
  /** Text content of the article element */
  textContent: string
}

/**
 * Result of selectNoteArticleIndex.
 */
export interface NoteArticleSelection {
  /** Index of the selected element in the candidates array */
  index: number
  /** True if the text match was not unique and the selection is a fallback */
  isAmbiguous: boolean
}

/**
 * Select the main note's article from the candidate articles on a note detail page.
 *
 * When /notes/:id is opened without logging in, misskey.io also renders many unrelated
 * article elements inside the sidebar timeline preview widget. These are descendants of an
 * element with a data-scroll-anchor attribute, so they are excluded first, and the remaining
 * candidates are matched against the text fetched from the API (cw if present, otherwise text).
 *
 * @param candidates - Candidates extracted from all article elements on the page
 * @param expectedText - Text of the main note (note.cw ?? note.text ?? '')
 * @returns The selection, or null if no candidate remains after exclusion
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
      // Multiple candidates match, so the main note cannot be identified uniquely.
      // Tentatively pick the last one in DOM order and set isAmbiguous
      const lastMatchedIndex = matchedIndices.at(-1)
      if (lastMatchedIndex !== undefined) {
        return { index: lastMatchedIndex, isAmbiguous: true }
      }
    }
  }

  const lastIndex = nonSidebarIndices.at(-1)
  // Unreachable: an empty nonSidebarIndices already returned at the top of the function
  return lastIndex === undefined
    ? null
    : {
        index: lastIndex,
        isAmbiguous: true
      }
}

const PUPPETEER_LAUNCH_TIMEOUT_MS = 60_000
const PUPPETEER_LAUNCH_MAX_ATTEMPTS = 3
// When launch fails, puppeteer waits up to 5 seconds for a process without a CDP connection
// before sending SIGKILL (BrowserLauncher's graceful shutdown grace period).
// Relaunching sooner than that lets the old process's shutdown and the new process's startup
// compete for resources and can cause another timeout, so use a value well above the grace period
const PUPPETEER_LAUNCH_RETRY_DELAY_MS = 10_000

/**
 * Launch Puppeteer (Chromium).
 *
 * On resource-constrained hosts such as a Raspberry Pi, contention with other processes can make
 * Chromium's startup (printing the WS endpoint URL) exceed puppeteer's default timeout. The timeout
 * is therefore extended to {@link PUPPETEER_LAUNCH_TIMEOUT_MS}, and launching is retried up to
 * {@link PUPPETEER_LAUNCH_MAX_ATTEMPTS} times to absorb transient failures.
 * @returns The launched Puppeteer Browser instance
 */
export async function initPuppeteerBrowser(): Promise<Browser> {
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
  const logger = Logger.configure('initPuppeteerBrowser')

  for (let attempt = 1; attempt <= PUPPETEER_LAUNCH_MAX_ATTEMPTS; attempt++) {
    try {
      return await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/chromium-browser',
        args: puppeteerArguments,
        defaultViewport: {
          width: 1920,
          height: 1080
        },
        timeout: PUPPETEER_LAUNCH_TIMEOUT_MS
      })
    } catch (error) {
      const isLastAttempt = attempt === PUPPETEER_LAUNCH_MAX_ATTEMPTS
      if (isLastAttempt) {
        throw error
      }
      logger.warn(
        `🔄 Failed to launch Puppeteer browser. (attempt ${attempt}/${PUPPETEER_LAUNCH_MAX_ATTEMPTS})`,
        error as Error
      )
      await new Promise<void>((resolve) =>
        setTimeout(resolve, PUPPETEER_LAUNCH_RETRY_DELAY_MS)
      )
    }
  }

  // Unreachable as long as PUPPETEER_LAUNCH_MAX_ATTEMPTS >= 1
  throw new Error('Failed to launch Puppeteer browser')
}

/**
 * Thrown when the main note's article element cannot be identified.
 */
export class NoteElementNotFoundError extends Error {
  constructor(noteId: string) {
    super(`Failed to identify note article element for noteId=${noteId}`)
    this.name = 'NoteElementNotFoundError'
  }
}

/**
 * Extract candidate information for selectNoteArticleIndex from an article element.
 * Passed to ElementHandle.evaluate() and executed in the browser context.
 * @param article - The article DOM element
 * @returns Candidate information used for selection
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
 * Wait on a note detail page until the main note's article element is identified.
 * To survive misskey.io frontend DOM changes, it does not rely on hashed CSS Modules class names;
 * it excludes sidebar articles and matches the text (selectNoteArticleIndex).
 *
 * Up to {@link WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS} attempts are made (wait for articles, then
 * identify the main one), reloading the page between attempts. If all fail, a full-page debug
 * screenshot is taken on the last attempt and {@link NoteElementNotFoundError} is thrown.
 *
 * @param page - The Puppeteer page
 * @param noteId - The note ID (used in logs and the debug screenshot file name)
 * @param expectedText - Text of the main note (note.cw ?? note.text ?? '')
 * @returns ElementHandle of the main note's article element
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
        // Dispose unselected ElementHandles to avoid leaking them
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

      // No main note identified, so no candidate is needed; dispose them all
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

  // Unreachable as long as WAIT_FOR_NOTE_ELEMENT_MAX_ATTEMPTS >= 1
  throw new NoteElementNotFoundError(noteId)
}

/**
 * Test-only export of waitForNoteElement.
 * Not called from production code; used only by src/utils.test.ts.
 */
export const waitForNoteElementForTesting = waitForNoteElement

/**
 * Click the CW (content warning) expand button inside the identified main note's article
 * to reveal the hidden text.
 *
 * Button class names can change with every misskey.io build, so the button is
 * identified by its text content (starting with 「もっと見る」, the Misskey UI label).
 * If no button is found, a warning is logged and the capture continues with the CW closed
 * (no exception is thrown, to avoid endless retries).
 *
 * @param article - The main note's article element identified by waitForNoteElement
 */
async function revealContentWarning(article: ElementHandle): Promise<void> {
  const logger = Logger.configure('revealContentWarning')
  const buttons = await article.$$('button')

  for (const button of buttons) {
    // element.textContent is never null for an Element per the spec, but fall back to ''
    // defensively as in extractArticleCandidate
    // (`||` is used because `??` violates @typescript-eslint/no-unnecessary-condition)
    const text = await button.evaluate((element) =>
      (element.textContent || '').trim()
    )
    if (text.startsWith('もっと見る')) {
      // The Vue handler listens for mousedown, so dispatch a mousedown event instead of clicking
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
 * Click the sensitive media matching the given file IDs inside the identified main note's
 * article to reveal it.
 *
 * Targets are located by the semantic data-id attribute (equal to the Misskey API's file.id).
 * Clicking opens a PhotoSwipe lightbox, closed with the Escape key; PhotoSwipe's `.pswp` class
 * is stable, unlike misskey.io's hashed class names.
 *
 * @param article - The main note's article element identified by waitForNoteElement
 * @param page - The Puppeteer page (used to send the Escape key)
 * @param sensitiveFileIds - IDs of note.files entries whose isSensitive is true
 */
async function revealSensitiveFiles(
  article: ElementHandle,
  page: Page,
  sensitiveFileIds: string[]
): Promise<void> {
  const logger = Logger.configure('revealSensitiveFiles')

  for (const fileId of sensitiveFileIds) {
    // Do not pin the tag name (div), which could break if misskey.io changes the element type;
    // match on the data-id attribute only
    const mediaElement = await article.$(`[data-id="${fileId}"]`)
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
 * Save the identified main note's article element as a screenshot.
 * Using ElementHandle.screenshot() avoids computing the clip region manually
 * (getBoundingClientRect).
 *
 * @param article - The main note's article element identified by waitForNoteElement
 * @param noteId - The note ID used in the saved file name
 * @returns Absolute path of the saved image
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
 * Return value of downloadNotePreviewImage.
 */
export interface DownloadNotePreviewImageResult {
  /**
   * Absolute path of the captured image.
   * When capturing is impossible (e.g. the main article cannot be identified), an exception such as
   * NoteElementNotFoundError is thrown instead of returning null, so this is always a valid path
   */
  imagePath: string
}

/**
 * Open the given note's detail page and save the main note as a screenshot.
 *
 * CW (content warning) and sensitive-media detection does not inspect the DOM; it uses values
 * the caller (main.ts) computed from the Misskey API response.
 *
 * @param browser - The Puppeteer Browser instance
 * @param instanceDomain - Domain of the Misskey instance
 * @param noteId - The target note ID
 * @param expectedText - Text of the main note (note.cw ?? note.text ?? ''), used to identify
 *   the main article uniquely
 * @param hasCW - Whether the note has a CW (note.cw != null)
 * @param sensitiveFileIds - IDs of note.files entries whose isSensitive is true
 * @returns The capture result
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
    // Always close the page to avoid page leaks (memory growth) when processing many notes
    await page.close().catch(() => {
      logger.warn('⚠️ Failed to close page')
    })
  }
}
