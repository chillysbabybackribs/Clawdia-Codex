import { ipcMain, BrowserWindow } from 'electron';
import { IPC, IPC_EVENTS } from './ipc-channels';
import { getDb } from './db';
import { loadSettings, patchSettings, getSetting } from './settingsStore';
import type { ElectronBrowserService } from './browser/ElectronBrowserService';

// In-memory session message history per conversation
const sessionMessages = new Map<string, any[]>();
const activeAbortControllers = new Map<string, AbortController>();

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function registerIpc(browserService: ElectronBrowserService): void {
  const win = () => BrowserWindow.getAllWindows()[0];

  // ── Chat ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.CHAT_SEND, async (_event, payload) => {
    const { text, conversationId: reqConvId } = payload;
    const db = getDb();
    let conversationId = reqConvId;
    if (!conversationId) {
      conversationId = generateId();
      db.prepare('INSERT INTO conversations (id, title) VALUES (?, ?)').run(conversationId, 'New Chat');
    }
    const userMsgId = generateId();
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, attachments_json) VALUES (?, ?, ?, ?, ?)')
      .run(userMsgId, conversationId, 'user', text, null);
    // TODO: Wire up streamCodexChat in Task 7
    const w = win();
    if (w && !w.webContents.isDestroyed()) {
      w.webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, { delta: '[Codex not yet connected]', conversationId });
      w.webContents.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId });
    }
    return { ok: true, conversationId };
  });

  ipcMain.handle(IPC.CHAT_STOP, async (_event, conversationId) => {
    const ctrl = activeAbortControllers.get(conversationId);
    if (ctrl) ctrl.abort();
  });

  ipcMain.handle(IPC.CHAT_NEW, async () => {
    const id = generateId();
    getDb().prepare('INSERT INTO conversations (id, title) VALUES (?, ?)').run(id, 'New Chat');
    return { id, title: 'New Chat' };
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
      'SELECT id, role, content, created_at as timestamp, attachments_json FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(id) as any[];
    return messages.map(m => ({
      ...m,
      attachments: m.attachments_json ? JSON.parse(m.attachments_json) : undefined,
      attachments_json: undefined,
    }));
  });

  ipcMain.handle(IPC.CHAT_DELETE, async (_event, id) => {
    getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
    sessionMessages.delete(id);
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
