import { spawn } from 'child_process';
import path from 'path';
import type { WebContents } from 'electron';
import { IPC_EVENTS } from '../ipc-channels';
import { getConversation, updateConversation } from '../db';
import type { ToolCall, ContentBlock, VerificationResult } from '../../shared/types';
import { captureFileSnapshot, diffFileSnapshots } from '../verification/fsVerify';

/** Path to the scripts directory containing the browser CLI wrapper.
 *  At runtime __dirname is dist/main/codex/ — three levels up to project root. */
const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', '..', 'scripts');

/** Path to the compiled MCP browser server script. */
const MCP_SERVER_PATH = path.resolve(__dirname, '..', 'mcp', 'browserMcpServer.js');

const sessions = new Map<string, string>();

export function clearCodexSessions(): void {
  sessions.clear();
}

function codexItemToolName(itemType: string): string {
  return `codex_${itemType}`;
}

function codexItemDetail(item: Record<string, unknown>): string {
  const candidates = [
    item.label, item.title, item.name, item.command,
    item.path, item.description, item.summary,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return String(item.type ?? 'activity');
}

function codexItemInput(item: Record<string, unknown>): Record<string, unknown> {
  const SKIP = new Set(['id', 'status', 'aggregated_output', 'exit_code', 'type']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (!SKIP.has(k)) out[k] = v;
  }
  return out;
}

function codexItemOutput(item: Record<string, unknown>): string {
  const candidates = [item.output, item.result, item.summary, item.text, item.error];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  try { return JSON.stringify(item, null, 2); } catch { return String(item.type ?? 'activity'); }
}

function codexItemText(item: Record<string, unknown>): string | null {
  const candidates = [item.text, item.summary, item.markdown];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c;
  }
  return null;
}

function detectMirrorUrl(item: Record<string, unknown>): string | null {
  const itemType = typeof item.type === 'string' ? item.type : '';
  if (itemType === 'web_search') {
    const query = typeof item.query === 'string' ? item.query
      : typeof item.input === 'string' ? item.input : null;
    if (query) return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }
  const command = typeof item.command === 'string' ? item.command : '';
  if (command.includes('browser navigate')) {
    const match = command.match(/browser\s+navigate\s+(\S+)/);
    if (match) return match[1];
  }
  if (command.includes('curl')) {
    const match = command.match(/curl\s+(?:-[^\s]+\s+)*["']?(https?:\/\/[^\s"']+)/);
    if (match) return match[1];
  }
  return null;
}

export interface StreamCodexChatOpts {
  webContents: WebContents;
  userText: string;
  model?: string;
  conversationId: string;
  signal: AbortSignal;
}

const CODEX_SYSTEM_PROMPT = `You are Codex, an autonomous coding agent. You have one tool: the shell (bash). Use it for all tasks. Be concise and action-oriented.

## In-App Browser

You have access to a Chromium browser via the \`browser\` command:

  browser navigate <url>      browser page-text           browser click '<selector>'
  browser type '<sel>' <text>  browser query '<selector>'  browser screenshot [path]
  browser tabs                 browser back/forward/refresh

## Browser MCP Tools

For complex browser tasks, use the MCP browser tools:
  browser_navigate  — go to URL or "back"/"forward"
  browser_snapshot  — get page accessibility tree with ref IDs
  browser_click     — click element by ref ID
  browser_type      — type into element by ref ID
  browser_scroll    — scroll page or to ref
  browser_wait      — wait for element/text/network idle
  browser_screenshot — capture viewport
  browser_get_text  — extract readable page content

Use \`browser page-text\` first to read page content. Use \`browser_snapshot\` before interacting with elements.`;

export function streamCodexChat(opts: StreamCodexChatOpts): Promise<{ response: string; contentBlocks: ContentBlock[]; error?: string }> {
  const { webContents, userText, model, conversationId, signal } = opts;
  const codexBin = process.env.CODEX_BIN || 'codex';

  const inMemorySessionId = sessions.get(conversationId);
  const persistedSessionId = getConversation(conversationId)?.codex_thread_id ?? null;
  const sessionId = inMemorySessionId ?? persistedSessionId ?? null;
  if (sessionId) sessions.set(conversationId, sessionId);

  const modelArgs = model ? ['--model', model] : [];
  const mcpArgs = [
    '-c', `mcp_servers.clawdia_browser.command="node"`,
    '-c', `mcp_servers.clawdia_browser.args=["${MCP_SERVER_PATH.replace(/\\/g, '\\\\')}"]`,
  ];
  const args = sessionId
    ? [...modelArgs, ...mcpArgs, 'exec', '--dangerously-bypass-approvals-and-sandbox', '--json', 'resume', sessionId, '-']
    : [...modelArgs, ...mcpArgs, 'exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-'];

  return new Promise((resolve, reject) => {
    const child = spawn(codexBin, args, {
      env: {
        ...process.env,
        PATH: `${SCRIPTS_DIR}:${process.env.PATH ?? ''}`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (signal.aborted) {
      child.kill('SIGTERM');
    } else {
      signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
    }

    const prompt = sessionId
      ? userText
      : `${CODEX_SYSTEM_PROMPT}\n\n---\n\n${userText}`;
    child.stdin.write(prompt);
    child.stdin.end();

    let buffer = '';
    let finalText = '';
    let resolvedSessionId: string | null = sessionId;
    let stderr = '';
    const pendingActivities = new Map<string, { name: string; detail: string; input: string; startedAt: number }>();
    const streamedTextByItemId = new Map<string, string>();
    const contentBlocks: ContentBlock[] = [];

    const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
    let hangTimeout = setTimeout(() => {
      child.kill();
      reject(new Error('Codex timed out (no output for 10 minutes).'));
    }, INACTIVITY_TIMEOUT_MS);

    function resetHangTimeout() {
      clearTimeout(hangTimeout);
      hangTimeout = setTimeout(() => {
        child.kill();
        reject(new Error('Codex timed out (no output for 10 minutes).'));
      }, INACTIVITY_TIMEOUT_MS);
    }

    function emitToolActivity(tool: ToolCall) {
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, { ...tool, conversationId });
      }
    }

    function emitVerification(result: VerificationResult) {
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.CHAT_VERIFICATION, { ...result, conversationId });
      }
      contentBlocks.push({ type: 'verification', result });
    }

    /** Extract file path from a tool item's input fields. */
    function extractFilePath(itemRecord: Record<string, unknown>): string | null {
      for (const key of ['path', 'file_path', 'file', 'target']) {
        const val = itemRecord[key];
        if (typeof val === 'string' && val.startsWith('/')) return val;
      }
      // Check nested arguments
      const args = itemRecord.arguments ?? itemRecord.args;
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        const a = args as Record<string, unknown>;
        for (const key of ['path', 'file_path', 'file', 'target']) {
          const val = a[key];
          if (typeof val === 'string' && val.startsWith('/')) return val;
        }
      }
      return null;
    }

    /** Determine if this tool is a filesystem-modifying tool. */
    function isFsWriteTool(itemType: string, itemRecord: Record<string, unknown>): boolean {
      const writeTypes = ['file_write', 'file_edit', 'command_execution', 'function_call'];
      if (writeTypes.includes(itemType)) return true;
      const cmd = typeof itemRecord.command === 'string' ? itemRecord.command : '';
      return /\b(write|create|mkdir|touch|mv|cp|rm|echo\s+.*>|cat\s+.*>|sed\s+-i|tee)\b/.test(cmd);
    }

    // Pre-capture filesystem snapshots for write tools
    const fsPreSnapshots = new Map<string, ReturnType<typeof captureFileSnapshot>>();

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.stdout.on('data', (chunk: Buffer) => {
      resetHangTimeout();
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let msg: Record<string, unknown>;
        try { msg = JSON.parse(trimmed) as Record<string, unknown>; } catch { continue; }

        // Thread started — persist session ID
        if (msg.type === 'thread.started' && typeof msg.thread_id === 'string') {
          resolvedSessionId = msg.thread_id;
          sessions.set(conversationId, resolvedSessionId);
          updateConversation(conversationId, { codex_thread_id: resolvedSessionId });
          continue;
        }

        const item = msg.item;
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const itemRecord = item as Record<string, unknown>;
        const itemId = typeof itemRecord.id === 'string'
          ? itemRecord.id
          : `codex-item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const itemType = typeof itemRecord.type === 'string' ? itemRecord.type : 'activity';
        const isTextualItem = itemType === 'agent_message' || itemType === 'reasoning';

        // Stream text deltas from agent_message / reasoning items
        if ((msg.type === 'item.updated' || msg.type === 'item.completed') && isTextualItem) {
          const nextText = codexItemText(itemRecord);
          if (nextText) {
            const priorText = streamedTextByItemId.get(itemId) ?? '';
            const delta = nextText.startsWith(priorText) ? nextText.slice(priorText.length) : nextText;
            if (delta) {
              if (!webContents.isDestroyed()) {
                webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId });
              }
              // Track in content blocks
              const lastBlock = contentBlocks[contentBlocks.length - 1];
              if (lastBlock?.type === 'text') {
                lastBlock.content += delta;
              } else {
                contentBlocks.push({ type: 'text', content: delta });
              }
            }
            streamedTextByItemId.set(itemId, nextText);
          }
        }

        // Tool started
        if (msg.type === 'item.started' && !isTextualItem) {
          const detail = codexItemDetail(itemRecord);
          const input = JSON.stringify(codexItemInput(itemRecord), null, 2);
          pendingActivities.set(itemId, { name: codexItemToolName(itemType), detail, input, startedAt: Date.now() });
          emitToolActivity({
            id: itemId,
            name: codexItemToolName(itemType),
            status: 'running',
            detail,
            input,
          });
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

          // Pre-capture filesystem state for write tools
          if (isFsWriteTool(itemType, itemRecord)) {
            const fp = extractFilePath(itemRecord);
            if (fp) fsPreSnapshots.set(itemId, captureFileSnapshot(fp));
          }

          // Check for browser mirror
          const mirrorUrl = detectMirrorUrl(itemRecord);
          if (mirrorUrl && !webContents.isDestroyed()) {
            webContents.send(IPC_EVENTS.BROWSER_MIRROR_NAVIGATE, { url: mirrorUrl, conversationId });
          }

          continue;
        }

        // Tool completed
        if (msg.type === 'item.completed') {
          if (itemType === 'agent_message' && typeof itemRecord.text === 'string') {
            const text = itemRecord.text.trim();
            if (!text) continue;
            finalText = finalText ? `${finalText}\n\n${text}` : text;
            const alreadyStreamed = streamedTextByItemId.get(itemId) ?? '';
            const remainder = text.startsWith(alreadyStreamed) ? text.slice(alreadyStreamed.length) : text;
            if (remainder && !webContents.isDestroyed()) {
              webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, { delta: remainder, conversationId });
            }
            streamedTextByItemId.set(itemId, text);
            // Track in content blocks
            const lastBlock = contentBlocks[contentBlocks.length - 1];
            if (lastBlock?.type === 'text') {
              lastBlock.content += remainder;
            } else if (remainder) {
              contentBlocks.push({ type: 'text', content: remainder });
            }
            continue;
          }
          if (itemType === 'reasoning') continue;

          const pending = pendingActivities.get(itemId);
          pendingActivities.delete(itemId);
          emitToolActivity({
            id: itemId,
            name: pending?.name ?? codexItemToolName(itemType),
            status: 'success',
            detail: pending?.detail ?? codexItemDetail(itemRecord),
            input: pending?.input ?? JSON.stringify(codexItemInput(itemRecord), null, 2),
            output: codexItemOutput(itemRecord),
            durationMs: pending ? Date.now() - pending.startedAt : undefined,
          });
          const toolBlockIdx = contentBlocks.findIndex(
            (b) => b.type === 'tool' && b.tool.id === itemId,
          );
          if (toolBlockIdx >= 0) {
            (contentBlocks[toolBlockIdx] as { type: 'tool'; tool: ToolCall }).tool = {
              id: itemId,
              name: pending?.name ?? codexItemToolName(itemType),
              status: 'success',
              detail: pending?.detail ?? codexItemDetail(itemRecord),
              input: pending?.input ?? JSON.stringify(codexItemInput(itemRecord), null, 2),
              output: codexItemOutput(itemRecord),
              durationMs: pending ? Date.now() - pending.startedAt : undefined,
            };
          }

          // Post-action filesystem verification
          const preSnap = fsPreSnapshots.get(itemId);
          if (preSnap) {
            fsPreSnapshots.delete(itemId);
            const postSnap = captureFileSnapshot(preSnap.path);
            const verifications = diffFileSnapshots(preSnap, postSnap);
            for (const v of verifications) emitVerification(v);
          }

          // Tool completed that had a mirror URL — emit BROWSER_MIRROR_DONE
          if (!webContents.isDestroyed()) {
            webContents.send(IPC_EVENTS.BROWSER_MIRROR_DONE, { conversationId });
          }

          continue;
        }

        // Tool failed
        if (msg.type === 'item.failed') {
          const pending = pendingActivities.get(itemId);
          pendingActivities.delete(itemId);
          emitToolActivity({
            id: itemId,
            name: pending?.name ?? codexItemToolName(itemType),
            status: 'error',
            detail: pending?.detail ?? codexItemDetail(itemRecord),
            input: pending?.input ?? JSON.stringify(codexItemInput(itemRecord), null, 2),
            output: codexItemOutput(itemRecord),
            durationMs: pending ? Date.now() - pending.startedAt : undefined,
          });
          const toolBlockIdx = contentBlocks.findIndex(
            (b) => b.type === 'tool' && b.tool.id === itemId,
          );
          if (toolBlockIdx >= 0) {
            (contentBlocks[toolBlockIdx] as { type: 'tool'; tool: ToolCall }).tool = {
              id: itemId,
              name: pending?.name ?? codexItemToolName(itemType),
              status: 'error',
              detail: pending?.detail ?? codexItemDetail(itemRecord),
              input: pending?.input ?? JSON.stringify(codexItemInput(itemRecord), null, 2),
              output: codexItemOutput(itemRecord),
              durationMs: pending ? Date.now() - pending.startedAt : undefined,
            };
          }
        }
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(hangTimeout);
      reject(new Error(`Failed to spawn codex: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(hangTimeout);
      // Parse any trailing JSON in buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim()) as Record<string, unknown>;
          if (msg.type === 'thread.started' && typeof msg.thread_id === 'string') {
            resolvedSessionId = msg.thread_id;
          }
        } catch { /* ignore trailing partial JSON */ }
      }

      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.CHAT_STREAM_END, {
          ok: code === 0,
          conversationId,
          ...(code !== 0 ? { error: `Codex exited with code ${code ?? 'null'}. ${stderr.slice(0, 500)}` } : {}),
        });
      }

      if (code !== 0) {
        resolve({ response: finalText, contentBlocks, error: `Codex exited with code ${code}. ${stderr.slice(0, 500)}` });
        return;
      }

      if (resolvedSessionId) {
        sessions.set(conversationId, resolvedSessionId);
        updateConversation(conversationId, { codex_thread_id: resolvedSessionId });
      }

      resolve({ response: finalText, contentBlocks });
    });
  });
}
