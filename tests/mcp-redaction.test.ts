import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
for (const source of ["environment", "file"]) {
  test(`MCP redacts the exact ${source} token even outside a bot URL`, async () => {
    const directory = await mkdtemp(join(import.meta.dir, "mcp-redaction-"));
    const client = new Client({ name: "redaction-test", version: "1.0.0" });
    try {
      await writeFile(join(directory, "access.json"), '{"allowFrom":[]}');
      if (source === "file") await writeFile(join(directory, ".env"), 'TELEGRAM_BOT_TOKEN=42\n');
      await client.connect(new StdioClientTransport({
        command: process.execPath, args: ["src/mcp.ts"], cwd: join(import.meta.dir, ".."),
        env: { PATH: process.env.PATH!, TELEGRAM_STATE_DIR: directory,
          ...(source === "environment" ? { TELEGRAM_BOT_TOKEN: "42" } : {}), },
        stderr: "pipe",
      }));
      const result = await client.callTool({ name: "rich_reply", arguments: { chat_id: "42", markdown: "hi" } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("[REDACTED]");
      expect(JSON.stringify(result.content)).not.toContain("42");
    } finally {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
test("MCP preview and validation work without a configured token", async () => {
  const client = new Client({ name: "offline-test", version: "1.0.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: ["src/mcp.ts"], cwd: join(import.meta.dir, ".."),
      env: { PATH: process.env.PATH!, TELEGRAM_STATE_DIR: "/nonexistent-test-state" }, stderr: "pipe",
    }));
    expect((await client.callTool({ name: "rich_preview", arguments: { markdown: "hi" } })).isError).not.toBe(true);
    const error = await client.callTool({ name: "rich_preview", arguments: {} });
    expect(error.isError).toBe(true);
    expect(JSON.stringify(error.content)).toContain("markdown is required");
  } finally { await client.close(); }
});
