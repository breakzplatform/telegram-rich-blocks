import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, toolDefinitions, loadToken, stateDirectory } from "./plugin";
import { redact } from "./api";
const server = new Server(
  { name: "telegram-rich-blocks", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await callTool(
      request.params.name,
      request.params.arguments ?? {},
    );
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    let token = process.env.TELEGRAM_BOT_TOKEN;
    if (token === undefined) {
      try {
        token = await loadToken(stateDirectory());
      } catch {}
    }
    return {
      isError: true,
      content: [{ type: "text", text: redact(error, token) }],
    };
  }
});
await server.connect(new StdioServerTransport());
