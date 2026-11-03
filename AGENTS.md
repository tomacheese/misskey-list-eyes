# AGENTS.md

## Language

- All deliverables are written in English: commit messages, PR/Issue text, review comments, code comments and JSDoc, and documentation (README, AGENTS.md, etc.).
- Exceptions: end-user-facing message text and localized UI strings (e.g. the Discord embed title and the Misskey UI label `もっと見る` that the screenshot code matches), quotations, technical identifiers, external text, and generated files.
- Error and log messages are in English.

## Overview

misskey-list-eyes watches a Misskey list timeline, takes a screenshot of each new note with Puppeteer, and posts it to a Discord webhook. It runs in Docker (`entrypoint.sh` loops forever: run `src/main.ts`, then sleep 5 minutes).

## Commands

Package manager is pnpm (enforced by `preinstall`).

```bash
pnpm install   # install dependencies
pnpm start     # run src/main.ts with tsx
pnpm dev       # tsx watch (hot reload)
pnpm test      # vitest run
pnpm lint      # prettier --check src, eslint, tsc (run via run-z)
pnpm fix       # prettier --write src, eslint --fix
```

CI (`.github/workflows/nodejs-ci-pnpm.yml`) uses the shared `book000/templates` reusable workflow; Docker images are built by `.github/workflows/docker.yml`.

## Architecture

- `src/main.ts`: entry point. Validates env vars, fetches the list timeline with `fetch`, skips notes younger than 5 minutes, screenshots each note, sends it to Discord, and records it as notified. A per-note screenshot failure is logged and the note is retried on the next loop iteration.
- `src/misskey.ts`: Misskey API types.
- `src/discord.ts`: Discord webhook client (sends via `fetch`).
- `src/notified.ts`: notified-note store at `data/notified.json` (override with `NOTIFIED_PATH`; the Docker image sets `/data/notified.json`). On the first run (no file) existing notes are recorded without notifying.
- `src/utils.ts`: Puppeteer (`puppeteer-core`) launch with retry, main-article selection, CW/sensitive-media reveal and screenshot capture.
- `src/utils.test.ts`: Vitest tests (`src/*.test.ts`).

Configuration is via environment variables: `INSTANCE_DOMAIN`, `LIST_ID`, `API_ACCESS_TOKEN`, `DISCORD_WEBHOOK_URL`, and optionally `NOTIFIED_PATH`.

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/); branches follow [Conventional Branch](https://conventional-branch.github.io) (`feat/xxx`, `fix/xxx`).
- Do not add commits to PRs created by Renovate.
- Use native `fetch` for HTTP; do not add axios or other HTTP client libraries.
- Do not work around TypeScript errors with `skipLibCheck`.
- Add JSDoc to new functions and interfaces.
- If an existing error/log message starts with an emoji, give new messages the same style.
- Do not depend on hashed CSS Modules class names of misskey.io; identify elements by semantic attributes or text.
- Update `README.md` when project structure or dependencies change.
- Review findings with confidence >= 50 must always be addressed, never silently ignored.
- Git Worktree layout: `.bare/` holds the bare repository and `<branch_name>/` holds each branch's worktree.

## Testing

- Vitest; tests live in `src/*.test.ts`. Add or update tests when changing logic.
- Run `pnpm lint` and `pnpm test` before committing.

## Security

- Never put or commit `INSTANCE_DOMAIN`, `LIST_ID`, `API_ACCESS_TOKEN`, `DISCORD_WEBHOOK_URL` or other secrets in code.
- Do not log secrets or personal information, including in exception messages.
- Always close the Puppeteer browser and pages so resources do not leak.
- Handle error responses from the Misskey API and Discord webhook explicitly.
