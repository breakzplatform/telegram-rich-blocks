import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, toolsFor, configuredToken } from "./plugin";
import { redact } from "./api";
export async function startMcp(): Promise<void> {
  const server = new Server(
    { name: "telegram-rich-blocks", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsFor(),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await callTool(
        request.params.name,
        request.params.arguments ?? {},
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      const token = process.env.TELEGRAM_BOT_TOKEN ?? (await configuredToken());
      return {
        isError: true,
        content: [{ type: "text", text: redact(error, token) }],
      };
    }
  });
  await server.connect(new StdioServerTransport());
}
if (import.meta.main) await startMcp();
