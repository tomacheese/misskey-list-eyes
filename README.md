# misskey-list-eyes

[Misskey](https://misskey-hub.net) に投稿されたノートをリスト機能を用いて収集し、Discord Webhook を用いて通知します。

## Configuration

すべての設定は環境変数を用いて行います。

- `INSTANCE_DOMAIN`: Misskey インスタンスのドメイン
- `LIST_ID`: リストの ID
- `API_ACCESS_TOKEN`: Misskey インスタンスの API アクセストークン
- `DISCORD_WEBHOOK_URL`: Discord Webhook の URL
