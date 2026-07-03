import type { ElementHandle, Page } from 'puppeteer-core'
import {
  NoteElementNotFoundError,
  selectNoteArticleIndex,
  waitForNoteElementForTesting
} from './utils'

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
})

/**
 * テスト用の ElementHandle フェイクを作成する。
 * evaluate は常に渡された candidate データを返す（DOM 抽出ロジック自体は対象外）。
 */
function createFakeArticleHandle(candidate: {
  hasScrollAnchorAncestor: boolean
  textContent: string
}): ElementHandle {
  return {
    evaluate: jest.fn().mockResolvedValue(candidate)
  } as unknown as ElementHandle
}

describe('waitForNoteElement', () => {
  it('1回目で article が1件見つかれば reload せずに ElementHandle を返す', async () => {
    const targetHandle = createFakeArticleHandle({
      hasScrollAnchorAncestor: false,
      textContent: 'sorausa @sorausa ねこ'
    })
    const reload = jest.fn().mockResolvedValue(undefined)
    const page = {
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      $$: jest.fn().mockResolvedValue([targetHandle]),
      reload,
      screenshot: jest.fn().mockResolvedValue(undefined)
    } as unknown as Page

    const result = await waitForNoteElementForTesting(page, 'noteId1', 'ねこ')

    expect(result).toBe(targetHandle)
    expect(reload).not.toHaveBeenCalled()
  })

  it('article 自体が見つからない場合、最大3回リトライした後 NoteElementNotFoundError を投げる', async () => {
    const reload = jest.fn().mockResolvedValue(undefined)
    const screenshot = jest.fn().mockResolvedValue(undefined)
    const page = {
      waitForSelector: jest.fn().mockRejectedValue(new Error('timeout')),
      $$: jest.fn().mockResolvedValue([]),
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
    const sidebarHandle = createFakeArticleHandle({
      hasScrollAnchorAncestor: true,
      textContent: '無関係なノート'
    })
    const reload = jest.fn().mockResolvedValue(undefined)
    const page = {
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      $$: jest.fn().mockResolvedValue([sidebarHandle]),
      reload,
      screenshot: jest.fn().mockResolvedValue(undefined)
    } as unknown as Page

    await expect(
      waitForNoteElementForTesting(page, 'noteId3', 'ねこ')
    ).rejects.toThrow(NoteElementNotFoundError)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
