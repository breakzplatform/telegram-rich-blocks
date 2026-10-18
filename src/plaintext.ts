import type { Block, RichMessage } from "./types";
export function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(plainText).join("");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const text = plainText(
    record.text ?? record.alternative_text ?? record.expression,
  );
  if (record.url) return `${text} (${record.url})`;
  if (record.button) return plainText(record.button);
  return text;
}
function render(block: Block): string {
  const caption = block.caption ? plainText(block.caption) : "";
  let content = "";
  switch (block.type) {
    case "divider":
      return "---";
    case "list":
      return (block.items ?? [])
        .map(
          (item) =>
            `${item.value !== undefined ? `${item.value}.` : "-"} ${item.blocks.map(render).join("\n  ")}`,
        )
        .join("\n");
    case "table":
      return [
        caption,
        ...(block.cells ?? []).map((row) =>
          row.map((cell) => plainText(cell.text)).join(" | "),
        ),
      ]
        .filter(Boolean)
        .join("\n");
    case "details":
      return `${plainText(block.summary)}\n${(block.blocks ?? []).map(render).join("\n\n")}`;
    case "buttons":
      return (block.buttons ?? []).map(plainText).join("\n");
    case "map": {
      const location = block.location as {
        latitude: number;
        longitude: number;
      };
      content = location
        ? `Map: ${location.latitude}, ${location.longitude}`
        : "Map";
      break;
    }
    default: {
      if (block.blocks) content = block.blocks.map(render).join("\n\n");
      else if (
        [
          "photo",
          "document",
          "video",
          "audio",
          "animation",
          "voice_note",
        ].includes(block.type)
      )
        content = String(
          (block[block.type] as { media?: string })?.media ?? "",
        );
      else content = plainText(block.text ?? block.expression);
    }
  }
  return [content, caption, plainText(block.credit)].filter(Boolean).join("\n");
}
export function plaintext(message: RichMessage): string {
  return message.blocks.map(render).join("\n\n");
}
