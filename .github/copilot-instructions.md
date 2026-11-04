# GitHub Copilot Instructions

Project rules (language, commands, architecture, conventions, security) are in [AGENTS.md](../AGENTS.md). Write review comments in English.

## Review focus

- Are errors from the Misskey API and Discord webhook handled?
- Is the Puppeteer browser (and every page) always closed, with no resource leaks?
- Do logs or exception messages leak secrets (tokens, webhook URL)?
- Were Vitest tests added or updated when logic changed?
- Is `README.md` updated when structure or dependencies change?
