import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { startServer } from "../src/server";
afterEach(() => mock.restore());
function setup(
  reply: () => Response = () =>
    Response.json({ ok: true, result: { message_id: 5 } }),
) {
  let handler: (request: Request) => Promise<Response>;
  spyOn(Bun, "serve").mockImplementation(((options: any) => {
    handler = (request) => options.fetch(request, { timeout() {} });
    return {};
  }) as typeof Bun.serve);
  const requests: { url: string; body: any }[] = [];
  spyOn(globalThis, "fetch").mockImplementation((async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return reply();
  }) as typeof fetch);
  const logs: string[] = [];
  startServer(
    {
      listen: "127.0.0.1:0",
      bots: {
        test: { token_env: "TOKEN" },
        other: { token_env: "OTHER_TOKEN" },
      },
      clients: {
        workflow: {
          token_sha256: createHash("sha256").update("client").digest("hex"),
          bots: ["test"],
          chats: ["42"],
        },
      },
    },
    {
      environment: { TOKEN: "123:FAKE", OTHER_TOKEN: "456:OTHER" },
      log: (line) => logs.push(line),
    },
  );
  const edit = (body: unknown, token = "client") =>
    handler!(
      new Request("http://localhost/edit", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  return { edit, requests, logs };
}
const body = { bot: "test", chat_id: "42", message_id: 5, markdown: "**new**" };
test("edit sends editMessageText and returns the edited ID", async () => {
  const { edit, requests, logs } = setup();
  const response = await edit(body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, message_ids: [5] });
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toEndWith("/editMessageText");
  expect(requests[0].body).toMatchObject({
    chat_id: "42",
    message_id: 5,
    rich_message: { blocks: [{ type: "paragraph" }] },
  });
  expect(JSON.parse(logs[0])).toMatchObject({
    bot: "test",
    chat: "42",
    client: "workflow",
    status: 200,
  });
});
test("edit accepts raw blocks", async () => {
  const { edit, requests } = setup();
  const { markdown: _, ...rest } = body;
  const response = await edit({
    ...rest,
    blocks: [{ type: "paragraph", text: "raw" }],
  });
  expect(response.status).toBe(200);
  expect(requests[0].body.rich_message.blocks[0].text).toBe("raw");
});
for (const [name, request, token, status] of [
  ["wrong token", body, "nope", 401],
  ["bot not allowed", { ...body, bot: "other" }, "client", 403],
  ["chat not allowed", { ...body, chat_id: "43" }, "client", 403],
  ["missing message_id", { ...body, message_id: undefined }, "client", 400],
  ["invalid message_id", { ...body, message_id: -1 }, "client", 400],
  ["both markdown and blocks", { ...body, blocks: [] }, "client", 400],
] as const)
  test(`edit rejects ${name}`, async () => {
    const { edit, requests } = setup();
    const response = await edit(request, token);
    expect(response.status).toBe(status);
    expect((await response.json()).ok).toBe(false);
    expect(requests).toEqual([]);
  });
test("edit treats 'message is not modified' as success", async () => {
  const { edit } = setup(() =>
    Response.json(
      {
        ok: false,
        error_code: 400,
        description: "Bad Request: message is not modified",
      },
      { status: 400 },
    ),
  );
  const response = await edit(body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, message_ids: [5] });
});
for (const status of [400, 403, 429]) {
  test(`edit upstream ${status} returns a sanitized reason`, async () => {
    const { edit, logs } = setup(() =>
      Response.json(
        {
          ok: false,
          error_code: status,
          description: "Telegram refused 123:FAKE",
          parameters: { retry_after: 61 },
        },
        { status },
      ),
    );
    const response = await edit(body);
    expect(response.status).toBe(status === 429 ? 429 : 502);
    const result = await response.json();
    expect(result.error).toContain("Telegram refused [REDACTED]");
    expect(logs.join("")).not.toContain("123:FAKE");
    if (status === 429) expect(response.headers.get("retry-after")).toBe("61");
  });
}
