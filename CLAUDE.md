# CLAUDE.md

## 目的
このドキュメントは、Claude Code の作業方針とプロジェクト固有のルールを示します。

## 判断記録のルール
判断を行った際は、以下の内容を記録してください。
- 判断内容の要約
- 検討した代替案
- 採用しなかった案とその理由
- 前提条件・仮定・不確実性
- 他エージェントによるレビュー可否

## プロジェクト概要
- 目的: Misskey のリストを監視し、Discord に通知する。
- 主な機能: API 連携、Puppeteer によるスクリーンショット撮影、Discord Webhook 通知。

## 重要ルール
- **会話言語**: 日本語
- **コミット規約**: Conventional Commits (description は日本語)
- **コメント言語**: 日本語
- **エラーメッセージ**: 英語
- **日本語と英数字の間**: 半角スペースを挿入

## 環境のルール
- **ブランチ命名**: Conventional Branch (feat/xxx, fix/xxx)
- **GitHub 調査**: 必要に応じてテンポラリディレクトリに clone して検索
- **Renovate**: Renovate が作成した PR への追加コミットや更新は禁止

## Git Worktree
Git Worktree を使用する場合は、以下の構成にしてください。
- `.bare/` (bare リポジトリ)
- `<branch_name>/` (各ブランチの worktree)

## コード改修時のルール
- エラーメッセージの先頭に絵文字がある場合、新しいメッセージにも同様に絵文字を設定する。
- TypeScript の `skipLibCheck` による回避は禁止。
- 関数やインターフェースには JSDoc 形式の docstring を日本語で記載することを推奨する（新規追加時は付与）。

## 相談ルール
- **Codex CLI**: 実装レビュー、局所設計、整合性確認。
- **Gemini CLI**: 外部仕様、最新情報の確認。
- **指摘への対応**: 指摘（信頼度 50 以上）には必ず対応し、黙殺しない。

## 開発コマンド
```bash
# 依存関係インストール
yarn install

# 実行・開発
yarn start
yarn dev

# ビルド・パッケージング
yarn package
yarn compile
yarn clean

# Lint/Format
yarn lint
yarn fix
```

## アーキテクチャと主要ファイル
- `src/main.ts`: エントリーポイント、メインロジック。
- `src/misskey.ts`: Misskey API の型定義。
- `src/discord.ts`: Discord Webhook 連携。
- `src/notified.ts`: 通知済みノートの管理。
- `src/utils.ts`: Puppeteer の初期化や画像保存などのユーティリティ。

## 作業チェックリスト

### 新規改修時
1. [ ] プロジェクトを理解したか
2. [ ] 作業ブランチが適切か（クローズ済みでないか）
3. [ ] 最新のリモートブランチに基づいているか
4. [ ] 依存パッケージをインストールしたか

### コミット・プッシュ前
1. [ ] Conventional Commits に従っているか
2. [ ] センシティブな情報が含まれていないか
3. [ ] Lint / Format エラーがないか
4. [ ] 動作確認を行ったか

### PR 作成前
1. [ ] PR 作成の依頼をユーザーから受けたか
2. [ ] コンフリクトの恐れがないか

### PR 作成後
1. [ ] PR 本文が最新の状態を網羅しているか
2. [ ] GitHub Actions CI の結果を確認したか
3. [ ] コードレビューの指摘に対応したか
