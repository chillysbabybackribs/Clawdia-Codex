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
