import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { TelegramApi, chatId, positiveInteger } from "./api";
import { parseInput } from "./markdown";
import { singleMessage, splitMessage } from "./limits";
import { InputError } from "./types";
type Environment = Record<string, string | undefined>;
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}
export function stateDirectory(environment: Environment = process.env): string {
  return expandHome(
    environment.TELEGRAM_STATE_DIR ??
      join(
        expandHome(environment.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")),
        "channels",
        "telegram",
      ),
  );
}
export async function loadToken(
  directory: string,
  environment: Environment = process.env,
): Promise<string> {
  if (environment.TELEGRAM_BOT_TOKEN !== undefined)
    return environment.TELEGRAM_BOT_TOKEN;
  let contents: string;
  try {
    contents = await readFile(join(directory, ".env"), "utf8");
  } catch {
    throw new InputError("TELEGRAM_BOT_TOKEN is not configured");
  }
  const match = contents.match(/^TELEGRAM_BOT_TOKEN=(.*)$/m);
  if (!match?.[1]) throw new InputError("TELEGRAM_BOT_TOKEN is not configured");
  return match[1].trim().replace(/^(['"])(.*)\1$/, "$2");
}
export async function assertAllowedChat(
  chat: unknown,
  directory: string,
): Promise<void> {
  const identifier = chatId(chat);
  let access: { allowFrom?: unknown; groups?: unknown };
  try {
    access = JSON.parse(await readFile(join(directory, "access.json"), "utf8"));
  } catch {
    throw new InputError("Cannot read a valid access.json; access denied");
  }
  const allowed =
    Number(identifier) > 0
      ? Array.isArray(access?.allowFrom) &&
        access.allowFrom.some((value) => String(value) === identifier)
      : access?.groups &&
        typeof access.groups === "object" &&
        Object.hasOwn(access.groups, identifier);
  if (!allowed)
    throw new InputError(
      `Chat ${identifier} is not allowlisted; configure access through the official Telegram plugin`,
    );
}
const markdownProperty = {
  type: "string",
  description: "Markdown in the telegram-rich dialect",
};
const contentProperties = {
  markdown: markdownProperty,
  blocks_json: {
    type: "string",
    description:
      "JSON-encoded InputRichMessage with blocks; exclusive with markdown",
  },
};
const chatProperty = {
  type: "string",
  description: "Numeric Telegram chat ID",
};
const integerProperty = { type: "integer" };
export const toolDefinitions = [
  {
    name: "rich_reply",
    description:
      "Send structured rich content to an allowlisted chat. Returns one message ID per part. Unsupported APIs fall back to plain text.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chat_id: chatProperty,
        ...contentProperties,
        reply_to: integerProperty,
        silent: { type: "boolean" },
        thread_id: integerProperty,
      },
      required: ["chat_id"],
      additionalProperties: false,
    },
  },
  {
    name: "rich_draft",
    description:
      "Stream a temporary partial draft in private chats only. Send the final message with rich_reply. can_stop requests a UI button; this plugin does not receive stop updates. Unsupported APIs send persistent plain text instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chat_id: chatProperty,
        draft_id: integerProperty,
        markdown: markdownProperty,
        can_stop: { type: "boolean" },
      },
      required: ["chat_id", "draft_id", "markdown"],
      additionalProperties: false,
    },
  },
  {
    name: "rich_edit",
    description:
      "Edit a rich message in an allowlisted chat. Content must fit one message. Unsupported APIs send a new plain message instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chat_id: chatProperty,
        message_id: integerProperty,
        ...contentProperties,
      },
      required: ["chat_id", "message_id"],
      additionalProperties: false,
    },
  },
  {
    name: "rich_preview",
    description:
      "Preview InputRichMessage JSON without network or credentials. Oversized content returns an array of split messages.",
    inputSchema: {
      type: "object" as const,
      properties: { markdown: markdownProperty },
      required: ["markdown"],
      additionalProperties: false,
    },
  },
];
export function contentInput(
  args: Record<string, unknown>,
  rawKey = "blocks_json",
) {
  if ((args.markdown !== undefined) === (args[rawKey] !== undefined))
    throw new InputError(`Provide exactly one of markdown or ${rawKey}`);
  if (args.markdown !== undefined) {
    if (typeof args.markdown !== "string")
      throw new InputError("markdown must be a string");
    return parseInput(args.markdown);
  }
  if (rawKey === "blocks") return parseInput({ blocks: args.blocks });
  if (typeof args.blocks_json !== "string")
    throw new InputError("blocks_json must be a JSON string");
  try {
    return parseInput(JSON.parse(args.blocks_json));
  } catch {
    throw new InputError("Invalid blocks_json object");
  }
}
export function preview(input: unknown) {
  const parts = splitMessage(parseInput(input));
  return parts.length === 1 ? parts[0] : parts;
}
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  options: { directory?: string; environment?: Environment } = {},
) {
  if (name === "rich_preview") {
    if (typeof args.markdown !== "string")
      throw new InputError("markdown is required");
    return preview(args.markdown);
  }
  if (!["rich_reply", "rich_edit", "rich_draft"].includes(name))
    throw new InputError("Unknown tool");
  const environment = options.environment ?? process.env;
  const directory = options.directory ?? stateDirectory(environment);
  await assertAllowedChat(args.chat_id, directory);
  const message = contentInput(args);
  const api = new TelegramApi(
    await loadToken(directory, environment),
    environment.TELEGRAM_API_BASE,
  );
  if (name === "rich_reply")
    return api.send(args.chat_id, message, {
      silent: args.silent as boolean | undefined,
      reply_to: args.reply_to as number | undefined,
      thread_id: args.thread_id as number | undefined,
    });
  singleMessage(message);
  if (name === "rich_edit")
    return api.edit(
      args.chat_id,
      positiveInteger(args.message_id, "message_id"),
      message,
    );
  return api.draft(
    args.chat_id,
    args.draft_id as number,
    message,
    args.can_stop as boolean | undefined,
  );
}
