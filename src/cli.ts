#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import {
  TelegramApi,
  ApiError,
  chatId,
  positiveInteger,
  requestOptions,
  redact,
} from "./api";
import { parseInput } from "./markdown";
import { singleMessage, splitMessage } from "./limits";
import { preview, assertHostAllows, hostToken, expandHome } from "./plugin";
import { startServer, validateConfig } from "./server";
import { InputError } from "./types";
import { startMcp } from "./mcp";
const usage = `telegram-rich-blocks preview [FILE|-]
telegram-rich-blocks send --chat ID [--token-env VAR | --token-file PATH]
  [--silent] [--reply-to N] [--thread N] [--json] [--dry-run] [--no-allowlist] [FILE|-]
telegram-rich-blocks edit --chat ID --message-id N [--token-env VAR | --token-file PATH]
  [--json] [--no-allowlist] [FILE|-]
telegram-rich-blocks serve --config PATH
telegram-rich-blocks mcp`;
async function read(path: string): Promise<string> {
  try {
    return path === "-" ? await text(process.stdin) : await readFile(path, "utf8");
  } catch {
    throw new InputError("Cannot read input file");
  }
}
export async function main(arguments_: string[]): Promise<number> {
  let token: string | undefined;
  try {
    if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0])) {
      console.log(usage);
      return 0;
    }
    const [command, ...args] = arguments_;
    if (command === "mcp" && args.length === 0) {
      await startMcp();
      return 0;
    }
    if (!["send", "edit", "preview", "serve"].includes(command))
      throw new InputError(usage);
    const flags = new Map<string, string | boolean>();
    const files: string[] = [];
    const allowed =
      command === "send"
        ? [
            "chat",
            "token-env",
            "token-file",
            "silent",
            "reply-to",
            "thread",
            "json",
            "dry-run",
            "no-allowlist",
          ]
        : command === "edit"
          ? [
              "chat",
              "message-id",
              "token-env",
              "token-file",
              "json",
              "no-allowlist",
            ]
          : command === "serve"
            ? ["config"]
            : [];
    for (let index = 0; index < args.length; index++) {
      const argument = args[index];
      if (argument === "--") {
        files.push(...args.slice(index + 1));
        break;
      }
      if (argument.startsWith("--")) {
        const name = argument.slice(2);
        if (!allowed.includes(name) || flags.has(name))
          throw new InputError("Unknown or duplicate option");
        if (["silent", "json", "dry-run", "no-allowlist"].includes(name))
          flags.set(name, true);
        else {
          const value = args[++index];
          if (!value || value.startsWith("--"))
            throw new InputError(`Missing value for --${name}`);
          flags.set(name, value);
        }
      } else if (argument.startsWith("-") && argument !== "-")
        throw new InputError("Unknown option");
      else files.push(argument);
    }
    if (files.length > 1 || (command === "serve" && files.length))
      throw new InputError("Too many input files");
    if (command === "serve") {
      if (!flags.get("config")) throw new InputError("--config is required");
      let config: unknown;
      try {
        config = JSON.parse(await read(String(flags.get("config"))));
      } catch {
        throw new InputError("Cannot read JSON server configuration");
      }
      const server = await startServer(validateConfig(config));
      console.error(
        JSON.stringify({ event: "listening", address: server.url.origin }),
      );
      const shutdown = () => {
        server.stop();
        process.exitCode = 0;
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      return 0;
    }
    const delivers = command === "send" || command === "edit";
    if (delivers && !flags.has("chat"))
      throw new InputError("--chat is required");
    if (command === "edit" && !flags.has("message-id"))
      throw new InputError("--message-id is required");
    if (flags.has("token-env") && flags.has("token-file"))
      throw new InputError("Choose --token-env or --token-file");
    const chat = delivers ? chatId(flags.get("chat")) : undefined;
    const messageId =
      command === "edit"
        ? positiveInteger(flags.get("message-id"), "message-id")
        : undefined;
    const options = {
      ...(flags.has("silent") ? { silent: true } : {}),
      ...(flags.has("reply-to")
        ? { reply_to: positiveInteger(flags.get("reply-to"), "reply-to") }
        : {}),
      ...(flags.has("thread")
        ? { thread_id: positiveInteger(flags.get("thread"), "thread") }
        : {}),
    };
    const source = await read(files[0] ?? "-");
    let input: unknown = source;
    if (flags.has("json")) {
      try {
        input = JSON.parse(source);
      } catch {
        throw new InputError("Invalid JSON input");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new InputError("JSON input must be an object with blocks");
    }
    if (command === "preview") {
      console.log(JSON.stringify(preview(input), null, 2));
      return 0;
    }
    const message = parseInput(input);
    if (command === "edit") singleMessage(message);
    const parts = splitMessage(message);
    if (flags.has("dry-run")) {
      const requests = parts.map((part) => ({
        method: "sendRichMessage",
        url: `${(process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/$/, "")}/bot[REDACTED]/sendRichMessage`,
        body: { chat_id: chat, rich_message: part, ...requestOptions(options) },
      }));
      console.log(
        JSON.stringify(requests.length === 1 ? requests[0] : requests, null, 2),
      );
      return 0;
    }
    if (!flags.has("no-allowlist")) await assertHostAllows(chat);
    // Same lookup as the plugin: an explicit file or variable wins, otherwise
    // the host's own token (the official channel's .env, or Hermes' .env).
    token = flags.has("token-file")
      ? (await read(expandHome(String(flags.get("token-file"))))).trim()
      : flags.has("token-env")
        ? process.env[String(flags.get("token-env"))]
        : await hostToken();
    if (!token) throw new InputError("Bot token is not configured");
    const api = new TelegramApi(token);
    console.log(
      JSON.stringify(
        messageId === undefined
          ? await api.send(chat, message, options)
          : await api.edit(chat, messageId, message),
      ),
    );
    return 0;
  } catch (error) {
    console.error(redact(error, token));
    return error instanceof ApiError ? 1 : 2;
  }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
