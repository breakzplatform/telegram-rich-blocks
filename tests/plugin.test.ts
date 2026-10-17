import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  assertAllowedChat,
  stateDirectory,
  loadToken,
  callTool,
  toolDefinitions,
} from "../src/plugin";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(access: unknown) {
  const directory = await mkdtemp(join(import.meta.dir, "fixture-"));
  directories.push(directory);
  await writeFile(join(directory, "access.json"), JSON.stringify(access));
  return directory;
}
test("allows private users and group keys; denies others", async () => {
  const directory = await fixture({
    allowFrom: ["42"],
    groups: { "-100": {} },
  });
  await assertAllowedChat("42", directory);
  await assertAllowedChat("-100", directory);
  await expect(assertAllowedChat("43", directory)).rejects.toThrow(
    "allowlisted",
  );
  await expect(assertAllowedChat("toString", directory)).rejects.toThrow();
});
test("access is re-read and malformed or missing files fail closed", async () => {
  const directory = await fixture({ allowFrom: ["42"] });
  await assertAllowedChat("42", directory);
  await writeFile(join(directory, "access.json"), '{"allowFrom":[]}');
  await expect(assertAllowedChat("42", directory)).rejects.toThrow();
  await writeFile(join(directory, "access.json"), "bad");
  await expect(assertAllowedChat("42", directory)).rejects.toThrow();
  await rm(join(directory, "access.json"));
  await expect(assertAllowedChat("42", directory)).rejects.toThrow();
});
test("state overrides and token environment precedence", async () => {
  expect(stateDirectory({ TELEGRAM_STATE_DIR: "/example" })).toBe("/example");
  expect(stateDirectory({ CLAUDE_CONFIG_DIR: "/example" })).toBe(
    "/example/channels/telegram",
  );
  const directory = await fixture({});
  await writeFile(join(directory, ".env"), "TELEGRAM_BOT_TOKEN=123:FILE\n");
  expect(await loadToken(directory, { TELEGRAM_BOT_TOKEN: "123:ENV" })).toBe(
    "123:ENV",
  );
  expect(await loadToken(directory, {})).toBe("123:FILE");
});
test("preview needs no state or network and tools describe draft finalization", async () => {
  expect(
    await callTool(
      "rich_preview",
      { markdown: "hi" },
      { directory: "/nonexistent" },
    ),
  ).toEqual({ blocks: [{ type: "paragraph", text: "hi" }] });
  expect(
    toolDefinitions.find((tool) => tool.name === "rich_draft")?.description,
  ).toContain("rich_reply");
});
test("tool refuses unauthorized sends before loading token", async () => {
  const directory = await fixture({ allowFrom: [] });
  await expect(
    callTool(
      "rich_reply",
      { chat_id: "42", markdown: "hello" },
      { directory, environment: {} },
    ),
  ).rejects.toThrow("allowlisted");
});
