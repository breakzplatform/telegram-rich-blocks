import {
  InputError,
  buttonStyles,
  callbackDataValid,
  type Block,
  type RichMessage,
} from "./types";
export const LIMITS = {
  characters: 32768,
  blocks: 500,
  depth: 16,
  media: 50,
  columns: 20,
};
interface Usage {
  characters: number;
  blocks: number;
  media: number;
}
const mediaTypes = new Set([
  "photo",
  "document",
  "video",
  "audio",
  "animation",
  "voice_note",
]);
const textFields = new Set([
  "text",
  "summary",
  "credit",
  "alternative_text",
  "expression",
]);
function measure(value: unknown, depth = 0, context = ""): Usage {
  const usage: Usage = { characters: 0, blocks: 0, media: 0 };
  if (depth > LIMITS.depth) throw new InputError("Maximum nesting depth is 16");
  if (typeof value === "string") {
    usage.characters = Array.from(value).length;
    return usage;
  }
  if (!value || typeof value !== "object") return usage;
  const add = (next: Usage) => {
    usage.characters += next.characters;
    usage.blocks += next.blocks;
    usage.media += next.media;
  };
  if (Array.isArray(value)) {
    for (const child of value) add(measure(child, depth, context));
    return usage;
  }
  const record = value as Record<string, unknown>;
  if (context === "block") {
    usage.blocks++;
    if (mediaTypes.has(String(record.type))) usage.media++;
    if (
      record.type === "buttons" &&
      (!Array.isArray(record.buttons) ||
        record.buttons.length < 1 ||
        record.buttons.length > 8)
    )
      throw new InputError("Button rows require 1-8 buttons");
    if (record.type === "buttons")
      for (const button of record.buttons as Record<string, unknown>[]) {
        if (!button || typeof button !== "object")
          throw new InputError("Invalid button");
        if (button.url !== undefined && button.callback_data !== undefined)
          throw new InputError("A button takes either url or callback_data");
        if (
          button.callback_data !== undefined &&
          !callbackDataValid(button.callback_data)
        )
          throw new InputError("callback_data must be 1-64 bytes");
        if (
          button.style !== undefined &&
          (!buttonStyles.has(String(button.style)) ||
            (button.style === "link" && button.callback_data === undefined))
        )
          throw new InputError(
            'Button style must be danger, success, primary or (callback only) link',
          );
      }
    if (
      record.type === "heading" &&
      (!Number.isInteger(record.size) ||
        Number(record.size) < 1 ||
        Number(record.size) > 6)
    )
      throw new InputError("Heading size must be 1-6");
    if (record.type === "map") {
      const { width, height, zoom } = record;
      if (
        zoom !== undefined &&
        (!Number.isInteger(zoom) || Number(zoom) < 0 || Number(zoom) > 24)
      )
        throw new InputError("Map zoom must be 0-24");
      for (const dimension of [width, height])
        if (
          dimension !== undefined &&
          (!Number.isInteger(dimension) ||
            Number(dimension) < 0 ||
            Number(dimension) > 10000)
        )
          throw new InputError("Map dimensions must be 0-10000");
      if (
        width !== undefined &&
        height !== undefined &&
        (Number(width) + Number(height) > 10000 ||
          Math.max(Number(width), Number(height)) >
            20 * Math.min(Number(width), Number(height)))
      )
        throw new InputError("Map dimensions exceed sum 10000 or ratio 20");
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (textFields.has(key)) add(measure(child, depth + 1, "text"));
    else if (key === "blocks") add(measure(child, depth + 1, "block"));
    else if (key === "items") {
      if (!Array.isArray(child))
        throw new InputError("List items must be an array");
      usage.blocks += child.length;
      add(measure(child, depth + 1, "item"));
    } else if (key === "cells") {
      if (!Array.isArray(child))
        throw new InputError("Table cells must be rows");
      usage.blocks += child.length;
      const occupied: number[] = [];
      for (const row of child) {
        if (!Array.isArray(row))
          throw new InputError("Table cells must be rows");
        let columns = 0;
        for (const cell of row) {
          if (!cell || typeof cell !== "object")
            throw new InputError("Invalid table cell");
          for (const key of ["colspan", "rowspan"])
            if (
              cell[key] !== undefined &&
              (!Number.isInteger(cell[key]) || cell[key] < 1)
            )
              throw new InputError("Table spans must be positive integers");
          while ((occupied[columns] ?? 0) > 0) columns++;
          const end = columns + (cell.colspan ?? 1);
          if (end > LIMITS.columns)
            throw new InputError("Tables support at most 20 columns");
          for (let column = columns; column < end; column++) {
            if ((occupied[column] ?? 0) > 0)
              throw new InputError("Overlapping table spans");
            occupied[column] = cell.rowspan ?? 1;
          }
          columns = end;
        }
        if (columns > LIMITS.columns)
          throw new InputError("Tables support at most 20 columns");
        add(measure(row, depth + 1, "cell"));
        for (let column = 0; column < occupied.length; column++)
          occupied[column] = Math.max(0, occupied[column] - 1);
      }
    } else if (key === "caption" || key === "buttons" || key === "button")
      add(measure(child, depth + 1, key));
  }
  return usage;
}
export function splitMessage(message: RichMessage): RichMessage[] {
  if (!message.blocks.length)
    throw new InputError("Message must contain at least one block");
  const result: RichMessage[] = [];
  let blocks: Block[] = [];
  let total: Usage = { characters: 0, blocks: 0, media: 0 };
  for (const block of message.blocks) {
    const usage = measure(block, 0, "block");
    for (const key of ["characters", "blocks", "media"] as const)
      if (usage[key] > LIMITS[key])
        throw new InputError(
          `One block exceeds ${LIMITS[key]} ${key}; split the block manually`,
        );
    if (
      (Object.keys(total) as (keyof Usage)[]).some(
        (key) => total[key] + usage[key] > LIMITS[key],
      )
    ) {
      result.push({ ...message, blocks });
      blocks = [];
      total = { characters: 0, blocks: 0, media: 0 };
    }
    blocks.push(block);
    for (const key of Object.keys(total) as (keyof Usage)[])
      total[key] += usage[key];
  }
  result.push({ ...message, blocks });
  return result;
}
export function singleMessage(message: RichMessage): RichMessage {
  const parts = splitMessage(message);
  if (parts.length !== 1)
    throw new InputError(
      "Drafts and edits require one message; shorten the content",
    );
  return parts[0];
}
