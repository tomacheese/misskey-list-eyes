# GEMINI.md

## 目的
このドキュメントは、Gemini CLI 向けのコンテキストと作業方針を定義します。

## 出力スタイル
- **言語**: 日本語
- **トーン**: 簡潔かつ専門的
- **形式**: GitHub Flavored Markdown

## 共通ルール
- 会話は日本語で行う。
- コミットメッセージは Conventional Commits に従い、description は日本語で記載する。
- 日本語と英数字の間には半角スペースを入れる。

## プロジェクト概要
- **目的**: Misskey のリストタイムラインを監視し、ノートを Discord Webhook に通知する。
- **主な機能**: Misskey API 連携、Puppeteer によるスクリーンショット撮影、Discord 通知。

## コーディング規約
- **コメント**: 日本語
- **エラーメッセージ**: 英語
- **TypeScript**: `skipLibCheck` 禁止。関数やインターフェースには JSDoc 形式の docstring を日本語で記載することを推奨（新規追加時は付与）。

## 開発コマンド
```bash
# 依存関係インストール
yarn install

# 開発・実行
yarn dev
yarn start

# ビルド
yarn package

# チェック・修正
yarn lint
yarn fix
```

## 注意事項
- 認証情報（アクセストークン等）をコミットに含めない。
- 既存のコーディングルールやアーキテクチャを優先する。
- Puppeteer の動作環境に依存することに注意する。

## リポジトリ固有事項
- 通知済みノートは `data/notified.json`（デフォルト、`NOTIFIED_PATH` 環境変数で上書き可能）で管理されているため、実際の挙動は `src/notified.ts` の実装を確認すること。
