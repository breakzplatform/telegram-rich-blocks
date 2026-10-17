#!/usr/bin/env bash
set -euo pipefail
: "${TELEGRAM_CHAT_ID:?Set the numeric destination chat ID}"
# The CLI reads TELEGRAM_BOT_TOKEN without exposing it in command arguments.
exec telegram-rich send --chat "$TELEGRAM_CHAT_ID" "${1:--}"
