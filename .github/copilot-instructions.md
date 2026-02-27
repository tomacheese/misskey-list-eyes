# GitHub Copilot Instructions

## プロジェクト概要
- 目的: Misskey の特定のリストのタイムラインを監視し、ノートを Discord Webhook に通知する。
- 主な機能:
  - Misskey API を使用したリストタイムラインの取得
  - Puppeteer を使用したノートのスクリーンショット撮影
  - Discord Webhook への画像付き通知
  - 通知済みノートの管理（重複通知防止）
- 対象ユーザー: 開発者、Misskey/Discord 利用者

## 共通ルール
- 会話は日本語で行う。
- PR とコミットは [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) に従う。
  - `<type>(<scope>): <description>` 形式
  - `<description>` は日本語で記載
- ブランチ命名は [Conventional Branch](https://conventional-branch.github.io) に従う。
- 日本語と英数字の間には半角スペースを入れる。

## 技術スタック
- 言語: TypeScript
- 実行環境: Node.js (ts-node, ts-node-dev)
- ライブラリ: Puppeteer (スクリーンショット), Axios (API 通信), @book000/node-utils (Logger)
- パッケージマネージャー: yarn

## 開発コマンド
```bash
# 依存関係のインストール
yarn install

# 開発（ホットリロードあり）
yarn dev

# 実行
yarn start

# ビルド（配布用パッケージの作成）
yarn package

# Lint チェック
yarn lint

# Lint 自動修正
yarn fix
```

## コーディング規約
- TypeScript の `skipLibCheck` を使用したエラー回避は禁止。
- 関数やインターフェースには JSDoc 形式の docstring を日本語で記載することを推奨する（新規追加時は付与）。
- 命名規則はプロジェクトの既存のコード（camelCase）に従う。

## セキュリティ / 機密情報
- `INSTANCE_DOMAIN`, `LIST_ID`, `API_ACCESS_TOKEN`, `DISCORD_WEBHOOK_URL` などの機密情報をコードに含めたり、コミットしたりしない。
- ログに機密情報を出力しない。

## ドキュメント更新
- プロジェクトの構成や依存関係に変更があった場合は `README.md` を更新する。
