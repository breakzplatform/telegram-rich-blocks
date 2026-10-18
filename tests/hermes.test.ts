import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { assertHermesAllows, envValue, hermesDirectory, hermesToken } from "../src/hermes";
import { callTool, configuredToken, host, toolDefinitions, toolsFor } from "../src/plugin";
import { main } from "../src/cli";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function hermesHome(env: string) {
  const directory = await mkdtemp(join(import.meta.dir, "hermes-fixture-"));
  directories.push(directory);
  await writeFile(join(directory, ".env"), env);
  return directory;
}
const settings =
  "TELEGRAM_BOT_TOKEN='123:HERMES'\nexport TELEGRAM_ALLOWED_USERS=42, 7\nTELEGRAM_HOME_CHANNEL=7\n";

test("host defaults to claude and rejects unknown names", () => {
  expect(host({})).toBe("claude");
  expect(host({ TELEGRAM_RICH_HOST: "hermes" })).toBe("hermes");
  expect(() => host({ TELEGRAM_RICH_HOST: "openclaw" })).toThrow("claude or hermes");
});

test("hermes home follows HERMES_HOME", () => {
  expect(hermesDirectory({})).toBe(join(homedir(), ".hermes"));
  expect(hermesDirectory({ HERMES_HOME: "~/agent" })).toBe(join(homedir(), "agent"));
  expect(hermesDirectory({ HERMES_HOME: "/example" })).toBe("/example");
});

test("env files accept export, quotes and blank values", () => {
  expect(envValue("export A='x y'\n", "A")).toBe("x y");
  expect(envValue('A="1"\n', "A")).toBe("1");
  expect(envValue("A=\n", "A")).toBeUndefined();
  expect(envValue("AB=1\n", "A")).toBeUndefined();
});

test("allows TELEGRAM_ALLOWED_USERS private chats, re-reads them and refuses groups", async () => {
  const directory = await hermesHome(settings);
  const environment = { HERMES_HOME: directory };
  await assertHermesAllows("42", environment);
  await assertHermesAllows("7", environment);
  await expect(assertHermesAllows("43", environment)).rejects.toThrow("TELEGRAM_ALLOWED_USERS");
  await expect(assertHermesAllows("-100", environment)).rejects.toThrow("group");
  await writeFile(join(directory, ".env"), "TELEGRAM_BOT_TOKEN=123:HERMES\n");
  await expect(assertHermesAllows("42", environment)).rejects.toThrow();
  await rm(join(directory, ".env"));
  await expect(assertHermesAllows("42", environment)).rejects.toThrow();
});

test("environment variables win over the Hermes .env", async () => {
  const directory = await hermesHome(settings);
  expect(await hermesToken({ HERMES_HOME: directory })).toBe("123:HERMES");
  expect(await hermesToken({ HERMES_HOME: directory, TELEGRAM_BOT_TOKEN: "123:ENV" })).toBe("123:ENV");
  await assertHermesAllows("9", { HERMES_HOME: directory, TELEGRAM_ALLOWED_USERS: "9" });
  await expect(hermesToken({ HERMES_HOME: join(directory, "missing") })).rejects.toThrow("not configured");
});

test("tools and CLI send with the Hermes token to allowlisted chats", async () => {
  const directory = await hermesHome(settings);
  const paths: string[] = [];
  const telegram = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      paths.push(new URL(request.url).pathname);
      return Response.json({ ok: true, result: { message_id: 5 } });
    },
  });
  const saved = { ...process.env };
  try {
    const environment = {
      TELEGRAM_RICH_HOST: "hermes",
      HERMES_HOME: directory,
      TELEGRAM_API_BASE: telegram.url.origin,
    };
    expect(
      await callTool("rich_reply", { chat_id: "42", markdown: "# Ready" }, { environment }),
    ).toEqual({ ok: true, message_ids: [5] });
    await expect(
      callTool("rich_reply", { chat_id: "43", markdown: "No" }, { environment }),
    ).rejects.toThrow("TELEGRAM_ALLOWED_USERS");
    expect(await callTool("rich_reply", { markdown: "Home" }, { environment })).toEqual({
      ok: true,
      message_ids: [5],
    });
    expect(await configuredToken(environment)).toBe("123:HERMES");
    delete process.env.TELEGRAM_BOT_TOKEN;
    Object.assign(process.env, environment);
    const input = join(directory, "message.md");
    await writeFile(input, "# Ready\n");
    expect(await main(["send", "--chat", "42", input])).toBe(0);
    expect(await main(["send", "--chat", "43", input])).toBe(2);
    expect(paths).toEqual([
      "/bot123:HERMES/sendRichMessage",
      "/bot123:HERMES/sendRichMessage",
      "/bot123:HERMES/sendRichMessage",
    ]);
  } finally {
    process.env = saved;
    telegram.stop(true);
  }
});

test("under Hermes chat_id is optional; Claude keeps it required", async () => {
  expect(toolsFor({})).toBe(toolDefinitions);
  const tools = toolsFor({ TELEGRAM_RICH_HOST: "hermes" });
  for (const tool of tools) expect(tool.inputSchema.required).not.toContain("chat_id");
  expect(tools.find((tool) => tool.name === "rich_preview")).toBe(
    toolDefinitions.find((tool) => tool.name === "rich_preview"),
  );
  const directory = await hermesHome("TELEGRAM_BOT_TOKEN=1:X\nTELEGRAM_ALLOWED_USERS=42\n");
  await expect(
    callTool("rich_reply", { markdown: "x" }, { environment: { TELEGRAM_RICH_HOST: "hermes", HERMES_HOME: directory } }),
  ).rejects.toThrow("TELEGRAM_HOME_CHANNEL");
});
