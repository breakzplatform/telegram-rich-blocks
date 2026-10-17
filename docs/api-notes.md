# API notes

Verified against the [Telegram Bot API](https://core.telegram.org/bots/api.md),
[rich messages](https://core.telegram.org/bots/api/rich-messages.md), linked type
pages and [changelog](https://core.telegram.org/bots/api-changelog.md) on 2026-10-17.
Target: **Bot API 10.3 (2026-08-24)**. Rich messages debuted in 10.1 (2026-06-11);
explicit input blocks arrived in 10.2 (2026-07-14).

## Fields emitted

- `sendRichMessage`: `chat_id`, `rich_message`, optional `disable_notification`,
  `message_thread_id`, `reply_parameters: {message_id}`.
- `sendRichMessageDraft`: integer private `chat_id`, nonzero integer `draft_id`,
  `rich_message`, optional `can_stop`. Returns true; preview expires after 30
  seconds. Final content must be sent through sendRichMessage. URL uploads are
  prohibited in drafts; this library rejects media attachments in drafts.
- `editMessageText`: `chat_id`, `message_id`, `rich_message` (no `text` needed).
- `sendMessage` fallback: `chat_id`, `text` (1–4096 characters), optional
  `disable_notification`, `message_thread_id`, `reply_parameters: {message_id}`.
- `InputRichMessage`: `blocks`, optional `is_rtl`, `skip_entity_detection`.
  Exactly one of `blocks`, `markdown`, `html` is allowed by Telegram; this
  library's raw input accepts only the blocks form. The API also has `media`
  for its native markdown/html modes; we do not emit it.
- `RichText`: string, array of RichText, or tagged object. Converter emits
  `type` + `text` for `bold`, `italic`, `underline`, `strikethrough`, `spoiler`,
  `code`; `url` additionally has `url`. Mentions and hashtags remain strings.
- `InputRichBlockParagraph`: `type: paragraph`, `text`.
- `InputRichBlockSectionHeading`: `type: heading`, `text`, `size` (1–6).
- `InputRichBlockPreformatted`: `type: pre`, `text`, optional `language`.
- `InputRichBlockFooter`: `type: footer`, `text`.
- `InputRichBlockDivider`: `type: divider`.
- `InputRichBlockList`: `type: list`, `items`. `InputRichBlockListItem` has
  `blocks`; numbered items additionally have `value` and `type: "1"`.
- `InputRichBlockBlockQuotation`: `type: blockquote`, `blocks`.
- `InputRichBlockExpandableBlockQuotation`: `type: expandable_blockquote`,
  `text` (unlike ordinary quotations, no nested blocks).
- `InputRichBlockTable`: `type: table`, `cells`, optional `is_compact: true`.
  `RichBlockTableCell`: `text`, optional `is_header: true`, required `align`
  (`left`, `center`, `right`) and `valign` (`top`, `middle`, `bottom`).
- `InputRichBlockDetails`: `type: details`, `summary`, `blocks`, optional
  `is_open: true`.
- `InputRichBlockButtons`: `type: buttons`, `buttons` (1–8).
  `RichMessageButton`: `text` (plain string here), `url`. No `type` field.
- `InputRichBlockMap`: `type: map`, `location: {latitude, longitude}`, optional
  `zoom` (0–24). Optional raw `width`/`height`: 0–10000, sum ≤10000, ratio ≤20.
- `InputRichBlockPhoto` / `InputRichBlockDocument`: `type: photo` / `document`,
  matching `photo` / `document` field with `InputMediaPhoto` / `InputMediaDocument`
  (`type`, `media` URL), optional `caption: {text}` (`RichBlockCaption`). URLs
  must be HTTP(S); Telegram fetches them. File-format and size restrictions
  still apply server-side; document URL delivery is normally PDF/ZIP only.

All InputRichBlock* and RichText* reference pages were reviewed. Other raw
block/entity variants are passed through after light shape/limit validation;
Telegram remains responsible for full type validation. Raw media file IDs work
for sends; multipart uploads are outside this project's scope.

## Limits and interpretation

The formatting reference specifies 32768 UTF-8 **characters** (counted as
Unicode code points here, not bytes), 500 blocks including nested blocks,
list items and table rows, nesting depth 16, 50 attachments, 20 table columns.
Text totals include captions, summaries, button labels, custom emoji alternative
text and formula source; formatting tags and URLs are not visible text.
Tables count their rows as blocks. A single oversized block fails clearly.
Messages exceeding aggregate limits split at top-level block boundaries.
Drafts and edits cannot split. Cross-block anchor/reference semantics may need
manual adjustment when raw messages split.

`EphemeralMessageParameters` was reviewed: required `receiver_user_id`, optional
`callback_query_id`, `replace_callback_query_message`. It is a separate feature,
not required for drafts, and is not emitted by this project. Draft `can_stop`
only requests a UI button: this sender never consumes stop-generation updates.
