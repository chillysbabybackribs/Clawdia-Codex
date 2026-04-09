import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  attachments_json?: string;
  content_blocks_json?: string;
}

let db: Database.Database | null = null;

function resolveDbPath(): string {
  if (process.env.CLAWDIA_DB_PATH_OVERRIDE) {
    return process.env.CLAWDIA_DB_PATH_OVERRIDE;
  }
  const configDir = path.join(os.homedir(), '.config', 'clawdia');
  fs.mkdirSync(configDir, { recursive: true });
  return path.join(configDir, 'data.sqlite');
}

export function getDb(): Database.Database {
  if (!db) {
    const ok = initDb();
    if (!ok || !db) throw new Error('Database not initialized');
  }
  return db;
}

export function initDb(): boolean {
  try {
    if (db) {
      try { db.close(); } catch { /* best effort */ }
      db = null;
    }
    db = new Database(resolveDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id                TEXT PRIMARY KEY,
        title             TEXT NOT NULL DEFAULT 'New Chat',
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        codex_thread_id   TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content         TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        attachments_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    `);

    // Migration: ensure codex_thread_id column exists (handles pre-existing databases)
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN codex_thread_id TEXT`);
    } catch {
      // Column already exists — ignore
    }

    // Migration: ensure content_blocks_json column exists
    try {
      db.exec(`ALTER TABLE messages ADD COLUMN content_blocks_json TEXT`);
    } catch {
      // Column already exists — ignore
    }

    // Browser tab persistence
    db.exec(`
      CREATE TABLE IF NOT EXISTS browser_tabs (
        id         TEXT PRIMARY KEY,
        url        TEXT NOT NULL DEFAULT 'about:blank',
        title      TEXT NOT NULL DEFAULT 'New Tab',
        position   INTEGER NOT NULL DEFAULT 0,
        active     INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Run persistence for auto-resume
    // Migration: drop legacy runs table (from Clawdia8) that has incompatible schema.
    // Must disable FK checks because legacy tables (run_events, run_approvals, etc.) reference runs(id).
    const runsInfo = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
    if (runsInfo.length > 0 && !runsInfo.some(col => col.name === 'user_text')) {
      db.pragma('foreign_keys = OFF');
      db.exec('DROP TABLE IF EXISTS runs');
      db.pragma('foreign_keys = ON');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id                TEXT PRIMARY KEY,
        conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        status            TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
        user_text         TEXT NOT NULL,
        model             TEXT,
        tier              TEXT,
        started_at        TEXT NOT NULL,
        ended_at          TEXT,
        error             TEXT,
        resume_attempts   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    `);

    return true;
  } catch (err) {
    console.error('[db] init failed:', err);
    return false;
  }
}

export function getConversation(id: string): ConversationRow & { codex_thread_id?: string } | undefined {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
}

export function updateConversation(id: string, patch: { codex_thread_id?: string }): void {
  if (patch.codex_thread_id !== undefined) {
    getDb().prepare('UPDATE conversations SET codex_thread_id = ? WHERE id = ?')
      .run(patch.codex_thread_id, id);
  }
}

// ── Browser tab persistence ─────────────────────────────────────────────────

export interface BrowserTabRow {
  id: string;
  url: string;
  title: string;
  position: number;
  active: number; // 0 or 1
}

export function getSavedBrowserTabs(): BrowserTabRow[] {
  return getDb().prepare('SELECT * FROM browser_tabs ORDER BY position ASC').all() as BrowserTabRow[];
}

export function saveBrowserTabs(tabs: Array<{ id: string; url: string; title: string; active: boolean }>, activeTabId: string | null): void {
  const d = getDb();
  const del = d.prepare('DELETE FROM browser_tabs');
  const ins = d.prepare('INSERT INTO browser_tabs (id, url, title, position, active) VALUES (?, ?, ?, ?, ?)');
  const txn = d.transaction(() => {
    del.run();
    tabs.forEach((tab, i) => {
      ins.run(tab.id, tab.url, tab.title, i, tab.id === activeTabId ? 1 : 0);
    });
  });
  txn();
}

// ── Run persistence ─────────────────────────────────────────────────────────

export interface RunRow {
  id: string;
  conversation_id: string;
  status: string;
  user_text: string;
  model: string | null;
  tier: string | null;
  started_at: string;
  ended_at: string | null;
  error: string | null;
  resume_attempts: number;
}

export function insertRun(run: {
  id: string;
  conversationId: string;
  status: string;
  userText: string;
  model?: string;
  tier?: string;
  startedAt: string;
}): void {
  getDb().prepare(
    'INSERT INTO runs (id, conversation_id, status, user_text, model, tier, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(run.id, run.conversationId, run.status, run.userText, run.model ?? null, run.tier ?? null, run.startedAt);
}

export function updateRunStatus(runId: string, status: string, error?: string): void {
  const ended = status !== 'running' && status !== 'interrupted' ? new Date().toISOString() : null;
  getDb().prepare(
    'UPDATE runs SET status = ?, ended_at = COALESCE(?, ended_at), error = COALESCE(?, error) WHERE id = ?'
  ).run(status, ended, error ?? null, runId);
}

export function getInterruptedRuns(): RunRow[] {
  return getDb().prepare(
    "SELECT * FROM runs WHERE status IN ('running', 'interrupted')"
  ).all() as RunRow[];
}

export function incrementResumeAttempts(runId: string): void {
  getDb().prepare('UPDATE runs SET resume_attempts = resume_attempts + 1 WHERE id = ?').run(runId);
}
