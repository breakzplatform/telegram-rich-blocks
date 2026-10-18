# telegram-rich

Structured Telegram messages for Claude Code agents, shell/Python/PHP scripts,
and n8n workflows. Targets **Telegram Bot API 10.3** with headings, tables,
collapsible details, lists, maps, URL media and buttons.

The official Claude Code Telegram channel sends text/MarkdownV2. This companion
adds rich sending tools without modifying that plugin. It **never calls
getUpdates, setWebhook, or any other update-consumption method** and does not
compete for polling. The official plugin remains responsible for inbound
messages, pairing, ordinary replies and local file attachments.

## Claude Code plugin

Requires Bun (tested with 1.3.13) and a configured official Telegram plugin.
This repository is a marketplace and its root is the `telegram-rich` plugin:

```text
/plugin marketplace add /absolute/path/to/telegram-rich
/plugin install telegram-rich@telegram-rich-marketplace
```

Replace the local path with a repository URL once you host it. The MCP server
runs `bun install` on start, just like the official plugin; first startup needs
package registry access. Reload plugins after installing.

Tools:

| Tool | Inputs | Result |
| --- | --- | --- |
| `rich_reply` | `chat_id`, exactly one of `markdown` / `blocks_json`; optional `reply_to`, `silent`, `thread_id` | Sent message IDs, one per part |
| `rich_draft` | private `chat_id`, nonzero `draft_id`, `markdown`; optional `can_stop` | Temporary preview; finalize with `rich_reply` |
| `rich_edit` | `chat_id`, `message_id`, exactly one of `markdown` / `blocks_json` | Edited ID, or new IDs on fallback |
| `rich_preview` | `markdown` | InputRichMessage JSON, no network or credentials |

`blocks_json` is a JSON string containing an object with `blocks`, not a bare
array. Chat IDs are numeric strings. Message/thread IDs are positive integers;
a draft ID can be any nonzero safe integer.

The companion reads `TELEGRAM_BOT_TOKEN` from the environment first, otherwise
from `~/.claude/channels/telegram/.env`. It reads `access.json` from the same
folder on **every sending/editing/draft call**. A positive private chat ID must
be in `allowFrom`; a negative group ID must be a key in `groups`. Missing,
invalid or non-allowlisted state fails closed. This is the official plugin's
outbound allowlist model, not its inbound mention/pairing policy.

`TELEGRAM_STATE_DIR` overrides the whole state directory. Otherwise
`CLAUDE_CONFIG_DIR` overrides `~/.claude`. This project never writes those files.
The [rich-replies skill](skills/rich-replies/SKILL.md) keeps official `reply` as
the default and selects rich tools for structured answers.

## CLI

```sh
bun install
bun src/cli.ts preview examples/sample.md
bun src/cli.ts send --chat 123456789 --dry-run examples/sample.md
bun src/cli.ts send --chat 123456789 --silent --reply-to 42 --thread 7 report.md
printf '# Ready\n\n- Worker online\n' | bun src/cli.ts send --chat 123456789 -
```

For a local command on PATH, `bun link` registers the package and its
`telegram-rich` executable. It can then also be invoked with
`bunx --no-install telegram-rich preview examples/sample.md` after linking.
There is no published registry package required by these instructions.

```text
telegram-rich send --chat ID [--token-env VAR | --token-file PATH]
  [--silent] [--reply-to N] [--thread N] [--json] [--dry-run] [--no-allowlist] [FILE|-]
telegram-rich preview [FILE|-]
telegram-rich serve --config PATH
```

Omitted input means stdin; `--` permits filenames starting with a dash.
The default token is `TELEGRAM_BOT_TOKEN`, then the official channel's `.env` in the
state folder, like the plugin. `--token-env` chooses another variable;
`--token-file` reads a file that contains only the token. The CLI checks `access.json`
on every send, with the same allowlist as the plugin: `allowFrom` for private chats
and `groups` for groups. A missing or invalid file blocks the send.
`TELEGRAM_STATE_DIR` and `CLAUDE_CONFIG_DIR` select the folder as described
above. To send without that check, say so explicitly with `--no-allowlist`:

```sh
telegram-rich send --chat 123456789 --no-allowlist report.md
```

`TELEGRAM_STATE_DIR`, `CLAUDE_CONFIG_DIR` and `--token-file` expand `~` and `~/`
to the home folder. Preview and dry-run need neither the allowlist nor a token.
Keep token files readable only by their owner and keep tokens out of command
arguments.

`--json` strictly parses an InputRichMessage object. Without it, a valid JSON
object containing `blocks` is also detected automatically. Preview prints one
message object, or an array when splitting is required. Dry-run prints the
method, redacted URL and request body (or an array); it requires no token and
makes no network request. Send prints JSON with `ok`, `message_ids`, and
`fallback: true` when applicable. Exit codes: **0 success, 1 API/transport error,
2 usage/input/configuration error**. Failed multipart sends report completed IDs;
do not blindly retry the whole input.

[Shell notifier](examples/notify.sh), [Python](examples/notify.py) and
[PHP](examples/notify.php) examples inherit the token environment and pass content
over stdin. They can replace a `curl` + `jq` sendMessage invocation.

Compile standalone binaries (no Bun needed at runtime):

```sh
bun run build
./dist/telegram-rich-darwin-arm64 preview examples/sample.md
# Linux host: ./dist/telegram-rich-linux-x64 ...
```

`TELEGRAM_API_BASE` overrides `https://api.telegram.org`, primarily for local
fake servers. It is trusted operator configuration: the bot credential is sent
to that origin. Automated tests only use loopback fake Telegram servers.

## HTTP service and n8n

Copy [examples/server.json](examples/server.json), select numeric bot/chat
allowlists and replace the placeholder digest. Config accepts only JSON;
bots contain environment-variable names, never token values. Each client gets
a separate high-entropy bearer token and SHA-256 digest. To generate them:

```sh
bun -e 'const token = require("node:crypto").randomBytes(32).toString("hex"); console.log("Client token:", token); console.log("SHA-256:", require("node:crypto").createHash("sha256").update(token).digest("hex"))'
```

Put the digest in `clients.<name>.token_sha256` and store the original token in
n8n's Header Auth credential. Set `NOTIFIER_BOT_TOKEN` in the service environment.
The checked-in configuration is intentionally unusable until customized.

```sh
telegram-rich serve --config examples/server.json
```

The default listen address is **127.0.0.1:8787**. For remote access over Tailscale,
set `listen` to the host's specific Tailscale IP and port. The Docker Compose
example uses Linux host networking, so that same address works inside the
container without opening a port on all host interfaces:

```sh
docker compose -f examples/docker-compose.yml up --build -d
```

The image uses a non-root user; Compose also uses a read-only root filesystem,
drops capabilities and mounts configuration read-only. Configure Tailscale ACLs
to restrict access. HTTP is intended for loopback or the encrypted tailnet, not
public exposure. No CORS headers are provided.

Configure an n8n **HTTP Request** node:

- Method: `POST`
- URL: `http://<tailscale-ip>:8787/send`
- Authentication: Header Auth credential, name `Authorization`, value
  `Bearer <client-token>`.
- Send body: JSON; Content-Type: `application/json`.
- Body, in expression mode:

```javascript
{{ {
  bot: 'notifier',
  chat_id: '123456789',
  markdown: '# Job result\n\n' + $json.summary,
  silent: true
} }}
```

Optional body fields: `reply_to` (message ID), `thread_id` (topic ID), `silent`.
Use `blocks: [...]` instead of `markdown` for raw blocks; they are mutually
exclusive. Successful response: `{"ok":true,"message_ids":[123]}`; fallback adds
`"fallback":true`. Disable automatic retries for sends unless your workflow
handles duplicates: Telegram sends are not idempotent.

`POST /preview` accepts `{"markdown":"..."}` or `{"blocks":[...]}` and requires
client authentication but no bot/chat selection. It returns the same JSON as CLI
preview. `GET /health` returns `{"ok":true}` without authentication or config.
Errors: 400 input, 401 authentication, 403 bot/chat authorization, 413 body too
large, 415 content type, 502 Telegram error. Telegram errors include IDs already
sent; upstream descriptions are withheld from HTTP responses.

Bodies are limited to 256 KiB, including streamed bodies without Content-Length.
Authentication compares SHA-256 digests in constant time. Logs are one-line JSON
with bot, chat, client, size and status; no bearer/bot tokens or message bodies.
Known metadata is logged only after authorization. Health requests are quiet.
Configuration and bot environment are loaded at service startup; restart to apply
changes. Only the Claude plugin reloads its allowlist per call.

## Markdown dialect

This is a small converter, not a complete CommonMark implementation and not
Telegram's native rich Markdown parser. It emits explicit blocks without
`parse_mode` or MarkdownV2 escaping.

| Input | Output |
| --- | --- |
| Blank-line-separated paragraphs | Paragraphs; internal newlines retained |
| `#` through `######` | Heading size 1–6 (1 largest) |
| `**bold**`, `*italic*`, `_italic_` | Inline formatting |
| `__underline__`, `~~strike~~`, `\|\|spoiler\|\|` | Underline, strike, spoiler |
| Backtick-delimited code | Literal inline code |
| `[label](https://example.com)` | Link; also supports tg:, mailto:, tel: |
| `@someone`, `#tag` | Text; Telegram may auto-detect entities |
| `-`, `+`, `*` list markers; `1.` numbering | Lists; indent nested lists by two spaces |
| `> text` on each line | Block quote containing blocks |
| `>! text` on each line | Expandable quote containing inline text |
| Triple-backtick fence with language | Preformatted text and language |
| `---` or `***` on its own line | Divider |
| GitHub pipe table with separator row | Table; alignment follows separator colons |
| `<!-- table:compact -->` immediately before a table | Compact table |
| `<details><summary>T</summary>body</details>` | Details; body supports this dialect; optional `open` |
| Fenced `footer` | Footer with inline formatting |
| Fenced `buttons`, lines `Label \| https://url` | URL buttons; rows of at most eight, labels stay plain |
| Fenced `map`, `lat,lon[,zoom]` | Map; latitude ±90, longitude ±180, integer zoom 0–24 |
| Standalone `![caption](https://url/photo.jpg)` | Photo for .jpg/.jpeg/.png/.webp URLs |
| Standalone `![caption](https://url/report.pdf)` | Document for .pdf/.zip URLs |

Nested inline formatting is supported for balanced delimiters; arbitrary
CommonMark delimiter/escape rules are not. Table cells support inline text,
including escaped pipes (`\|`); code spans containing unescaped pipes are not
special-cased. Lists support one nested level reliably; multiline item paragraphs
and task checkboxes are not interpreted. Unsupported constructs, malformed
fences/maps/buttons, non-HTTP media URLs and unknown media extensions remain
paragraph text. Arbitrary HTML is not interpreted. Nested details markup is not
part of the dialect. The full sample is [examples/sample.md](examples/sample.md).

## Limits, fallback and security boundaries

The library enforces 32768 visible Unicode characters, 500 blocks including list
items and table rows, 16 levels of nesting, 50 attachments and 20 table columns.
It also checks button row and map dimension limits. Oversized sends split only
between top-level blocks. One oversized paragraph/list/table/details block causes
a clear error; divide it manually. Drafts and edits must fit one message.
Raw JSON receives light structural and limit validation, not a complete Telegram
schema check. Telegram validates remaining field types and media restrictions.
Raw cross-block anchors/references may require manual adjustment after splitting.
See [docs/api-notes.md](docs/api-notes.md) for exact API fields and sources.

Only HTTP 404, API error code 404, “method not found” or “unsupported” errors
trigger fallback. The same content is rendered as plain text, preserving link
and media URLs, and split conservatively to 4096 UTF-16 units. Fallback does not
upload attachments or preserve interactive controls. Authentication failures,
rate limits, malformed content errors and network failures otherwise surface
without retrying or silently changing format. All error paths redact bot tokens.

Fallback from an **edit or draft sends new persistent plain messages**, and
returns their IDs with `fallback: true`. Stop streaming drafts after fallback.
Rich drafts expire after 30 seconds; always finalize with `rich_reply`. This
sender rejects draft media, including reusable file IDs (a deliberate narrower
scope than the API). `can_stop` requests Telegram's stop button but this project
does not consume its update; another integration must handle it.

The plugin's allowlist does not apply to the CLI or HTTP service. HTTP clients
have independent bot/chat scopes and cannot provide arbitrary bot credentials.
Rich URLs are fetched by Telegram, never by this server; links still need normal
operator judgment. No multipart uploads, callback handlers, ephemeral-group
message API, webhook setup or polling are implemented. Client rendering and
actual Telegram delivery are not verified by offline tests.

## Development

```sh
bun install
bun test
bun run check
bun run build
bun src/cli.ts preview examples/sample.md
```

Tests use fixture state directories and fake Telegram servers on loopback; they
never read real Claude state or call the real Telegram API. Compile targets are
macOS ARM64 and Linux x64. Apache-2.0 licensed, copyright 2026 Joselito.
