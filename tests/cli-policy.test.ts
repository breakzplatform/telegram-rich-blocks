import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import { main } from "../src/cli";
const originalState = process.env.TELEGRAM_STATE_DIR;
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
let directory: string;
afterEach(async () => {
  mock.restore();
  if (originalState === undefined) delete process.env.TELEGRAM_STATE_DIR;
  else process.env.TELEGRAM_STATE_DIR = originalState;
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function setup(access?: string) {
  directory = await mkdtemp(join(import.meta.dir, "cli-policy-"));
  process.env.TELEGRAM_STATE_DIR = directory;
  process.env.TELEGRAM_BOT_TOKEN = "123:FAKE";
  await writeFile(join(directory, "message.md"), "hello");
  if (access !== undefined) await writeFile(join(directory, "access.json"), access);
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
  const requests: string[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (url) => {
    requests.push(String(url));
    return Response.json({ ok: true, result: { message_id: 1 } });
  }) as typeof fetch);
  return { requests, send: (chat = "42", flags: string[] = []) => main(["send", "--chat", chat, ...flags, join(directory, "message.md")]) };
}
for (const access of [undefined, "invalid", '{"allowFrom":[]}'])
  test(`CLI denies sends with missing, invalid or unauthorized access: ${access}`, async () => {
    const { send, requests } = await setup(access);
    expect(await send()).toBe(2);
    expect(requests).toEqual([]);
  });
test("CLI allows private and group chats and observes revocation", async () => {
  const { send, requests } = await setup('{"allowFrom":["42"],"groups":{"-100":{}}}');
  expect(await send()).toBe(0);
  expect(await send("-100")).toBe(0);
  await writeFile(join(directory, "access.json"), '{}');
  expect(await send()).toBe(2);
  expect(requests).toHaveLength(2);
});
test("CLI explicit no-allowlist bypass sends without access.json", async () => {
  const { send, requests } = await setup();
  expect(await send("42", ["--no-allowlist"])).toBe(0);
  expect(requests).toHaveLength(1);
});
test("CLI token-file expands a leading tilde", async () => {
  const { send, requests } = await setup('{"allowFrom":["42"]}');
  await writeFile(join(directory, "token"), "123:FILE");
  expect(await send("42", ["--token-file", "~/" + relative(homedir(), join(directory, "token"))])).toBe(0);
  expect(requests[0]).toContain("/bot123:FILE/");
});
