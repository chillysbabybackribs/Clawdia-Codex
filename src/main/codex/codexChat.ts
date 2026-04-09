import { spawn } from 'child_process';
import * as http from 'http';
import path from 'path';
import type { WebContents } from 'electron';
import { IPC_EVENTS } from '../ipc-channels';
import { getConversation, updateConversation } from '../db';
import type { ToolCall, ContentBlock, VerificationResult } from '../../shared/types';
import { captureFileSnapshot, diffFileSnapshots } from '../verification/fsVerify';
import type { BrowserSnapshot } from '../verification/browserVerify';
import { verifyUrlChanged, verifyTitleChanged } from '../verification/browserVerify';

/** Path to the scripts directory containing the browser CLI wrapper.
 *  At runtime __dirname is dist/main/codex/ — three levels up to project root. */
const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', '..', 'scripts');

/** Path to the compiled MCP browser server script. */
const MCP_SERVER_PATH = path.resolve(__dirname, '..', 'mcp', 'browserMcpServer.js');

/** Path to the compiled MCP OS control server script. */
const OS_MCP_SERVER_PATH = path.resolve(__dirname, '..', 'mcp', 'osMcpServer.js');

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

/** Quick bridge call to get active tab state for browser verification. */
function captureBrowserStateFast(): Promise<BrowserSnapshot> {
  const port = Number(process.env.BROWSER_BRIDGE_PORT) || 3111;
  return new Promise((resolve) => {
    const fallback: BrowserSnapshot = { url: '', title: '', timestampMs: Date.now() };
    const req = http.get(`http://127.0.0.1:${port}/tabs`, { timeout: 2000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const active = body?.data?.tabs?.find((t: any) => t.active);
          resolve({
            url: active?.url || '',
            title: active?.title || '',
            timestampMs: Date.now(),
          });
        } catch { resolve(fallback); }
      });
    });
    req.on('error', () => resolve(fallback));
    req.on('timeout', () => { req.destroy(); resolve(fallback); });
  });
}

/** Detect if a tool is a browser navigation/interaction tool. */
function isBrowserTool(itemType: string, itemRecord: Record<string, unknown>): boolean {
  if (['browser_navigate', 'browser_click', 'browser_type'].includes(itemType)) return true;
  const name = typeof itemRecord.name === 'string' ? itemRecord.name : '';
  return /^browser_(navigate|click|type)$/.test(name);
}

export interface StreamCodexChatOpts {
  webContents: WebContents;
  userText: string;
  model?: string;
  conversationId: string;
  signal: AbortSignal;
}

const CODEX_SYSTEM_PROMPT = `You are Codex, an autonomous agent with full OS control. You have the shell (bash), a browser, and OS-level tools. Be concise and action-oriented.

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

Use \`browser page-text\` first to read page content. Use \`browser_snapshot\` before interacting with elements.

## OS Control MCP Tools

You can control the entire desktop. Call os_env_info first if unsure what will work.

### Perception
  os_screenshot        — capture desktop or a specific window (returns image)
  os_get_active_window — get focused window title, geometry, window ID
  os_window_list       — list all open windows with IDs and titles
  os_screen_info       — screen resolution and display info
  os_process_list      — list running processes (filterable)
  os_env_info          — detect desktop environment, session type, available tools

### Input
  os_mouse_move        — move cursor to absolute (x, y)
  os_mouse_click       — click at position. button: 1=left, 2=middle, 3=right. supports double-click
  os_mouse_drag        — click-and-drag from one position to another
  os_key_type          — type text into the focused window
  os_key_press         — press key combos: "Return", "ctrl+s", "alt+Tab", "super"
  os_xdotool           — raw xdotool for advanced input (search windows, get mouse location, etc.)

### Window Management
  os_window_focus      — focus/raise a window by ID or title
  os_window_resize     — move/resize a window
  os_window_state      — minimize, maximize, fullscreen, restore, close, always-on-top
  os_desktop_switch    — switch virtual desktops, or move a window to another desktop

### System
  os_clipboard_read    — read system clipboard
  os_clipboard_write   — write to system clipboard
  os_app_launch        — launch any app, open file, or URL
  os_notify            — send desktop notification

### D-Bus (Advanced — control any app)
  os_dbus_list         — list D-Bus services (discover controllable apps)
  os_dbus_introspect   — inspect a service's interfaces/methods/properties
  os_dbus_call         — call any D-Bus method (the universal Linux app control API)

### Media & Audio (App-agnostic)
  os_media_control     — play/pause/next/prev ANY media player via MPRIS D-Bus. Use "list" to see players.
  os_audio_control     — system volume, mute/unmute via PipeWire

### IMPORTANT: Recipes (follow these exactly)

**Launch an app and play media (e.g. "open spotify and play music"):**
1. os_app_launch command="spotify" wait_ms=5000  ← launches AND waits for D-Bus registration
2. os_media_control action="play"                ← start playback
Done. Two steps. Do NOT screenshot, list windows, check env, or fall back to the browser.

**Launch any app:**
os_app_launch command="firefox"  ← one step, app persists forever

**Control media that is already playing:**
os_media_control action="play_pause"  ← works with ANY player (Spotify, Firefox, VLC, Chrome)
os_media_control action="next"
os_audio_control action="set_volume" volume=0.7

**Control an app via D-Bus (no GUI clicking):**
1. os_dbus_list filter="appname"
2. os_dbus_introspect dest="org.example.App" path="/"
3. os_dbus_call dest="..." path="..." method="..."

**Interact with a GUI visually (last resort):**
1. os_screenshot → os_window_focus → os_mouse_click / os_key_type → os_screenshot

### Rules
- Apps launched with os_app_launch persist permanently. They are NOT closed when the task ends.
- After os_app_launch, the app is ready. The tool waits for startup and checks D-Bus registration before returning.
- If os_media_control says "no player found", the app may not be running. Launch it first.
- Do NOT fall back to the browser, screenshots, or GUI clicking when a direct tool exists.
- Do NOT call os_env_info, os_screenshot, or os_window_list before launching an app. Just launch it.`;

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
    '-c', `mcp_servers.clawdia_os.command="node"`,
    '-c', `mcp_servers.clawdia_os.args=["${OS_MCP_SERVER_PATH.replace(/\\/g, '\\\\')}"]`,
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
      detached: true, // Own process group so we can kill the entire tree on abort
    });

    /** Kill the entire process group (Codex + MCP servers + shell children). */
    const killTree = () => {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already dead */ }
      } else {
        child.kill('SIGTERM');
      }
    };

    if (signal.aborted) {
      killTree();
    } else {
      signal.addEventListener('abort', () => killTree(), { once: true });
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

    // Pre-capture snapshots for verification
    const fsPreSnapshots = new Map<string, ReturnType<typeof captureFileSnapshot>>();
    const browserPreSnapshots = new Map<string, BrowserSnapshot>();

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

          // Pre-capture browser state for browser tools
          if (isBrowserTool(itemType, itemRecord)) {
            captureBrowserStateFast().then(snap => browserPreSnapshots.set(itemId, snap));
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

          // Post-action browser verification
          const browserPre = browserPreSnapshots.get(itemId);
          if (browserPre) {
            browserPreSnapshots.delete(itemId);
            captureBrowserStateFast().then(browserPost => {
              const urlResult = verifyUrlChanged(browserPre, browserPost);
              if (urlResult.changed) emitVerification(urlResult);
              const titleResult = verifyTitleChanged(browserPre, browserPost);
              if (titleResult.changed) emitVerification(titleResult);
            });
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
          fsPreSnapshots.delete(itemId); // Clean up orphaned pre-snapshots
          browserPreSnapshots.delete(itemId);
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
