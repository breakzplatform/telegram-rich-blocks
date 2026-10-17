import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, toolDefinitions } from "./plugin";
import { redact } from "./api";
const server = new Server(
  { name: "telegram-rich", version: "0.1.0" },
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
    return { isError: true, content: [{ type: "text", text: redact(error) }] };
  }
});
await server.connect(new StdioServerTransport());
