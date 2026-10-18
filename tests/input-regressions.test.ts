import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { stateDirectory } from "../src/plugin";
import { parseInput } from "../src/markdown";
import { plaintext } from "../src/plaintext";
import { InputError } from "../src/types";
for (const input of ['{"blocks": [', '  {"blocks": [],}', '{"blocks":'])
  test(`malformed block JSON fails closed: ${input}`, () => {
    expect(() => parseInput(input)).toThrow(InputError);
  });
test("brace-prefixed prose still renders as Markdown", () => {
  expect(plaintext(parseInput('{some prose mentioning "blocks"}'))).toBe('{some prose mentioning "blocks"}');
});
test("state paths expand the home shorthand", () => {
  expect(stateDirectory({ TELEGRAM_STATE_DIR: "~/telegram" })).toBe(join(homedir(), "telegram"));
  expect(stateDirectory({ TELEGRAM_STATE_DIR: "~" })).toBe(homedir());
  expect(stateDirectory({ CLAUDE_CONFIG_DIR: "~/claude" })).toBe(join(homedir(), "claude/channels/telegram"));
  expect(stateDirectory({ TELEGRAM_STATE_DIR: "~someone/state" })).toBe("~someone/state");
});
test("maps without a location retain caption and credit", () => {
  expect(plaintext({ blocks: [{ type: "map", caption: "Meeting place", credit: "Alice" }] })).toBe("Map\nMeeting place\nAlice");
  expect(plaintext({ blocks: [{ type: "map" }] })).toBe("Map");
  expect(plaintext({ blocks: [{ type: "map", location: { latitude: 1, longitude: 2 } }] })).toBe("Map: 1, 2");
});
