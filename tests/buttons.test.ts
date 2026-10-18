import { expect, test } from "bun:test";
import { markdown } from "../src/markdown";
import { splitMessage } from "../src/limits";
import { plaintext } from "../src/plaintext";
const fence = (body: string) => "```buttons\n" + body + "\n```";
test("callback buttons with and without style", () => {
  expect(
    markdown(
      fence(
        [
          "Approve | callback:approve:42 | success",
          "Reject | callback:reject:42 | danger",
          "Details | callback:details | link",
          "Plain | callback:plain",
        ].join("\n"),
      ),
    ).blocks[0].buttons,
  ).toEqual([
    { text: "Approve", callback_data: "approve:42", style: "success" },
    { text: "Reject", callback_data: "reject:42", style: "danger" },
    { text: "Details", callback_data: "details", style: "link" },
    { text: "Plain", callback_data: "plain" },
  ]);
});
test("URL buttons accept a style and keep the old syntax", () => {
  expect(
    markdown(
      fence("Docs | https://example.com | primary\nOld | https://example.org"),
    ).blocks[0].buttons,
  ).toEqual([
    { text: "Docs", url: "https://example.com", style: "primary" },
    { text: "Old", url: "https://example.org" },
  ]);
});
test("callback data counts UTF-8 bytes", () => {
  const fits = "é".repeat(32);
  expect(
    markdown(fence(`Go | callback:${fits}`)).blocks[0].buttons?.[0]
      .callback_data,
  ).toBe(fits);
});
for (const body of [
  `Go | callback:${"a".repeat(65)}`,
  `Go | callback:${"é".repeat(33)}`,
  "Go | callback:",
  "Go | callback:x | bogus",
  "Go | https://example.com | link",
  "Go | https://example.com | bogus",
  "Ok | callback:x\nBad | callback:y | huge",
]) {
  test(`invalid button line renders the fence literally: ${body.slice(0, 40)}`, () =>
    expect(markdown(fence(body)).blocks[0]).toEqual({
      type: "paragraph",
      text: fence(body),
    }));
}
test("raw blocks validate callback data and styles", () => {
  const row = (button: Record<string, unknown>) => ({
    blocks: [{ type: "buttons", buttons: [{ text: "x", ...button }] }],
  });
  expect(() => splitMessage(row({ callback_data: "ok", style: "link" }))).not.toThrow();
  for (const button of [
    { callback_data: "a".repeat(65) },
    { callback_data: "" },
    { callback_data: "x", url: "https://example.com" },
    { url: "https://example.com", style: "link" },
    { callback_data: "x", style: "loud" },
  ])
    expect(() => splitMessage(row(button))).toThrow();
});
test("plain-text fallback keeps only the callback label", () => {
  expect(
    plaintext(
      markdown(fence("Approve | callback:approve | success\nDocs | https://example.com")),
    ),
  ).toBe("Approve\nDocs (https://example.com)");
});
