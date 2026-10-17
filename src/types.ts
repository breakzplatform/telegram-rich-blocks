export type RichText = string | RichText[] | {
  type: string; text?: RichText; url?: string; [field: string]: unknown;
};
export interface ListItem { blocks: Block[]; value?: number; type?: string }
export interface Cell { text?: RichText; is_header?: true; align: string; valign: string; colspan?: number; rowspan?: number }
export interface Block {
  type: string;
  text?: RichText;
  blocks?: Block[];
  items?: ListItem[];
  cells?: Cell[][];
  buttons?: {text: RichText; url?: string; [field: string]: unknown}[];
  summary?: RichText;
  [field: string]: unknown;
}
export interface RichMessage { blocks: Block[]; is_rtl?: boolean; skip_entity_detection?: boolean }
export class InputError extends Error {}
