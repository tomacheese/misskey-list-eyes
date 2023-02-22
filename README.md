# misskey-list-eyes

[Misskey](https://misskey-hub.net) に投稿されたノートをリスト機能を用いて収集し、Discord Webhook を用いて通知します。

## Installation

Docker で動作することを前提としています。Docker が動作する環境を用意してください。

まず、[Configuration](#configuration) を参考に必要な情報を入手してください。  
入手した情報は `.env` に書き込んでください。

その後、以下を `docker-compose.yml` に書き込みます。

```yaml
version: '3.8'

services:
  app:
    image: ghcr.io/tomacheese/misskey-list-eyes
    volumes:
      - type: bind
        source: ./data
        target: /data
    env_file:
      - .env
    init: true
    restart: always
```

最後に、`docker-compose up --build -d` で起動します。

## Configuration

すべての設定は環境変数を用いて行います。

- `INSTANCE_DOMAIN`: Misskey インスタンスのドメイン
- `LIST_ID`: リストの ID
- `API_ACCESS_TOKEN`: Misskey インスタンスの API アクセストークン。[Misskey Hub の記事](https://misskey-hub.net/docs/api/) を参考に入手してください。
- `DISCORD_WEBHOOK_URL`: Discord Webhook の URL。[Discord ヘルプセンターの記事](https://support.discord.com/hc/ja/articles/228383668) を参考に入手してください。

## License

このプロジェクトのライセンスは [MIT License](LICENSE) です。  
The license for this project is [MIT License](LICENSE).
