import { afterEach, expect, test } from "bun:test";
import { TelegramApi } from "../src/api";
import { markdown } from "../src/markdown";
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});
function fake(responder: (method: string, body: any) => Response) {
  const requests: { method: string; body: any }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const method = new URL(request.url).pathname.split("/").pop()!;
      const body = await request.json();
      requests.push({ method, body });
      return responder(method, body);
    },
  });
  servers.push(server);
  return { api: new TelegramApi("123:FAKE", server.url.origin), requests };
}
test("send request fields and split IDs", async () => {
  let identifier = 0;
  const { api, requests } = fake(() =>
    Response.json({ ok: true, result: { message_id: ++identifier } }),
  );
  const result = await api.send(
    "42",
    {
      blocks: [
        { type: "paragraph", text: "a".repeat(20000) },
        { type: "paragraph", text: "b".repeat(20000) },
      ],
    },
    { silent: true, reply_to: 9, thread_id: 3 },
  );
  expect(result.message_ids).toEqual([1, 2]);
  expect(requests[0].body).toEqual({
    chat_id: "42",
    rich_message: { blocks: [{ type: "paragraph", text: "a".repeat(20000) }] },
    disable_notification: true,
    reply_parameters: { message_id: 9 },
    message_thread_id: 3,
  });
  expect(
    requests.every((request) => request.method === "sendRichMessage"),
  ).toBe(true);
});
test("draft and edit request shapes", async () => {
  const { api, requests } = fake((method) =>
    Response.json({
      ok: true,
      result: method.endsWith("Draft") ? true : { message_id: 7 },
    }),
  );
  await api.draft("42", 1, markdown("draft"), true);
  await api.edit("42", 7, markdown("final"));
  expect(requests[0].body).toEqual({
    chat_id: 42,
    draft_id: 1,
    rich_message: markdown("draft"),
    can_stop: true,
  });
  expect(requests[1]).toEqual({
    method: "editMessageText",
    body: { chat_id: "42", message_id: 7, rich_message: markdown("final") },
  });
  await expect(api.draft("-42", 1, markdown("bad"))).rejects.toThrow("private");
  await expect(api.draft("42", 0, markdown("bad"))).rejects.toThrow("non-zero");
  await expect(
    api.draft("42", 1, markdown("![x](https://example.com/a.jpg)")),
  ).rejects.toThrow("media");
});
for (const description of ["Method not found", "unsupported rich messages"])
  test(`fallback: ${description}`, async () => {
    const { api, requests } = fake((method) =>
      method === "sendMessage"
        ? Response.json({ ok: true, result: { message_id: 5 } })
        : Response.json({ ok: false, error_code: 400, description }),
    );
    const result = await api.send(
      "42",
      markdown("**Hi** [site](https://example.com)"),
      { silent: true },
    );
    expect(result).toEqual({ ok: true, message_ids: [5], fallback: true });
    expect(requests[1].body).toEqual({
      chat_id: "42",
      text: "Hi site (https://example.com)",
      disable_notification: true,
    });
  });
test("HTTP 404 fallback and plain chunks fit 4096", async () => {
  const { api, requests } = fake((method) =>
    method === "sendMessage"
      ? Response.json({ ok: true, result: { message_id: 5 } })
      : new Response("missing", { status: 404 }),
  );
  await api.send("42", markdown("😀".repeat(5000)));
  expect(
    requests.filter((value) => value.method === "sendMessage"),
  ).toHaveLength(3);
  expect(
    requests.slice(1).every((value) => value.body.text.length <= 4096),
  ).toBe(true);
  expect(
    requests
      .slice(1)
      .map((value) => value.body.text)
      .join(""),
  ).toBe("😀".repeat(5000));
});
test("ordinary API errors never trigger fallback; tokens redacted", async () => {
  const { api, requests } = fake(() =>
    Response.json({
      ok: false,
      error_code: 403,
      description: "Forbidden bot123:FAKE/path 123:FAKE",
    }),
  );
  try {
    await api.send("42", markdown("hi"));
    throw new Error("expected failure");
  } catch (error) {
    expect(String(error)).not.toContain("123:FAKE");
    expect(String(error)).toContain("Forbidden");
  }
  expect(requests).toHaveLength(1);
});
test("partial failure reports completed IDs", async () => {
  let calls = 0;
  const { api } = fake(() =>
    ++calls === 1
      ? Response.json({ ok: true, result: { message_id: 8 } })
      : Response.json({
          ok: false,
          error_code: 429,
          description: "Too many requests",
        }),
  );
  await expect(
    api.send("42", {
      blocks: [
        { type: "paragraph", text: "a".repeat(20000) },
        { type: "paragraph", text: "b".repeat(20000) },
      ],
    }),
  ).rejects.toThrow("8");
});
