// puppeteer-core は ESM 専用パッケージであり、ts-jest (CommonJS) から
// 直接 import すると失敗するため、テスト用の最小モックに差し替える。
export default {}
export class Browser {}
export class Page {}
