import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { startServer, validateConfig, MAX_BODY_BYTES } from "../src/server";
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});
function setup() {
  const telegram = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ ok: true, result: { message_id: 12 } }),
  });
  servers.push(telegram);
  const logs: string[] = [];
  const config = validateConfig({
    listen: "127.0.0.1:0",
    bots: { test: { token_env: "TEST_BOT_TOKEN" } },
    clients: {
      workflow: {
        token_sha256: createHash("sha256")
          .update("client-example")
          .digest("hex"),
        bots: ["test"],
        chats: ["42"],
      },
    },
  });
  const server = startServer(config, {
    environment: {
      TEST_BOT_TOKEN: "123:FAKE",
      TELEGRAM_API_BASE: telegram.url.origin,
    },
    log: (line) => logs.push(line),
  });
  servers.push(server);
  const request = (path: string, body: unknown, token = "client-example") =>
    fetch(new URL(path, server.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  return { server, request, logs };
}
test("health needs no auth and reveals no configuration", async () => {
  const { server } = setup();
  const response = await fetch(new URL("/health", server.url));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(response.headers.has("access-control-allow-origin")).toBe(false);
});
test("authenticated send returns IDs and safe structured log", async () => {
  const { request, logs } = setup();
  const response = await request("/send", {
    bot: "test",
    chat_id: "42",
    markdown: "private message",
  });
  expect(await response.json()).toEqual({ ok: true, message_ids: [12] });
  const log = JSON.parse(logs[0]);
  expect(log).toMatchObject({
    bot: "test",
    chat: "42",
    client: "workflow",
    status: 200,
  });
  expect(log.size).toBeGreaterThan(0);
  expect(logs.join("")).not.toContain("private message");
  expect(logs.join("")).not.toContain("client-example");
  expect(logs.join("")).not.toContain("FAKE");
});
test("auth, bot and chat restrictions", async () => {
  const { request } = setup();
  expect(
    (
      await request(
        "/send",
        { bot: "test", chat_id: "42", markdown: "hi" },
        "wrong",
      )
    ).status,
  ).toBe(401);
  expect(
    (await request("/send", { bot: "other", chat_id: "42", markdown: "hi" }))
      .status,
  ).toBe(403);
  expect(
    (await request("/send", { bot: "test", chat_id: "43", markdown: "hi" }))
      .status,
  ).toBe(403);
  expect((await request("/preview", { markdown: "hi" }, "wrong")).status).toBe(
    401,
  );
  expect(
    await (await request("/preview", { markdown: "# hi" })).json(),
  ).toEqual({ blocks: [{ type: "heading", size: 1, text: "hi" }] });
});
test("body size, content type and malformed JSON", async () => {
  const { request, server } = setup();
  expect(
    (await request("/send", { markdown: "a".repeat(MAX_BODY_BYTES) })).status,
  ).toBe(413);
  expect(
    (
      await fetch(new URL("/send", server.url), {
        method: "POST",
        headers: { authorization: "Bearer client-example" },
        body: "{}",
      })
    ).status,
  ).toBe(415);
  expect(
    (
      await fetch(new URL("/send", server.url), {
        method: "POST",
        headers: {
          authorization: "Bearer client-example",
          "content-type": "application/json",
        },
        body: "{",
      })
    ).status,
  ).toBe(400);
});
test("raw blocks and exclusive input validation", async () => {
  const { request } = setup();
  expect(
    (
      await request("/send", {
        bot: "test",
        chat_id: "42",
        blocks: [{ type: "paragraph", text: "hello" }],
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request("/send", {
        bot: "test",
        chat_id: "42",
        markdown: "hi",
        blocks: [],
      })
    ).status,
  ).toBe(400);
});
test("configuration defaults and rejects inline credentials", () => {
  expect(validateConfig({ bots: {}, clients: {} }).listen).toBe(
    "127.0.0.1:8787",
  );
  expect(() =>
    validateConfig({ bots: { test: { token: "forbidden" } }, clients: {} }),
  ).toThrow();
  expect(() =>
    validateConfig({
      bots: {},
      clients: { test: { token_sha256: "bad", bots: [], chats: [] } },
    }),
  ).toThrow();
});

test("streamed bodies without content length still enforce the limit", async () => {
  const { server } = setup();
  const body = new ReadableStream({
    start(controller) {
      for (let index = 0; index < 17; index++)
        controller.enqueue(new Uint8Array(16384).fill(32));
      controller.close();
    },
  });
  const response = await fetch(new URL("/preview", server.url), {
    method: "POST",
    headers: {
      authorization: "Bearer client-example",
      "content-type": "application/json",
    },
    body,
  });
  expect(response.status).toBe(413);
});
