# Interleaved Response UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bunched text-then-tools response layout with an interleaved sequence where each tool call appears inline under the thought text that preceded it.

**Architecture:** Add a `ContentBlock[]` array to `Message` that captures text and tool blocks in arrival order. The frontend assembles this array from the existing `CHAT_STREAM_TEXT` and `CHAT_TOOL_ACTIVITY` events. The backend accumulates blocks alongside `finalText` and returns them for DB persistence. Rendering maps over the block array, showing `MarkdownRenderer` for text blocks and collapsed `ToolBlock` rows for tool blocks.

**Tech Stack:** TypeScript, React, Electron IPC, better-sqlite3

---

### Task 1: Add ContentBlock types to shared types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the new types**

Add after the existing `ToolCall` interface (after line 29):

```typescript
export interface TextBlock {
  type: 'text';
  content: string;
}

export interface ToolContentBlock {
  type: 'tool';
  tool: ToolCall;
}

export type ContentBlock = TextBlock | ToolContentBlock;
```

Then add `contentBlocks?` to the `Message` interface. The full interface becomes:

```typescript
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contentBlocks?: ContentBlock[];
  timestamp: string;
  attachments?: MessageAttachment[];
  isStreaming?: boolean;
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add ContentBlock types to shared types"
```

---

### Task 2: Add content_blocks_json column to DB

**Files:**
- Modify: `src/main/db.ts`

- [ ] **Step 1: Add migration for content_blocks_json column**

After the existing `codex_thread_id` migration (line 72-75), add:

```typescript
    // Migration: ensure content_blocks_json column exists
    try {
      db.exec(`ALTER TABLE messages ADD COLUMN content_blocks_json TEXT`);
    } catch {
      // Column already exists — ignore
    }
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/main/db.ts
git commit -m "feat: add content_blocks_json column migration"
```

---

### Task 3: Accumulate content blocks in backend and return them

**Files:**
- Modify: `src/main/codex/codexChat.ts`
- Modify: `src/main/registerIpc.ts`

- [ ] **Step 1: Track content blocks in codexChat.ts**

In the `streamCodexChat` function, add a `contentBlocks` array alongside the existing `finalText` variable. After line 156 (`const streamedTextByItemId = ...`), add:

```typescript
    const contentBlocks: Array<{ type: 'text'; content: string } | { type: 'tool'; tool: ToolCall }> = [];
```

Then modify the text streaming section (around line 213-222). After the existing `webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, ...)` call at line 219, add logic to track the text block:

```typescript
            // Track in content blocks
            const lastBlock = contentBlocks[contentBlocks.length - 1];
            if (lastBlock?.type === 'text') {
              lastBlock.content += delta;
            } else {
              contentBlocks.push({ type: 'text', content: delta });
            }
```

In the tool started section (around line 226-244), after the `emitToolActivity(...)` call at line 230, add:

```typescript
          contentBlocks.push({
            type: 'tool',
            tool: {
              id: itemId,
              name: codexItemToolName(itemType),
              status: 'running',
              detail,
              input,
            },
          });
```

In the tool completed section (around line 248-280), after the `emitToolActivity(...)` call at line 265, update the existing tool block:

```typescript
          const toolBlockIdx = contentBlocks.findIndex(
            (b) => b.type === 'tool' && b.tool.id === itemId,
          );
          if (toolBlockIdx >= 0) {
            const tb = contentBlocks[toolBlockIdx] as { type: 'tool'; tool: ToolCall };
            tb.tool = {
              id: itemId,
              name: pending?.name ?? codexItemToolName(itemType),
              status: 'success',
              detail: pending?.detail ?? codexItemDetail(itemRecord),
              input: pending?.input ?? JSON.stringify(codexItemInput(itemRecord), null, 2),
              output: codexItemOutput(itemRecord),
              durationMs: pending ? Date.now() - pending.startedAt : undefined,
            };
          }
```

In the tool failed section (around line 284-296), after the `emitToolActivity(...)` call, update the tool block similarly:

```typescript
          const toolBlockIdx = contentBlocks.findIndex(
            (b) => b.type === 'tool' && b.tool.id === itemId,
          );
          if (toolBlockIdx >= 0) {
            const tb = contentBlocks[toolBlockIdx] as { type: 'tool'; tool: ToolCall };
            tb.tool = {
              id: itemId,
              name: pending?.name ?? codexItemToolName(itemType),
              status: 'error',
              detail: pending?.detail ?? codexItemDetail(itemRecord),
              input: pending?.input ?? JSON.stringify(codexItemInput(itemRecord), null, 2),
              output: codexItemOutput(itemRecord),
              durationMs: pending ? Date.now() - pending.startedAt : undefined,
            };
          }
```

Also handle the `agent_message` completed text at line 249-259. After the existing `webContents.send` for remainder, add:

```typescript
            const lastBlock = contentBlocks[contentBlocks.length - 1];
            if (lastBlock?.type === 'text') {
              lastBlock.content = finalText;
            } else {
              contentBlocks.push({ type: 'text', content: text });
            }
```

Finally, change the return type and both `resolve()` calls to include `contentBlocks`:

Change the return type from:
```typescript
export function streamCodexChat(opts: StreamCodexChatOpts): Promise<{ response: string; error?: string }>
```
to:
```typescript
export function streamCodexChat(opts: StreamCodexChatOpts): Promise<{ response: string; contentBlocks: typeof contentBlocks; error?: string }>
```

Actually, use a proper import. Change the return type to:

```typescript
import type { ToolCall, ContentBlock } from '../../shared/types';

export function streamCodexChat(opts: StreamCodexChatOpts): Promise<{ response: string; contentBlocks: ContentBlock[]; error?: string }>
```

Change `resolve({ response: finalText, error: ... })` to `resolve({ response: finalText, contentBlocks, error: ... })`.
Change `resolve({ response: finalText })` to `resolve({ response: finalText, contentBlocks })`.

- [ ] **Step 2: Save content blocks in registerIpc.ts**

In `src/main/registerIpc.ts`, modify the assistant message INSERT (around line 53-56). Change:

```typescript
      db.prepare('INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)')
        .run(assistantMsgId, conversationId, 'assistant', result.response);
```

to:

```typescript
      db.prepare('INSERT INTO messages (id, conversation_id, role, content, content_blocks_json) VALUES (?, ?, ?, ?, ?)')
        .run(assistantMsgId, conversationId, 'assistant', result.response, JSON.stringify(result.contentBlocks));
```

- [ ] **Step 3: Load content blocks in CHAT_LOAD handler**

In the same file, modify the `CHAT_LOAD` handler (around line 93-102). Change the SELECT to include `content_blocks_json`:

```typescript
  ipcMain.handle(IPC.CHAT_LOAD, async (_event, id) => {
    const messages = getDb().prepare(
      'SELECT id, role, content, created_at as timestamp, attachments_json, content_blocks_json FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(id) as any[];
    return messages.map(m => ({
      ...m,
      attachments: m.attachments_json ? JSON.parse(m.attachments_json) : undefined,
      attachments_json: undefined,
      contentBlocks: m.content_blocks_json ? JSON.parse(m.content_blocks_json) : undefined,
      content_blocks_json: undefined,
    }));
  });
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/main/codex/codexChat.ts src/main/registerIpc.ts
git commit -m "feat: accumulate and persist content blocks in backend"
```

---

### Task 4: Export ToolBlock component for inline use

**Files:**
- Modify: `src/renderer/components/ToolActivity.tsx`

- [ ] **Step 1: Export ToolBlock**

The `ToolBlock` component (line 236) is currently a private function. Add the `export` keyword:

Change:
```typescript
function ToolBlock({ tool, isActiveTool = false, isPastTool = false }: { tool: ToolCall; isActiveTool?: boolean; isPastTool?: boolean }) {
```
to:
```typescript
export function ToolBlock({ tool, isActiveTool = false, isPastTool = false }: { tool: ToolCall; isActiveTool?: boolean; isPastTool?: boolean }) {
```

The `ToolSummary`, `LiveToolActivity`, and the default `ToolActivity` export will remain for now (they'll become unused after Task 5, and can be cleaned up then or left for tree-shaking).

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ToolActivity.tsx
git commit -m "feat: export ToolBlock component for inline use"
```

---

### Task 5: Rewrite ChatPanel to use content blocks

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`

This is the core change. The `toolCalls` state goes away. Content blocks are assembled on the streaming message and rendered inline.

- [ ] **Step 1: Update imports**

Add imports at the top of the file. Change:

```typescript
import ToolActivity from './ToolActivity';
import type { ToolCall } from '../../shared/types';
```

to:

```typescript
import { ToolBlock as ToolBlockComponent } from './ToolActivity';
import type { ToolCall, ContentBlock } from '../../shared/types';
```

- [ ] **Step 2: Remove toolCalls state**

Delete line 190:
```typescript
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
```

- [ ] **Step 3: Remove setToolCalls([]) from handleSend**

In the `handleSend` callback (around line 330), remove:
```typescript
    setToolCalls([]);
```

- [ ] **Step 4: Rewrite onStreamText handler to build content blocks**

Replace the `onStreamText` handler (lines 243-265) with:

```typescript
    const unsubText = api.onStreamText((payload: { delta: string; conversationId: string }) => {
      if (payload.conversationId !== conversationIdRef.current) return;

      setIsStreaming(true);

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.isStreaming) {
          const blocks = [...(last.contentBlocks || [])];
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock?.type === 'text') {
            blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + payload.delta };
          } else {
            blocks.push({ type: 'text', content: payload.delta });
          }
          const updated = {
            ...last,
            content: last.content + payload.delta,
            contentBlocks: blocks,
          };
          streamingMsgRef.current = updated;
          return [...prev.slice(0, -1), updated];
        }
        // New assistant message
        const newMsg: Message = {
          id: `stream-${Date.now()}`,
          role: 'assistant',
          content: payload.delta,
          contentBlocks: [{ type: 'text', content: payload.delta }],
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          isStreaming: true,
        };
        streamingMsgRef.current = newMsg;
        return [...prev, newMsg];
      });
    });
```

- [ ] **Step 5: Rewrite onToolActivity handler to add tool blocks**

Replace the `onToolActivity` handler (lines 296-307) with:

```typescript
    const unsubTool = api.onToolActivity?.((payload: ToolCall & { conversationId: string }) => {
      if (payload.conversationId !== conversationIdRef.current) return;

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;

        const blocks = [...(last.contentBlocks || [])];
        const existingIdx = blocks.findIndex(
          (b) => b.type === 'tool' && b.tool.id === payload.id,
        );
        if (existingIdx >= 0) {
          blocks[existingIdx] = { type: 'tool', tool: payload };
        } else {
          blocks.push({ type: 'tool', tool: payload });
        }
        const updated = { ...last, contentBlocks: blocks };
        streamingMsgRef.current = last.isStreaming ? updated : streamingMsgRef.current;
        return [...prev.slice(0, -1), updated];
      });
    });
```

- [ ] **Step 6: Rewrite AssistantMessage to render content blocks**

Replace the entire `AssistantMessage` component (lines 145-163) with:

```typescript
const AssistantMessage = React.memo(function AssistantMessage({
  message,
}: {
  message: Message;
}) {
  const blocks = message.contentBlocks;

  // Fallback for legacy messages without content blocks
  if (!blocks || blocks.length === 0) {
    return (
      <div className="assistant-message flex justify-start animate-slide-up group">
        <div className="assistant-message-body max-w-[92%] px-1 py-2 text-text-primary">
          <div className={`stream-response-container ${message.isStreaming ? 'is-streaming' : 'is-complete'}`}>
            <MarkdownRenderer content={message.content} isStreaming={message.isStreaming} />
          </div>
          <div className="mt-1 flex items-center gap-1">
            {!message.isStreaming && message.content && <CopyButton text={message.content} />}
            <span className="text-[11px] text-text-secondary/70">{message.timestamp}</span>
          </div>
        </div>
      </div>
    );
  }

  const lastTextBlockIdx = blocks.reduce(
    (acc, b, i) => (b.type === 'text' ? i : acc), -1,
  );

  return (
    <div className="assistant-message flex justify-start animate-slide-up group">
      <div className="assistant-message-body max-w-[92%] px-1 py-2 text-text-primary">
        <div className={`stream-response-container ${message.isStreaming ? 'is-streaming' : 'is-complete'}`}>
          {blocks.map((block, i) => {
            if (block.type === 'text') {
              const isLastTextAndStreaming = message.isStreaming && i === lastTextBlockIdx;
              return (
                <div key={`text-${i}`}>
                  <MarkdownRenderer
                    content={block.content}
                    isStreaming={isLastTextAndStreaming}
                  />
                </div>
              );
            }
            // tool block
            return (
              <div key={block.tool.id} className="my-1">
                <ToolBlockComponent tool={block.tool} />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex items-center gap-1">
          {!message.isStreaming && message.content && <CopyButton text={message.content} />}
          <span className="text-[11px] text-text-secondary/70">{message.timestamp}</span>
        </div>
      </div>
    </div>
  );
});
```

- [ ] **Step 7: Remove the standalone ToolActivity section**

Delete the tool activity feed block (lines 415-424):

```tsx
          {/* Tool activity feed */}
          {toolCalls.length > 0 && (
            <div className="mb-4 px-1">
              <ToolActivity
                tools={toolCalls}
                isStreaming={isStreaming}
                hasTextAfter={messages.length > 0 && messages[messages.length - 1]?.role === 'assistant'}
              />
            </div>
          )}
```

- [ ] **Step 8: Verify build**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 9: Manual test**

Run: `npm run dev` (or whatever the dev command is)
Send a message that triggers tool calls. Verify:
1. Thought text appears first
2. Tool call rows appear inline under the text that preceded them
3. More text after tool calls starts a new text section
4. Tool rows are collapsed by default
5. Clicking a tool row expands its input/output
6. Scrolling is smooth, no layout jumps
7. After streaming completes, the layout stays the same (no collapse to summary)
8. Reload the page and load the conversation from history — blocks render correctly

- [ ] **Step 10: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx
git commit -m "feat: interleave thought text and tool calls in response UI"
```

---

### Task 6: Clean up unused exports

**Files:**
- Modify: `src/renderer/components/ToolActivity.tsx`
- Modify: `src/renderer/components/ChatPanel.tsx`

- [ ] **Step 1: Remove unused ToolActivity imports and components**

In `ChatPanel.tsx`, if the old `ToolActivity` default import is still present, remove it. Only `ToolBlockComponent` (named import of `ToolBlock`) should remain.

In `ToolActivity.tsx`, the default export (`ToolActivity`), `ToolSummary`, and `LiveToolActivity` are no longer used by anything. Remove them:

- Delete the `ToolSummary` function (lines 303-337)
- Delete the `LiveToolActivity` function (lines 339-369)
- Delete the default export function `ToolActivity` (lines 371-375)

Keep: `ToolBlock` (exported), `ExpandableRow`, `ToolPayloadCopyButton`, and all the helper functions they depend on (`getDisplayName`, `getCleanLabel`, `tryParseJson`, `stringifyPreview`, `toSingleLinePreview`, `summarizeToolPayload`, `formatExpandedValue`, `formatUrlPreview`, `looksLikeBase64`, `sanitizeForDisplay`, `TOOL_DISPLAY_NAMES`, `PREVIEW_CHAR_LIMIT`, `OUTPUT_LINE_LIMIT`).

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ToolActivity.tsx src/renderer/components/ChatPanel.tsx
git commit -m "refactor: remove unused ToolSummary and LiveToolActivity"
```

---

### Task 7: Verify end-to-end and final cleanup

- [ ] **Step 1: Full manual test**

Run the app. Test these scenarios:
1. **Simple text response** (no tools) — renders normally, no regressions
2. **Response with tools** — text appears, tool rows appear inline below, more text below tools
3. **Multiple tool bursts** — text → tools → text → tools pattern renders correctly
4. **Tool errors** — error tool rows display inline with X icon
5. **Conversation reload** — close and reopen conversation, blocks persist from DB
6. **Old conversations** — conversations saved before this change still render (fallback to `content` string)
7. **Streaming UX** — no jarring layout shifts, smooth typewriter effect on text blocks, tool rows appear smoothly

- [ ] **Step 2: Commit any fixes**

If any issues found during testing, fix and commit.
