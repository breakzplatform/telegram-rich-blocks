import {
  InputError,
  type Block,
  type RichMessage,
  type RichText,
  type ListItem,
} from "./types";

const markers: [string, string][] = [
  ["**", "bold"],
  ["__", "underline"],
  ["~~", "strikethrough"],
  ["||", "spoiler"],
  ["`", "code"],
  ["*", "italic"],
  ["_", "italic"],
];
export function inline(source: string, depth = 0): RichText {
  if (depth >= 12) return source;
  const parts: RichText[] = [];
  let plain = "";
  const flush = () => {
    if (plain) parts.push(plain);
    plain = "";
  };
  for (let position = 0; position < source.length;) {
    const rest = source.slice(position);
    const link = rest.match(/^\[([^\]\n]+)\]\(([^\s)]+)\)/);
    if (link && /^(https?:|tg:|mailto:|tel:)/i.test(link[2])) {
      flush();
      parts.push({
        type: "url",
        text: inline(link[1], depth + 1),
        url: link[2],
      });
      position += link[0].length;
      continue;
    }
    let matched = false;
    for (const [marker, type] of markers) {
      if (!rest.startsWith(marker)) continue;
      const end = source.indexOf(marker, position + marker.length);
      if (end <= position + marker.length) continue;
      flush();
      const content = source.slice(position + marker.length, end);
      parts.push({
        type,
        text: type === "code" ? content : inline(content, depth + 1),
      });
      position = end + marker.length;
      matched = true;
      break;
    }
    if (!matched) plain += source[position++];
  }
  flush();
  return parts.length === 1 ? parts[0] : parts.length ? parts : "";
}
const paragraph = (text: string, literal = false): Block => ({
  type: "paragraph",
  text: literal ? text : inline(text),
});
const listPattern = /^( *)([-+*]|\d+\.)\s+(.+)$/;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((value) => value.trim().replace(/\\\|/g, "|"));
const tableSeparator = (line: string) =>
  cells(line).every((value) => /^:?-{3,}:?$/.test(value));
const urlAllowed = (value: string) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

export function markdown(source: string, depth = 0): RichMessage {
  if (depth >= 8) return { blocks: [paragraph(source, true)] };
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let position = 0;
  const special = (index: number) =>
    /^(#{1,6} |```|>|<details|!\[|<!-- table:compact -->|---\s*$|\*\*\*\s*$)/.test(
      lines[index],
    ) ||
    listPattern.test(lines[index]) ||
    (lines[index].includes("|") &&
      index + 1 < lines.length &&
      tableSeparator(lines[index + 1]));
  while (position < lines.length) {
    const line = lines[position];
    if (!line.trim()) {
      position++;
      continue;
    }
    const fence = line.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      const start = position++;
      while (position < lines.length && lines[position].trim() !== "```")
        position++;
      if (position === lines.length) {
        blocks.push(paragraph(lines.slice(start).join("\n"), true));
        break;
      }
      const content = lines.slice(start + 1, position).join("\n");
      position++;
      const literal = () =>
        paragraph(lines.slice(start, position).join("\n"), true);
      if (fence[1] === "footer")
        blocks.push({ type: "footer", text: inline(content) });
      else if (fence[1] === "map") {
        const values = content.trim().split(",");
        const [latitude, longitude, zoom] = values.map(Number);
        if (
          values.length < 2 ||
          values.length > 3 ||
          values.some((value) => !value.trim()) ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 ||
          Math.abs(longitude) > 180 ||
          (zoom !== undefined &&
            (!Number.isInteger(zoom) || zoom < 0 || zoom > 24))
        )
          blocks.push(literal());
        else
          blocks.push({
            type: "map",
            location: { latitude, longitude },
            ...(zoom !== undefined ? { zoom } : {}),
          });
      } else if (fence[1] === "buttons") {
        const buttons = content
          .split("\n")
          .filter((value) => value.trim())
          .map((value) => value.match(/^(.+?)\s*\|\s*(https?:\/\/\S+)\s*$/));
        if (
          !buttons.length ||
          buttons.some((value) => !value || !urlAllowed(value[2]))
        )
          blocks.push(literal());
        else
          for (let index = 0; index < buttons.length; index += 8)
            blocks.push({
              type: "buttons",
              buttons: buttons
                .slice(index, index + 8)
                .map((value) => ({ text: value![1].trim(), url: value![2] })),
            });
      } else
        blocks.push({
          type: "pre",
          text: content,
          ...(fence[1] ? { language: fence[1] } : {}),
        });
      continue;
    }
    if (line.startsWith("<details")) {
      const start = position;
      while (position < lines.length && !lines[position].includes("</details>"))
        position++;
      if (position < lines.length) position++;
      const content = lines.slice(start, position).join("\n");
      const match = content.match(
        /^<details( open)?\s*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*)<\/details>\s*$/,
      );
      blocks.push(
        match
          ? {
              type: "details",
              summary: inline(match[2]),
              blocks: markdown(match[3].trim(), depth + 1).blocks,
              ...(match[1] ? { is_open: true } : {}),
            }
          : paragraph(content, true),
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        size: heading[1].length,
        text: inline(heading[2]),
      });
      position++;
      continue;
    }
    if (/^(---|\*\*\*)\s*$/.test(line)) {
      blocks.push({ type: "divider" });
      position++;
      continue;
    }
    if (line.startsWith(">")) {
      const expandable = line.startsWith(">!");
      const collected: string[] = [];
      while (
        position < lines.length &&
        (expandable
          ? lines[position].startsWith(">!")
          : /^>(?!\!)/.test(lines[position]))
      )
        collected.push(
          lines[position++].replace(expandable ? /^>! ?/ : /^> ?/, ""),
        );
      blocks.push(
        expandable
          ? {
              type: "expandable_blockquote",
              text: inline(collected.join("\n")),
            }
          : {
              type: "blockquote",
              blocks: markdown(collected.join("\n"), depth + 1).blocks,
            },
      );
      continue;
    }
    const item = line.match(listPattern);
    if (item && item[1].length === 0) {
      const items: ListItem[] = [];
      const ordered = /\d/.test(item[2]);
      while (position < lines.length) {
        const current = lines[position].match(listPattern);
        if (!current || current[1].length || /\d/.test(current[2]) !== ordered)
          break;
        position++;
        const content = [current[3]];
        const nested: string[] = [];
        while (position < lines.length && /^ {2,}\S/.test(lines[position]))
          nested.push(lines[position++].replace(/^ {2}/, ""));
        const itemBlocks = [paragraph(content.join("\n"))];
        if (nested.length)
          itemBlocks.push(...markdown(nested.join("\n"), depth + 1).blocks);
        items.push({
          blocks: itemBlocks,
          ...(ordered ? { value: parseInt(current[2]), type: "1" } : {}),
        });
      }
      blocks.push({ type: "list", items });
      continue;
    }
    const compact = line === "<!-- table:compact -->";
    const header = position + (compact ? 1 : 0);
    if (
      header + 1 < lines.length &&
      lines[header].includes("|") &&
      tableSeparator(lines[header + 1])
    ) {
      const titles = cells(lines[header]);
      const separators = cells(lines[header + 1]);
      const rows = [titles];
      position = header + 2;
      while (
        position < lines.length &&
        lines[position].includes("|") &&
        lines[position].trim()
      )
        rows.push(cells(lines[position++]));
      if (
        separators.length !== titles.length ||
        rows.some((row) => row.length !== titles.length)
      )
        blocks.push(paragraph(lines.slice(header, position).join("\n"), true));
      else
        blocks.push({
          type: "table",
          ...(compact ? { is_compact: true } : {}),
          cells: rows.map((row, index) =>
            row.map((value, column) => ({
              text: inline(value),
              ...(index === 0 ? { is_header: true as const } : {}),
              align: separators[column].endsWith(":")
                ? separators[column].startsWith(":")
                  ? "center"
                  : "right"
                : "left",
              valign: "top",
            })),
          ),
        });
      continue;
    }
    const media = line.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/);
    if (media) {
      if (
        urlAllowed(media[2]) &&
        /\.(png|jpe?g|webp|pdf|zip)(?:[?#]|$)/i.test(media[2])
      ) {
        const type = /\.(png|jpe?g|webp)(?:[?#]|$)/i.test(media[2])
          ? "photo"
          : "document";
        blocks.push({
          type,
          [type]: { type, media: media[2] },
          ...(media[1] ? { caption: { text: inline(media[1]) } } : {}),
        });
      } else blocks.push(paragraph(line, true));
      position++;
      continue;
    }
    const content = [line];
    position++;
    while (
      position < lines.length &&
      lines[position].trim() &&
      !special(position)
    )
      content.push(lines[position++]);
    blocks.push(paragraph(content.join("\n")));
  }
  return { blocks };
}

export function parseInput(input: unknown): RichMessage {
  if (typeof input === "string") {
    if (input.trimStart().startsWith("{")) {
      try {
        const parsed = JSON.parse(input);
        if (parsed && "blocks" in parsed) return parseInput(parsed);
      } catch (error) {
        if (error instanceof InputError) throw error;
      }
    }
    return markdown(input);
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InputError("Expected markdown or an object with blocks");
  const message = input as Record<string, unknown>;
  if (
    !Array.isArray(message.blocks) ||
    Object.keys(message).some(
      (key) => !["blocks", "is_rtl", "skip_entity_detection"].includes(key),
    )
  )
    throw new InputError(
      "Expected blocks with optional is_rtl and skip_entity_detection",
    );
  for (const key of ["is_rtl", "skip_entity_detection"])
    if (message[key] !== undefined && typeof message[key] !== "boolean")
      throw new InputError(`${key} must be boolean`);
  const validate = (blocks: unknown[], depth: number) => {
    if (depth > 16) throw new InputError("Maximum nesting depth is 16");
    for (const block of blocks) {
      if (
        !block ||
        typeof block !== "object" ||
        typeof (block as Block).type !== "string"
      )
        throw new InputError("Each block must have a type");
      const value = block as Block;
      if (value.blocks !== undefined) {
        if (!Array.isArray(value.blocks))
          throw new InputError("blocks must be an array");
        validate(value.blocks, depth + 1);
      }
      if (value.items !== undefined) {
        if (!Array.isArray(value.items))
          throw new InputError("items must be an array");
        for (const item of value.items) {
          if (!item || !Array.isArray(item.blocks))
            throw new InputError("List items require blocks");
          validate(item.blocks, depth + 2);
        }
      }
    }
  };
  validate(message.blocks, 0);
  return input as RichMessage;
}
