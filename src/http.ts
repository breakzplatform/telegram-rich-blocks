import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export type Handler = (request: Request) => Promise<Response>;
export interface RunningServer {
  url: URL;
  stop(force?: boolean): Promise<void>;
}

function bodyStream(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  const chunks = incoming[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(new Uint8Array(value));
    },
    // Drain instead of destroying the request: destroying it also drops the
    // response, so a 413 for an oversized body would never reach the client.
    cancel() {
      incoming.resume();
    },
  });
}
function toRequest(incoming: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers))
    for (const item of [value ?? []].flat()) headers.append(name, item);
  const method = incoming.method ?? "GET";
  const body =
    method === "GET" || method === "HEAD" ? undefined : bodyStream(incoming);
  // Only the path is used; the host is fixed so a bad Host header cannot break parsing.
  return new Request(new URL(incoming.url ?? "/", "http://localhost"), {
    method,
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

/** Serves a Fetch-style handler with node:http, which Node, Bun and Deno all provide. */
export async function serve(
  hostname: string,
  port: number,
  handler: Handler,
): Promise<RunningServer> {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const response = await handler(toRequest(incoming));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const host =
    address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: new URL(`http://${host}:${address.port}/`),
    stop: (force = false) =>
      new Promise((resolve) => {
        server.close(() => resolve());
        if (force) server.closeAllConnections();
      }),
  };
}
