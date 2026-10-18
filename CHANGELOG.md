# Changelog

## [Unreleased]

### Added

- Callback buttons in the Markdown `buttons` fence (`Label | callback:data`) and
  an optional style suffix (`danger`, `success`, `primary`, callback-only `link`)
  for callback and URL buttons. Raw blocks validate `callback_data` length and
  styles. The plain-text fallback keeps only the label of a callback button.

### Changed

- Renamed the project, package, plugin and CLI from telegram-rich to telegram-rich-blocks.
- CLI sends now check the plugin's `access.json` allowlist by default; use
  `--no-allowlist` to explicitly bypass it. Preview and dry-run remain offline.

### Fixed

- Honor Telegram `retry_after` with at most three retries and 60 seconds of total
  waiting per API request, including multipart sends; preserve completed IDs.
- Return HTTP 429 with `Retry-After` when Telegram rate limits are exhausted.
- Treat unchanged-message edit errors as successful idempotent edits.
- Include sanitized upstream error descriptions in HTTP responses and logs.
- Expand home shorthand in state/config directories and CLI token-file paths.
- Reject malformed block JSON instead of sending it as Markdown.
- Redact configured tokens in MCP errors, including tokens loaded from `.env`.
- Render map blocks without a location safely, preserving captions and credits.

## 0.1.0 — 2026-10-17

### Added

- Markdown and raw-block rich message conversion targeting Telegram Bot API 10.3.
- Limit-aware sends, private drafts, edits and explicit plain-text fallback.
- Companion Claude Code plugin with runtime chat authorization and offline preview.
- CLI preview/send commands and macOS ARM64 / Linux x64 compiled build targets.
- HTTP service with per-client bot/chat permissions, plus Docker and n8n examples.
