import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
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
async function setup(
  access: string | undefined,
  reply: () => Response = () =>
    Response.json({ ok: true, result: { message_id: 7 } }),
) {
  directory = await mkdtemp(join(import.meta.dir, "cli-edit-"));
  process.env.TELEGRAM_STATE_DIR = directory;
  delete process.env.TELEGRAM_BOT_TOKEN;
  await writeFile(join(directory, ".env"), "TELEGRAM_BOT_TOKEN=123:DEFAULT\n");
  await writeFile(join(directory, "message.md"), "**updated**");
  if (access !== undefined)
    await writeFile(join(directory, "access.json"), access);
  spyOn(console, "error").mockImplementation(() => {});
  const output: string[] = [];
  spyOn(console, "log").mockImplementation((line) => output.push(line));
  const requests: { url: string; body: any }[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return reply();
  }) as typeof fetch);
  const edit = (flags: string[] = [], chat = "42") =>
    main([
      "edit",
      "--chat",
      chat,
      "--message-id",
      "7",
      ...flags,
      join(directory, "message.md"),
    ]);
  return { edit, requests, output };
}
test("CLI edit calls editMessageText with a rich message and prints JSON", async () => {
  const { edit, requests, output } = await setup('{"allowFrom":["42"]}');
  expect(await edit()).toBe(0);
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toEndWith("/bot123:DEFAULT/editMessageText");
  expect(requests[0].body).toMatchObject({
    chat_id: "42",
    message_id: 7,
    rich_message: { blocks: [{ type: "paragraph", text: { type: "bold" } }] },
  });
  expect(JSON.parse(output[0])).toEqual({ ok: true, message_ids: [7] });
});
for (const access of [undefined, "invalid", '{"allowFrom":["99"]}'])
  test(`CLI edit honors the allowlist: ${access}`, async () => {
    const { edit, requests } = await setup(access);
    expect(await edit()).toBe(2);
    expect(requests).toEqual([]);
  });
test("CLI edit no-allowlist bypass and token options", async () => {
  const { edit, requests } = await setup(undefined);
  process.env.EDIT_TOKEN = "123:ENV";
  await writeFile(join(directory, "token"), "123:FILE\n");
  expect(await edit(["--no-allowlist", "--token-env", "EDIT_TOKEN"])).toBe(0);
  expect(
    await edit(["--no-allowlist", "--token-file", join(directory, "token")]),
  ).toBe(0);
  expect(
    await edit([
      "--no-allowlist",
      "--token-env",
      "EDIT_TOKEN",
      "--token-file",
      join(directory, "token"),
    ]),
  ).toBe(2);
  delete process.env.EDIT_TOKEN;
  expect(requests.map((request) => request.url)).toEqual([
    expect.stringContaining("/bot123:ENV/"),
    expect.stringContaining("/bot123:FILE/"),
  ]);
});
test("CLI edit treats 'message is not modified' as success", async () => {
  const { edit, output } = await setup('{"allowFrom":["42"]}', () =>
    Response.json(
      {
        ok: false,
        error_code: 400,
        description: "Bad Request: message is not modified",
      },
      { status: 400 },
    ),
  );
  expect(await edit()).toBe(0);
  expect(JSON.parse(output[0])).toEqual({ ok: true, message_ids: [7] });
});
test("CLI edit reports API failures with exit 1", async () => {
  const { edit } = await setup('{"allowFrom":["42"]}', () =>
    Response.json({ ok: false, error_code: 403, description: "Forbidden" }),
  );
  expect(await edit()).toBe(1);
});
test("CLI edit requires --message-id and rejects send-only flags", async () => {
  const { requests } = await setup('{"allowFrom":["42"]}');
  const file = join(directory, "message.md");
  expect(await main(["edit", "--chat", "42", file])).toBe(2);
  expect(await main(["edit", "--chat", "42", "--message-id", "0", file])).toBe(2);
  expect(
    await main(["edit", "--chat", "42", "--message-id", "7", "--silent", file]),
  ).toBe(2);
  expect(requests).toEqual([]);
});
