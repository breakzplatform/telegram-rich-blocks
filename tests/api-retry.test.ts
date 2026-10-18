import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { TelegramApi } from "../src/api";
import { markdown } from "../src/markdown";
afterEach(() => mock.restore());
function setup(responses: Response[]) {
  const waits: number[] = [];
  const bodies: any[] = [];
  spyOn(Bun, "sleep").mockImplementation(async (duration) => { waits.push(Number(duration)); });
  spyOn(globalThis, "fetch").mockImplementation((async (_url, options) => {
    bodies.push(JSON.parse(String(options?.body)));
    return responses.shift()!;
  }) as typeof fetch);
  return { api: new TelegramApi("123:FAKE"), waits, bodies };
}
const success = (message_id: number) => Response.json({ ok: true, result: { message_id } });
const limited = (retry_after: unknown) => Response.json({ ok: false, error_code: 429, description: "Too many requests", parameters: { retry_after } }, { status: 429 });
test("multipart send retries only the limited part after retry_after", async () => {
  const { api, waits, bodies } = setup([success(1), limited(2), success(2)]);
  expect((await api.send("42", { blocks: [
    { type: "paragraph", text: "a".repeat(20000) },
    { type: "paragraph", text: "b".repeat(20000) },
  ] })).message_ids).toEqual([1, 2]);
  expect(waits).toEqual([2000]);
  expect(bodies[1]).toEqual(bodies[2]);
});
test("rate limits stop after three retries and retain retry metadata", async () => {
  const { api, waits, bodies } = setup(Array.from({ length: 4 }, () => limited(1)));
  await expect(api.send("42", markdown("hi"))).rejects.toMatchObject({ status: 429, retry_after: 1, message_ids: [] });
  expect(waits).toEqual([1000, 1000, 1000]);
  expect(bodies).toHaveLength(4);
});
test("rate limits never wait more than sixty seconds in total", async () => {
  const { api, waits, bodies } = setup([limited(30), limited(30), limited(1)]);
  await expect(api.send("42", markdown("hi"))).rejects.toMatchObject({ status: 429, retry_after: 1 });
  expect(waits).toEqual([30000, 30000]);
  expect(bodies).toHaveLength(3);
});
for (const delay of [61, -1, "2", null]) test(`invalid or excessive retry delay: ${delay}`, async () => {
  const { api, waits } = setup([limited(delay)]);
  await expect(api.send("42", markdown("hi"))).rejects.toMatchObject({ status: 429 });
  expect(waits).toEqual([]);
});
test("exhausted multipart send preserves completed IDs and rate metadata", async () => {
  const { api } = setup([success(7), limited(61)]);
  await expect(api.send("42", { blocks: [
    { type: "paragraph", text: "a".repeat(20000) },
    { type: "paragraph", text: "b".repeat(20000) },
  ] })).rejects.toMatchObject({ status: 429, retry_after: 61, message_ids: [7] });
});
test("unchanged edits succeed with the original message ID", async () => {
  const { api, bodies } = setup([Response.json({ ok: false, description: "Bad Request: message is not modified" }, { status: 400 })]);
  expect(await api.edit("42", 7, markdown("hi"))).toEqual({ ok: true, message_ids: [7] });
  expect(bodies).toHaveLength(1);
});
test("other edit errors and unchanged send errors remain failures", async () => {
  const { api } = setup([
    Response.json({ ok: false, description: "Bad Request: message not found" }, { status: 400 }),
    Response.json({ ok: false, description: "message is not modified" }, { status: 400 }),
  ]);
  await expect(api.edit("42", 7, markdown("hi"))).rejects.toThrow("message not found");
  await expect(api.send("42", markdown("hi"))).rejects.toThrow("not modified");
});
test("plain-text fallback retries rate limits without resending rich content", async () => {
  const { api, bodies, waits } = setup([
    new Response("missing", { status: 404 }), limited(1), success(9),
  ]);
  expect(await api.send("42", markdown("hello"))).toEqual({ ok: true, message_ids: [9], fallback: true });
  expect(bodies.slice(1)).toEqual([{ chat_id: "42", text: "hello" }, { chat_id: "42", text: "hello" }]);
  expect(waits).toEqual([1000]);
});
test("draft retries rate limits and accepts a successful boolean response", async () => {
  const { api, waits } = setup([limited(1), Response.json({ ok: true, result: true })]);
  expect(await api.draft("42", 1, markdown("hello"))).toEqual({ ok: true, message_ids: [] });
  expect(waits).toEqual([1000]);
});
