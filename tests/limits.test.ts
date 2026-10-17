import { expect, test } from "bun:test";
import { splitMessage } from "../src/limits";
import { plaintext } from "../src/plaintext";
import { markdown } from "../src/markdown";
test("split text at top-level block boundaries", () => {
  const blocks = [
    { type: "paragraph", text: "a".repeat(20000) },
    { type: "paragraph", text: "b".repeat(20000) },
  ];
  expect(splitMessage({ blocks, is_rtl: true })).toEqual(
    blocks.map((block) => ({ blocks: [block], is_rtl: true })),
  );
});
test("count nested list items and table rows", () => {
  const block = {
    type: "list",
    items: Array.from({ length: 250 }, () => ({
      blocks: [{ type: "paragraph", text: "x" }],
    })),
  };
  expect(() => splitMessage({ blocks: [block] })).toThrow("500");
  expect(
    splitMessage({
      blocks: Array.from({ length: 501 }, () => ({ type: "divider" })),
    }).length,
  ).toBe(2);
});
test("reject indivisible text and wide table", () => {
  expect(() => splitMessage(markdown("x".repeat(32769)))).toThrow("32768");
  expect(() =>
    splitMessage({
      blocks: [
        {
          type: "table",
          cells: [
            Array.from({ length: 21 }, () => ({
              text: "x",
              align: "left",
              valign: "top",
            })),
          ],
        },
      ],
    }),
  ).toThrow("20");
});
test("split media and reject deep formatting", () => {
  expect(
    splitMessage({
      blocks: Array.from({ length: 51 }, () => ({
        type: "photo",
        photo: { type: "photo", media: "https://example.com/a.jpg" },
      })),
    }).length,
  ).toBe(2);
  let text: any = "x";
  for (let i = 0; i < 17; i++) text = { type: "bold", text };
  expect(() => splitMessage({ blocks: [{ type: "paragraph", text }] })).toThrow(
    "16",
  );
});
test("count Unicode characters rather than bytes", () =>
  expect(splitMessage(markdown("😀".repeat(20000)))).toHaveLength(1));
test("plaintext retains content, links, media, table and maps", () => {
  const source =
    "# Title\n\n**Hi** [site](https://example.com)\n\n- first\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![pic](https://example.com/a.jpg)\n\n```map\n1,2,3\n```\n\n<details><summary>More</summary>body</details>";
  const text = plaintext(markdown(source));
  for (const value of [
    "Title",
    "Hi site (https://example.com)",
    "- first",
    "A | B",
    "1 | 2",
    "https://example.com/a.jpg",
    "1, 2",
    "More",
    "body",
  ])
    expect(text).toContain(value);
  expect(text).not.toContain("**");
});
test("rowspans contribute to the effective column count", () => {
  const cell = { text: "x", align: "left", valign: "top" };
  const cells = [[{ ...cell, colspan: 20, rowspan: 2 }], [cell]];
  expect(() => splitMessage({ blocks: [{ type: "table", cells }] })).toThrow(
    "20",
  );
});
test("plain rendering covers footer, code, quotes and buttons", () => {
  const source =
    "> quote\n\n>! secret\n\n```footer\nFooter\n```\n\n```ts\nx = 1\n```\n\n```buttons\nOpen | https://example.com\n```";
  expect(plaintext(markdown(source))).toBe(
    "quote\n\nsecret\n\nFooter\n\nx = 1\n\nOpen (https://example.com)",
  );
});
