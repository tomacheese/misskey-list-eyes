# misskey-list-eyes

Collects notes posted on [Misskey](https://misskey-hub.net) through a Misskey list and notifies a Discord webhook with a screenshot of each note.

## Installation

This project is designed to run in Docker. Prepare an environment where Docker works.

First, obtain the required values described in [Configuration](#configuration) and write them to `.env`.

Then write the following to `docker-compose.yml`.

```yaml
version: '3.8'

services:
  app:
    image: ghcr.io/tomacheese/misskey-list-eyes
    volumes:
      - type: bind
        source: ./data
        target: /data
    security_opt:
      - seccomp=./chromium-seccomp.json
    env_file:
      - .env
    init: true
    restart: always
```

Download [chromium-seccomp.json](https://raw.githubusercontent.com/tomacheese/misskey-list-eyes/master/chromium-seccomp.json) next to the Compose file. The profile is based on [Moby's default seccomp profile](https://github.com/moby/profiles/blob/main/seccomp/default.json), distributed under the [Apache License 2.0](chromium-seccomp.LICENSE), and permits the namespace operations Chromium needs for its sandbox. The host must support unprivileged user namespaces. The additional namespace syscalls weaken Docker's default seccomp restrictions for the container.

Create `./data` and ensure it and any existing files are writable by UID and GID 1000, which the container uses. Preserve the existing ledger when migrating from an earlier root-running container. Finally, start it with `docker compose up -d`. The container checks the list every 5 minutes. Notified note IDs are stored in `/data/notified.json`, so keep the `/data` volume. The first run only records the current notes without notifying.

## Configuration

All settings are configured with environment variables.

- `INSTANCE_DOMAIN`: Domain of the Misskey instance
- `LIST_ID`: ID of the list to watch
- `API_ACCESS_TOKEN`: API access token for the Misskey instance. See the [Misskey Hub documentation](https://misskey-hub.net/docs/api/) to obtain one.
- `DISCORD_WEBHOOK_URL`: Discord webhook URL. See the [Discord Help Center article](https://support.discord.com/hc/ja/articles/228383668) (Japanese) to obtain one.

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Lint (prettier, eslint, tsc)
pnpm lint
```

## License

The license for this project is the [MIT License](LICENSE).
