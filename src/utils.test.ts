import type {
  default as puppeteer,
  Browser,
  ElementHandle,
  Page
} from 'puppeteer-core'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest'
import {
  NoteElementNotFoundError,
  initPuppeteerBrowser,
  selectNoteArticleIndex,
  waitForNoteElementForTesting
} from './utils'

const { launchMock } = vi.hoisted(() => ({
  launchMock: vi.fn<typeof puppeteer.launch>()
}))
vi.mock('puppeteer-core', () => ({
  default: { launch: launchMock }
}))

describe('selectNoteArticleIndex', () => {
  it('returns null when there are no candidates', () => {
    const result = selectNoteArticleIndex([], 'ねこ')
    expect(result).toBeNull()
  })

  it('returns null when all candidates come from the sidebar (have a data-scroll-anchor ancestor)', () => {
    const result = selectNoteArticleIndex(
      [
        { hasScrollAnchorAncestor: true, textContent: '無関係なノート1' },
        { hasScrollAnchorAncestor: true, textContent: '無関係なノート2' }
      ],
      'ねこ'
    )
    expect(result).toBeNull()
  })

  it('selects the only non-sidebar candidate without text matching', () => {
    const result = selectNoteArticleIndex(
      [
        { hasScrollAnchorAncestor: true, textContent: '無関係なノート' },
        {
          hasScrollAnchorAncestor: false,
          textContent: '本文が一致しないテキスト'
        }
      ],
      'ねこ'
    )
    expect(result).toEqual({ index: 1, isAmbiguous: false })
  })

  it('selects the single text-matching candidate among multiple non-sidebar candidates', () => {
    const result = selectNoteArticleIndex(
      [
        { hasScrollAnchorAncestor: false, textContent: '返信元ノートの本文' },
        { hasScrollAnchorAncestor: false, textContent: 'sorausa @sorausa ねこ' }
      ],
      'ねこ'
    )
    expect(result).toEqual({ index: 1, isAmbiguous: false })
  })

  it('selects the last candidate with isAmbiguous: true when no non-sidebar candidate matches the text', () => {
    const result = selectNoteArticleIndex(
      [
        { hasScrollAnchorAncestor: false, textContent: '本文A' },
        { hasScrollAnchorAncestor: false, textContent: '本文B' }
      ],
      'ねこ'
    )
    expect(result).toEqual({ index: 1, isAmbiguous: true })
  })

  it('selects the last candidate with isAmbiguous: true when expectedText is empty and there are multiple non-sidebar candidates', () => {
    const result = selectNoteArticleIndex(
      [
        { hasScrollAnchorAncestor: false, textContent: '本文A' },
        { hasScrollAnchorAncestor: false, textContent: '本文B' }
      ],
      ''
    )
    expect(result).toEqual({ index: 1, isAmbiguous: true })
  })

  it('selects the last matching candidate with isAmbiguous: true when multiple non-sidebar candidates match the text', () => {
    const result = selectNoteArticleIndex(
      [
        {
          hasScrollAnchorAncestor: false,
          textContent: 'sorausa @sorausa ねこ'
        },
        { hasScrollAnchorAncestor: false, textContent: '無関係なノート' },
        { hasScrollAnchorAncestor: false, textContent: 'sorausa @sorausa ねこ' }
      ],
      'ねこ'
    )
    expect(result).toEqual({ index: 2, isAmbiguous: true })
  })
})

/**
 * Create a fake ElementHandle for tests.
 * evaluate always returns the given candidate data (the DOM extraction logic itself is out of scope).
 * The dispose mock is returned separately to make verifying its calls easier.
 */
function createFakeArticleHandle(candidate: {
  hasScrollAnchorAncestor: boolean
  textContent: string
}): { handle: ElementHandle; dispose: Mock } {
  const dispose = vi.fn().mockResolvedValue(undefined)
  const handle = {
    evaluate: vi.fn().mockResolvedValue(candidate),
    dispose
  } as unknown as ElementHandle
  return { handle, dispose }
}

describe('waitForNoteElement', () => {
  it('returns the ElementHandle without reloading when one article is found on the first attempt', async () => {
    const target = createFakeArticleHandle({
      hasScrollAnchorAncestor: false,
      textContent: 'sorausa @sorausa ねこ'
    })
    const reload = vi.fn().mockResolvedValue(undefined)
    const page = {
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      $$: vi.fn().mockResolvedValue([target.handle]),
      reload,
      screenshot: vi.fn().mockResolvedValue(undefined)
    } as unknown as Page

    const result = await waitForNoteElementForTesting(page, 'noteId1', 'ねこ')

    expect(result).toBe(target.handle)
    expect(reload).not.toHaveBeenCalled()
  })

  it('disposes unselected ElementHandles but not the selected one after identifying the main note', async () => {
    const sidebar = createFakeArticleHandle({
      hasScrollAnchorAncestor: true,
      textContent: '無関係なノート'
    })
    const target = createFakeArticleHandle({
      hasScrollAnchorAncestor: false,
      textContent: 'sorausa @sorausa ねこ'
    })
    const page = {
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      $$: vi.fn().mockResolvedValue([sidebar.handle, target.handle]),
      reload: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(undefined)
    } as unknown as Page

    const result = await waitForNoteElementForTesting(page, 'noteId4', 'ねこ')

    expect(result).toBe(target.handle)
    expect(sidebar.dispose).toHaveBeenCalledTimes(1)
    expect(target.dispose).not.toHaveBeenCalled()
  })

  it('throws NoteElementNotFoundError after retries when no article is found', async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    const screenshot = vi.fn().mockResolvedValue(undefined)
    const page = {
      waitForSelector: vi.fn().mockRejectedValue(new Error('timeout')),
      $$: vi.fn().mockResolvedValue([]),
      reload,
      screenshot
    } as unknown as Page

    await expect(
      waitForNoteElementForTesting(page, 'noteId2', 'ねこ')
    ).rejects.toThrow(NoteElementNotFoundError)
    // reload is called on every attempt except the last one
    expect(reload).toHaveBeenCalledTimes(2)
    // On final failure, take the full-page debug screenshot exactly once
    expect(screenshot).toHaveBeenCalledTimes(1)
    expect(screenshot).toHaveBeenCalledWith({
      path: '/data/noteId2.full.png',
      fullPage: true
    })
  })

  it('also retries when articles are found but all come from the sidebar', async () => {
    const sidebar = createFakeArticleHandle({
      hasScrollAnchorAncestor: true,
      textContent: '無関係なノート'
    })
    const reload = vi.fn().mockResolvedValue(undefined)
    const page = {
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      $$: vi.fn().mockResolvedValue([sidebar.handle]),
      reload,
      screenshot: vi.fn().mockResolvedValue(undefined)
    } as unknown as Page

    await expect(
      waitForNoteElementForTesting(page, 'noteId3', 'ねこ')
    ).rejects.toThrow(NoteElementNotFoundError)
    expect(reload).toHaveBeenCalledTimes(2)
    // When the main note cannot be identified, all candidates are disposed on every attempt
    expect(sidebar.dispose).toHaveBeenCalledTimes(3)
  })
})

describe('initPuppeteerBrowser', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    launchMock.mockReset()
  })

  it('returns the Browser immediately when launch succeeds', async () => {
    const browser = {} as Browser
    launchMock.mockResolvedValueOnce(browser)

    const result = await initPuppeteerBrowser()

    expect(result).toBe(browser)
    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60_000 })
    )
  })

  it('retries and returns the Browser when launch succeeds after a transient failure', async () => {
    const browser = {} as Browser
    launchMock
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(browser)

    const promise = initPuppeteerBrowser()
    // Verify the next launch is not called until the pre-retry wait has elapsed
    await vi.advanceTimersByTimeAsync(9999)
    expect(launchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const result = await promise

    expect(result).toBe(browser)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('throws the last error when every attempt up to the maximum fails', async () => {
    const errors = [
      new Error('1st timeout'),
      new Error('2nd timeout'),
      new Error('3rd timeout')
    ]
    launchMock
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2])

    const promise = initPuppeteerBrowser()
    const assertion = expect(promise).rejects.toBe(errors[2])
    await vi.runAllTimersAsync()
    await assertion

    expect(launchMock).toHaveBeenCalledTimes(3)
  })
})
