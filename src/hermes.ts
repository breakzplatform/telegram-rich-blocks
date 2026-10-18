import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { chatId } from "./api";
import { InputError } from "./types";
type Environment = Record<string, string | undefined>;

// Hermes Agent keeps its Telegram credentials in $HERMES_HOME/.env and does not
// pass them to stdio MCP servers, so they are read from that file on every call.
export function hermesDirectory(environment: Environment = process.env): string {
  const directory = environment.HERMES_HOME ?? join(homedir(), ".hermes");
  if (directory === "~") return homedir();
  return directory.startsWith("~/") ? join(homedir(), directory.slice(2)) : directory;
}
export function envValue(contents: string, name: string): string | undefined {
  const match = contents.match(
    new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}=(.*)$`, "m"),
  );
  const value = match?.[1]?.trim().replace(/^(['"])(.*)\1$/, "$2");
  return value || undefined;
}
async function hermesSetting(
  name: string,
  directory: string,
  environment: Environment,
): Promise<string | undefined> {
  if (environment[name] !== undefined) return environment[name];
  try {
    return envValue(await readFile(join(directory, ".env"), "utf8"), name);
  } catch {
    return undefined;
  }
}
/**
 * Mirrors the Hermes gateway's Telegram allowlist (TELEGRAM_ALLOWED_USERS, comma
 * separated user IDs) for private chats, where the chat ID is the user ID.
 * Groups are refused: Hermes authorizes group senders, not group destinations.
 */
export async function assertHermesAllows(
  chat: unknown,
  environment: Environment = process.env,
): Promise<void> {
  const identifier = chatId(chat);
  if (Number(identifier) < 0)
    throw new InputError(
      `Chat ${identifier} is a group; the hermes host only sends to allowlisted private chats`,
    );
  const allowed = (
    await hermesSetting("TELEGRAM_ALLOWED_USERS", hermesDirectory(environment), environment)
  )
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed?.includes(identifier))
    throw new InputError(
      `Chat ${identifier} is not in TELEGRAM_ALLOWED_USERS; configure access through Hermes`,
    );
}
export async function hermesToken(
  environment: Environment = process.env,
): Promise<string> {
  const token = await hermesSetting("TELEGRAM_BOT_TOKEN", hermesDirectory(environment), environment);
  if (!token) throw new InputError("TELEGRAM_BOT_TOKEN is not configured for Hermes");
  return token;
}
/** The chat Hermes delivers to by default; its agent may not see a numeric chat ID. */
export async function hermesHomeChannel(
  environment: Environment = process.env,
): Promise<string> {
  const chat = await hermesSetting("TELEGRAM_HOME_CHANNEL", hermesDirectory(environment), environment);
  if (!chat)
    throw new InputError("chat_id is required: TELEGRAM_HOME_CHANNEL is not configured for Hermes");
  return chat;
}
