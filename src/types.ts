export type RichText =
  | string
  | RichText[]
  | {
      type: string;
      text?: RichText;
      url?: string;
      [field: string]: unknown;
    };
export interface ListItem {
  blocks: Block[];
  value?: number;
  type?: string;
}
export interface Cell {
  text?: RichText;
  is_header?: true;
  align: string;
  valign: string;
  colspan?: number;
  rowspan?: number;
}
export const buttonStyles = new Set(["danger", "success", "primary", "link"]);
export interface RichMessageButton {
  text: RichText;
  url?: string;
  callback_data?: string;
  /** "link" is only valid on callback buttons. */
  style?: string;
  [field: string]: unknown;
}
export const callbackDataValid = (value: unknown) =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value, "utf8") <= 64;
export interface Block {
  type: string;
  text?: RichText;
  blocks?: Block[];
  items?: ListItem[];
  cells?: Cell[][];
  buttons?: RichMessageButton[];
  summary?: RichText;
  [field: string]: unknown;
}
export interface RichMessage {
  blocks: Block[];
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
}
export class InputError extends Error {}
