import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP stdio exposes tools, sends and observes access revocation", async () => {
  const directory = await mkdtemp(join(import.meta.dir, "mcp-fixture-"));
  const methods: string[] = [];
  const telegram = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      methods.push(new URL(request.url).pathname.split("/").pop()!);
      return Response.json({ ok: true, result: { message_id: 91 } });
    },
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  try {
    await writeFile(
      join(directory, ".env"),
      "TELEGRAM_BOT_TOKEN=123:MCP_EXAMPLE\n",
    );
    await writeFile(
      join(directory, "access.json"),
      JSON.stringify({ allowFrom: ["42"] }),
    );
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["src/mcp.ts"],
        cwd: join(import.meta.dir, ".."),
        env: {
          PATH: process.env.PATH!,
          TELEGRAM_STATE_DIR: directory,
          TELEGRAM_API_BASE: telegram.url.origin,
        },
        stderr: "pipe",
      }),
    );
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "rich_reply",
      "rich_draft",
      "rich_edit",
      "rich_preview",
    ]);
    const reply = await client.callTool({
      name: "rich_reply",
      arguments: { chat_id: "42", markdown: "# Ready" },
    });
    expect(reply.isError).not.toBe(true);
    expect(JSON.stringify(reply.content)).toContain("91");
    await writeFile(
      join(directory, "access.json"),
      JSON.stringify({ allowFrom: [] }),
    );
    const refused = await client.callTool({
      name: "rich_reply",
      arguments: { chat_id: "42", markdown: "Refused" },
    });
    expect(refused.isError).toBe(true);
    expect(methods).toEqual(["sendRichMessage"]);
  } finally {
    await client.close();
    telegram.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
