import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { startServer } from "../src/server";
afterEach(() => mock.restore());
for (const status of [400, 401, 403, 429]) {
  test(`upstream ${status} returns and logs the sanitized description`, async () => {
    let handler: (request: Request) => Promise<Response>;
    spyOn(Bun, "serve").mockImplementation(((options: any) => {
      handler = (request) => options.fetch(request, { timeout() {} });
      return {};
    }) as typeof Bun.serve);
    spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({
      ok: false, error_code: status,
      description: `Telegram refused 123:FAKE bot123:FAKE/path`,
      parameters: { retry_after: 61 },
    }, { status })) as unknown as typeof fetch);
    const logs: string[] = [];
    startServer({ listen: "127.0.0.1:0", bots: { test: { token_env: "TOKEN" } }, clients: {
      test: { token_sha256: createHash("sha256").update("client").digest("hex"), bots: ["test"], chats: ["42"] },
    } }, { environment: { TOKEN: "123:FAKE" }, log: (line) => logs.push(line) });
    const response = await handler!(new Request("http://localhost/send", {
      method: "POST", headers: { authorization: "Bearer client", "content-type": "application/json" },
      body: JSON.stringify({ bot: "test", chat_id: "42", markdown: "hi" }),
    }));
    expect(response.status).toBe(status === 429 ? 429 : 502);
    const body = await response.json();
    expect(body.error).toContain("Telegram refused");
    expect(body.error).toContain("[REDACTED]");
    expect(JSON.stringify(body)).not.toContain("123:FAKE");
    expect(JSON.parse(logs[0]).error).toBe(body.error);
    expect(logs.join("")).not.toContain("123:FAKE");
    if (status === 429) expect(response.headers.get("retry-after")).toBe("61");
  });
}
for (const streamed of [false, true]) {
  test(`body limit returns 413 ${streamed ? "without" : "with"} content-length`, async () => {
    let handler: (request: Request) => Promise<Response>;
    spyOn(Bun, "serve").mockImplementation(((options: any) => {
      handler = options.fetch;
      return {};
    }) as typeof Bun.serve);
    startServer({ listen: "127.0.0.1:0", bots: {}, clients: {
      test: { token_sha256: createHash("sha256").update("client").digest("hex"), bots: [], chats: [] },
    } }, { log() {} });
    const contents = " ".repeat(256 * 1024 + 1);
    const body = streamed ? new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(contents));
      controller.close();
    } }) : contents;
    const response = await handler!(new Request("http://localhost/preview", {
      method: "POST", headers: { authorization: "Bearer client", "content-type": "application/json",
        ...(streamed ? {} : { "content-length": String(contents.length) }), }, body,
    }));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("256 KB");
  });
}
