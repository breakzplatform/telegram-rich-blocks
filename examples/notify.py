import os
import subprocess

subprocess.run(
    ["telegram-rich", "send", "--chat", os.environ["TELEGRAM_CHAT_ID"], "-"],
    input="# Job complete\n\n- Status: **ready**\n",
    text=True,
    check=True,
)
