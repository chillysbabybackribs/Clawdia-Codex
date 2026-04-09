import { ipcMain, BrowserWindow } from 'electron';
import { IPC, IPC_EVENTS } from './ipc-channels';
import { getDb, insertRun, updateRunStatus } from './db';
import { loadSettings, patchSettings, getSetting } from './settingsStore';
import type { ElectronBrowserService } from './browser/ElectronBrowserService';
import { streamCodexChat } from './codex/codexChat';
import { getTierModel } from '../shared/models';
import type { Tier } from '../shared/models';
import { generateRunId, createRun, getRun, cancelRun, completeRun, removeRun } from './runRegistry';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function registerIpc(browserService: ElectronBrowserService): void {
  const win = () => BrowserWindow.getAllWindows()[0];

  // ── Chat ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.CHAT_SEND, async (_event, payload) => {
    const { text, attachments, conversationId: reqConvId, tier: reqTier } = payload;
    const tier = (reqTier || getSetting('tier')) as Tier;
    const model = getTierModel(tier);
    const db = getDb();

    // Client always provides conversationId (generated client-side for new chats)
    const conversationId = reqConvId || generateId();

    // Ensure conversation row exists (INSERT OR IGNORE for idempotency)
    db.prepare('INSERT OR IGNORE INTO conversations (id, title) VALUES (?, ?)').run(conversationId, 'New Chat');

    const userMsgId = generateId();
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, attachments_json) VALUES (?, ?, ?, ?, ?)')
      .run(userMsgId, conversationId, 'user', text, attachments ? JSON.stringify(attachments) : null);

    // Create a tracked run — returns immediately to the renderer
    const runId = generateRunId();
    const run = createRun(runId, conversationId);

    // Persist run to DB for resume across restarts
    insertRun({
      id: runId,
      conversationId,
      status: 'running',
      userText: text,
      model,
      tier,
      startedAt: new Date().toISOString(),
    });

    const w = win();
    const wc = w.webContents;

    // Emit explicit run-start lifecycle event
    if (!wc.isDestroyed()) {
      wc.send(IPC_EVENTS.CHAT_RUN_START, { runId, conversationId });
    }

    // Run Codex asynchronously — do NOT await here
    void (async () => {
      try {
        const result = await streamCodexChat({
          webContents: wc,
          userText: text,
          model,
          conversationId,
          signal: run.abort.signal,
        });

        // Check if we were cancelled during execution
        if (run.status === 'cancelled') {
          updateRunStatus(runId, 'cancelled');
          if (!wc.isDestroyed()) {
            wc.send(IPC_EVENTS.CHAT_RUN_END, { runId, conversationId, status: 'cancelled' });
          }
          removeRun(runId);
          return;
        }

        // Persist assistant message
        if (result.response) {
          const assistantMsgId = generateId();
          db.prepare('INSERT INTO messages (id, conversation_id, role, content, content_blocks_json) VALUES (?, ?, ?, ?, ?)')
            .run(assistantMsgId, conversationId, 'assistant', result.response, JSON.stringify(result.contentBlocks));
        }

        db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);
        const msgCount = (db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?').get(conversationId) as any)?.cnt;
        if (msgCount <= 2) {
          const title = text.length > 60 ? text.slice(0, 57) + '...' : text;
          db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId);
          if (!wc.isDestroyed()) {
            wc.send(IPC_EVENTS.CHAT_TITLE_UPDATED, { conversationId, title });
          }
        }

        if (result.error) {
          completeRun(runId, 'failed', result.error);
          updateRunStatus(runId, 'failed', result.error);
          if (!wc.isDestroyed()) {
            wc.send(IPC_EVENTS.CHAT_RUN_END, { runId, conversationId, status: 'failed', error: result.error });
          }
        } else {
          completeRun(runId, 'completed');
          updateRunStatus(runId, 'completed');
          if (!wc.isDestroyed()) {
            wc.send(IPC_EVENTS.CHAT_RUN_END, { runId, conversationId, status: 'completed' });
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        completeRun(runId, 'failed', message);
        updateRunStatus(runId, 'failed', message);
        if (!wc.isDestroyed()) {
          wc.send(IPC_EVENTS.CHAT_RUN_END, { runId, conversationId, status: 'failed', error: message });
        }
      } finally {
        // Deferred cleanup — give events time to propagate
        setTimeout(() => removeRun(runId), 5000);
      }
    })();

    // Return immediately — run is in flight
    return { ok: true, conversationId, runId };
  });

  ipcMain.handle(IPC.CHAT_STOP, async (_event, runId: string) => {
    if (!runId) return { ok: false, error: 'missing runId' };
    const run = getRun(runId);
    if (!run) return { ok: false, error: 'run not found' };
    if (run.status !== 'running') return { ok: false, error: `run already ${run.status}` };
    const cancelled = cancelRun(runId);
    if (cancelled) updateRunStatus(runId, 'cancelled');
    return { ok: cancelled };
  });

  ipcMain.handle(IPC.CHAT_RESUME_RETRY, async (_event, runId: string) => {
    if (!runId) return { ok: false, error: 'missing runId' };
    const { resumeSingleRunById } = await import('./resumeRuns');
    const result = await resumeSingleRunById(runId);
    return { ok: result };
  });

  ipcMain.handle(IPC.CHAT_RESUME_DISMISS, async (_event, runId: string) => {
    if (!runId) return { ok: false, error: 'missing runId' };
    updateRunStatus(runId, 'failed', 'Dismissed by user');
    return { ok: true };
  });

  ipcMain.handle(IPC.CHAT_CREATE, async () => {
    const id = generateId();
    getDb().prepare('INSERT INTO conversations (id, title) VALUES (?, ?)').run(id, 'New Chat');
    return { id, title: 'New Chat' };
  });

  ipcMain.handle(IPC.CHAT_LIST, async () => {
    return getDb().prepare('SELECT id, title, updated_at as updatedAt FROM conversations ORDER BY updated_at DESC').all();
  });

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

  ipcMain.handle(IPC.CHAT_DELETE, async (_event, id) => {
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
  });

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SETTINGS_GET, async (_event, key) => getSetting(key as any));
  ipcMain.handle(IPC.SETTINGS_SET, async (_event, key, value) => patchSettings({ [key]: value }));

  ipcMain.handle(IPC.TIER_GET, async () => getSetting('tier'));
  ipcMain.handle(IPC.TIER_SET, async (_event, tier) => patchSettings({ tier: tier as any }));

  // ── Browser ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.BROWSER_NAVIGATE, async (_event, url) => browserService.navigate(url));
  ipcMain.handle(IPC.BROWSER_BACK, async () => browserService.back());
  ipcMain.handle(IPC.BROWSER_FORWARD, async () => browserService.forward());
  ipcMain.handle(IPC.BROWSER_REFRESH, async () => browserService.refresh());
  ipcMain.handle(IPC.BROWSER_SET_BOUNDS, async (_event, bounds) => browserService.setBounds(bounds));
  ipcMain.handle(IPC.BROWSER_TAB_NEW, async (_event, url) => browserService.newTab(url));
  ipcMain.handle(IPC.BROWSER_TAB_LIST, async () => browserService.listTabs());
  ipcMain.handle(IPC.BROWSER_TAB_SWITCH, async (_event, id) => browserService.switchTab(id));
  ipcMain.handle(IPC.BROWSER_TAB_CLOSE, async (_event, id) => browserService.closeTab(id));
  ipcMain.handle(IPC.BROWSER_HISTORY_MATCH, async (_event, prefix) => browserService.matchHistory?.(prefix) ?? []);
  ipcMain.handle(IPC.BROWSER_HIDE, async () => browserService.hide());
  ipcMain.handle(IPC.BROWSER_SHOW, async () => browserService.show());

  // ── Window ────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => win()?.minimize());
  ipcMain.handle(IPC.WINDOW_MAXIMIZE, () => {
    const w = win();
    if (w?.isMaximized()) w.unmaximize(); else w?.maximize();
  });
  ipcMain.handle(IPC.WINDOW_CLOSE, () => win()?.close());
}
