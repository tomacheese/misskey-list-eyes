import { selectNoteArticleIndex } from './utils'

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
