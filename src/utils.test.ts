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
  it('候補が0件の場合は null を返す', () => {
    const result = selectNoteArticleIndex([], 'ねこ')
    expect(result).toBeNull()
  })

  it('全候補がサイドバー由来（data-scroll-anchor祖先あり）の場合は null を返す', () => {
    const result = selectNoteArticleIndex(
      [
        { hasScrollAnchorAncestor: true, textContent: '無関係なノート1' },
        { hasScrollAnchorAncestor: true, textContent: '無関係なノート2' }
      ],
      'ねこ'
    )
    expect(result).toBeNull()
  })

  it('非サイドバー候補が1件のみの場合は本文照合なしでそれを採用する', () => {
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

  it('複数の非サイドバー候補があり、本文が一致するものが1件ある場合はそれを採用する', () => {
    const result = selectNoteArticleIndex(
      [
        { hasScrollAnchorAncestor: false, textContent: '返信元ノートの本文' },
        { hasScrollAnchorAncestor: false, textContent: 'sorausa @sorausa ねこ' }
      ],
      'ねこ'
    )
    expect(result).toEqual({ index: 1, isAmbiguous: false })
  })

  it('複数の非サイドバー候補があり、本文が一致するものがない場合は最後の候補を採用し isAmbiguous: true を返す', () => {
    const result = selectNoteArticleIndex(
      [
        { hasScrollAnchorAncestor: false, textContent: '本文A' },
        { hasScrollAnchorAncestor: false, textContent: '本文B' }
      ],
      'ねこ'
    )
    expect(result).toEqual({ index: 1, isAmbiguous: true })
  })

  it('expectedText が空文字列で非サイドバー候補が複数ある場合は最後の候補を採用し isAmbiguous: true を返す', () => {
    const result = selectNoteArticleIndex(
      [
        { hasScrollAnchorAncestor: false, textContent: '本文A' },
        { hasScrollAnchorAncestor: false, textContent: '本文B' }
      ],
      ''
    )
    expect(result).toEqual({ index: 1, isAmbiguous: true })
  })

  it('複数の非サイドバー候補があり、本文が一致するものが複数件ある場合は最後に一致した候補を採用し isAmbiguous: true を返す', () => {
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
 * テスト用の ElementHandle フェイクを作成する。
 * evaluate は常に渡された candidate データを返す（DOM 抽出ロジック自体は対象外）。
 * dispose の呼び出し検証をしやすいよう、モック関数の参照を別途返す。
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
  it('1回目で article が1件見つかれば reload せずに ElementHandle を返す', async () => {
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

  it('本体特定後、選択されなかった ElementHandle を dispose し、選択された handle は dispose しない', async () => {
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

  it('article 自体が見つからない場合、最大3回リトライした後 NoteElementNotFoundError を投げる', async () => {
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
    // 3回試行し、最後の1回を除く2回で reload が呼ばれる
    expect(reload).toHaveBeenCalledTimes(2)
    // 最終失敗時に全画面デバッグスクショを1回だけ撮る
    expect(screenshot).toHaveBeenCalledTimes(1)
    expect(screenshot).toHaveBeenCalledWith({
      path: '/data/noteId2.full.png',
      fullPage: true
    })
  })

  it('article は見つかるがサイドバー由来のみで本体を特定できない場合もリトライする', async () => {
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
    // 本体を特定できなかった場合は全候補を毎試行 dispose する
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

  it('起動に成功すれば即座に Browser を返す', async () => {
    const browser = {} as Browser
    launchMock.mockResolvedValueOnce(browser)

    const result = await initPuppeteerBrowser()

    expect(result).toBe(browser)
    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60_000 })
    )
  })

  it('一時的な失敗の後に成功すればリトライして Browser を返す', async () => {
    const browser = {} as Browser
    launchMock
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(browser)

    const promise = initPuppeteerBrowser()
    // リトライ前の待機（10秒）が経過するまでは次の launch が呼ばれないことを確認する
    await vi.advanceTimersByTimeAsync(9999)
    expect(launchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const result = await promise

    expect(result).toBe(browser)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('最大試行回数まで失敗し続けた場合は最後のエラーを投げる', async () => {
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
