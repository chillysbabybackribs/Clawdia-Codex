import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We'll test the DB helpers directly, but first we need to set up a temp DB.
// The production code uses CLAWDIA_DB_PATH_OVERRIDE, so we leverage that.

let testDbPath: string;

function ensureConversation(db: any, id: string) {
  db.prepare('INSERT OR IGNORE INTO conversations (id, title) VALUES (?, ?)').run(id, 'Test');
}

beforeEach(() => {
  testDbPath = path.join(os.tmpdir(), `clawdia-test-${Date.now()}.sqlite`);
  process.env.CLAWDIA_DB_PATH_OVERRIDE = testDbPath;
  // Force re-init by clearing the module cache — or we call initDb directly
});

afterEach(() => {
  delete process.env.CLAWDIA_DB_PATH_OVERRIDE;
  try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
});

describe('runs table DB helpers', () => {
  it('insertRun creates a row and getInterruptedRuns retrieves it', async () => {
    const { initDb, getDb } = await import('../src/main/db');
    const { insertRun, getInterruptedRuns, updateRunStatus } = await import('../src/main/db');
    initDb();

    ensureConversation(getDb(), 'conv-1');

    insertRun({
      id: 'run-test-1',
      conversationId: 'conv-1',
      status: 'running',
      userText: 'hello world',
      model: 'o3',
      tier: 'think',
      startedAt: new Date().toISOString(),
    });

    // Mark as interrupted
    updateRunStatus('run-test-1', 'interrupted');

    const interrupted = getInterruptedRuns();
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].id).toBe('run-test-1');
    expect(interrupted[0].conversation_id).toBe('conv-1');
    expect(interrupted[0].user_text).toBe('hello world');
    expect(interrupted[0].status).toBe('interrupted');
  });

  it('updateRunStatus sets status and ended_at', async () => {
    const { initDb, getDb } = await import('../src/main/db');
    const { insertRun, updateRunStatus } = await import('../src/main/db');
    initDb();

    ensureConversation(getDb(), 'conv-2');

    insertRun({
      id: 'run-test-2',
      conversationId: 'conv-2',
      status: 'running',
      userText: 'test',
      startedAt: new Date().toISOString(),
    });

    updateRunStatus('run-test-2', 'completed');

    const row = getDb().prepare('SELECT * FROM runs WHERE id = ?').get('run-test-2') as any;
    expect(row.status).toBe('completed');
    expect(row.ended_at).toBeTruthy();
  });

  it('updateRunStatus sets error when provided', async () => {
    const { initDb, getDb } = await import('../src/main/db');
    const { insertRun, updateRunStatus } = await import('../src/main/db');
    initDb();

    ensureConversation(getDb(), 'conv-3');

    insertRun({
      id: 'run-test-3',
      conversationId: 'conv-3',
      status: 'running',
      userText: 'test',
      startedAt: new Date().toISOString(),
    });

    updateRunStatus('run-test-3', 'failed', 'something broke');

    const row = getDb().prepare('SELECT * FROM runs WHERE id = ?').get('run-test-3') as any;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('something broke');
  });

  it('incrementResumeAttempts increments the counter', async () => {
    const { initDb, getDb } = await import('../src/main/db');
    const { insertRun, incrementResumeAttempts } = await import('../src/main/db');
    initDb();

    ensureConversation(getDb(), 'conv-4');

    insertRun({
      id: 'run-test-4',
      conversationId: 'conv-4',
      status: 'interrupted',
      userText: 'test',
      startedAt: new Date().toISOString(),
    });

    incrementResumeAttempts('run-test-4');
    incrementResumeAttempts('run-test-4');

    const row = getDb().prepare('SELECT resume_attempts FROM runs WHERE id = ?').get('run-test-4') as any;
    expect(row.resume_attempts).toBe(2);
  });

  it('getInterruptedRuns returns both running and interrupted rows', async () => {
    const { initDb, getDb } = await import('../src/main/db');
    const { insertRun, getInterruptedRuns } = await import('../src/main/db');
    initDb();

    ensureConversation(getDb(), 'c1');
    ensureConversation(getDb(), 'c2');
    ensureConversation(getDb(), 'c3');

    insertRun({ id: 'r1', conversationId: 'c1', status: 'running', userText: 'a', startedAt: new Date().toISOString() });
    insertRun({ id: 'r2', conversationId: 'c2', status: 'interrupted', userText: 'b', startedAt: new Date().toISOString() });
    insertRun({ id: 'r3', conversationId: 'c3', status: 'completed', userText: 'c', startedAt: new Date().toISOString() });

    const rows = getInterruptedRuns();
    expect(rows).toHaveLength(2);
    const ids = rows.map(r => r.id);
    expect(ids).toContain('r1');
    expect(ids).toContain('r2');
  });
});
