# Interleaved Response UI

## Problem

Assistant responses display all thought/text content bunched together, with all tool calls in a separate block below. The user wants each tool call to appear inline, directly under the thought text that preceded it — producing an interleaved sequence: text, tool, text, tool.

## Design

### Data Model

Add a `ContentBlock` union type and a `contentBlocks` field to `Message`:

```typescript
interface TextBlock {
  type: 'text';
  content: string;
}

interface ToolBlock {
  type: 'tool';
  tool: ToolCall;
}

type ContentBlock = TextBlock | ToolBlock;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;              // kept for user messages + DB compat
  contentBlocks?: ContentBlock[]; // assistant messages use this when present
  timestamp: string;
  attachments?: MessageAttachment[];
  isStreaming?: boolean;
}
```

- User messages continue using `content` string only.
- Assistant messages render from `contentBlocks` when present, falling back to `content` for legacy/old messages.

### Backend (No Changes)

The backend (`codexChat.ts`) continues emitting:
- `CHAT_STREAM_TEXT` for text deltas
- `CHAT_TOOL_ACTIVITY` for tool start/complete/error

No backend modifications needed. The interleaving is assembled on the frontend from the natural event ordering.

### Frontend Streaming Assembly (ChatPanel.tsx)

The `toolCalls` state array is removed. Instead, content blocks are built on the message itself:

1. **Text delta arrives** (`onStreamText`): If the last block in `contentBlocks` is a `TextBlock`, append the delta to it. Otherwise, push a new `TextBlock`.
2. **Tool activity arrives** (`onToolActivity`): Find existing `ToolBlock` by tool ID and update it, or push a new `ToolBlock`. This naturally starts a new block after the preceding text.
3. **More text arrives after a tool**: Since the last block is now a `ToolBlock`, a new `TextBlock` is created — producing the interleaved pattern.

### Frontend Rendering (AssistantMessage)

Replace the current single `MarkdownRenderer` + separate `ToolActivity` section with a map over `contentBlocks`:

- `TextBlock` renders `<MarkdownRenderer content={block.content} isStreaming={...} />`
- `ToolBlock` renders the existing `ToolBlock` component inline (collapsed by default)

The standalone `<ToolActivity>` section below messages is removed entirely.

### Completed vs Streaming

Both states render identically — the same interleaved block sequence. No collapsing into a bulk "N tool calls" summary. Each tool row stays collapsed inline under its associated thought text. The transition from streaming to complete is smooth (just `isStreaming` flips to false on the last text block).

### Database Persistence

Add `content_blocks_json TEXT` column to the `messages` table via migration. When saving an assistant message, serialize `contentBlocks` to JSON. When loading, parse it back so history renders with the same interleaved layout.

Old messages without `content_blocks_json` degrade gracefully — they render from the `content` string as before.

### Files to Modify

1. **`src/shared/types.ts`** — Add `TextBlock`, `ToolBlock`, `ContentBlock` types. Add `contentBlocks?` to `Message`.
2. **`src/renderer/components/ChatPanel.tsx`** — Remove `toolCalls` state. Build `contentBlocks` from stream events. Update `AssistantMessage` to render blocks. Remove standalone `<ToolActivity>` section.
3. **`src/renderer/components/ToolActivity.tsx`** — Export `ToolBlock` component for inline use. Remove `ToolSummary` and `LiveToolActivity` (no longer needed). Keep `ToolBlock` and its helpers.
4. **`src/main/db.ts`** — Add `content_blocks_json` column + migration.
5. **`src/main/ipc-handlers.ts`** (or wherever messages are saved/loaded) — Serialize/deserialize `contentBlocks` on save/load.
