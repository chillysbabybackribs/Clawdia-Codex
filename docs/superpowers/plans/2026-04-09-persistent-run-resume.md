# Persistent Run Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically resume all interrupted Codex runs on app startup so active tasks persist across restarts and crashes.

**Architecture:** Add a `runs` table to SQLite that mirrors the in-memory run registry. On shutdown, mark active runs as `interrupted`. On startup, query interrupted runs and re-spawn Codex using the existing thread resume mechanism. Failed resumes show a notification with retry/dismiss options.

**Tech Stack:** Electron, SQLite (better-sqlite3), TypeScript, Vitest

---

### Task 1: Add `interrupted` to RunStatus and update shared constants

**Files:**
- Modify: `src/shared/types.ts:47-48`
- Modify: `tests/helpers/contracts.ts:9-31`
- Modify: `tests/runLifecycle.test.ts:124-130`

- [ ] **Step 1: Write the failing test**

Update the existing length assertion in `tests/runLifecycle.test.ts` and add a new test:

In the 'anti-staleness: shared constants' describe block, change the existing length assertion from `4` to `5`:

```typescript
      expect(RUN_STATUSES).toHaveLength(5);
```

Then add a new test after it:

```typescript
    it('RUN_STATUSES includes interrupted', () => {
      expect(RUN_STATUSES).toContain('interrupted');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runLifecycle.test.ts --reporter=verbose`
Expected: FAIL — `RUN_STATUSES` does not contain `'interrupted'` and has length 4

- [ ] **Step 3: Update `src/shared/types.ts` to add `interrupted`**

Change line 47:

```typescript
export const RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled', 'interrupted'] as const;
```

- [ ] **Step 4: Add new IPC event and command constants to `src/main/ipc-channels.ts`**

Add to the `IPC` object (after `CHAT_DELETE`):

```typescript
  CHAT_RESUME_RETRY: 'chat:resume:retry',
  CHAT_RESUME_DISMISS: 'chat:resume:dismiss',
```

Add to the `IPC_EVENTS` object (after `CHAT_VERIFICATION`):

```typescript
  CHAT_RESUME_FAILED: 'chat:resume:failed',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/runLifecycle.test.ts --reporter=verbose`
Expected: PASS — all tests including the new one

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/ipc-channels.ts tests/runLifecycle.test.ts
git commit -m "feat: add 'interrupted' run status and resume IPC channels"
```

---

### Task 2: Add `runs` table and DB helpers

**Files:**
- Modify: `src/main/db.ts:96` (add table creation after browser_tabs)
- Create: `tests/runDb.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/runDb.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We'll test the DB helpers directly, but first we need to set up a temp DB.
// The production code uses CLAWDIA_DB_PATH_OVERRIDE, so we leverage that.

let testDbPath: string;

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
    // Dynamic import to get fresh module state
    const { initDb, getDb } = await import('../src/main/db');
    const { insertRun, getInterruptedRuns, updateRunStatus } = await import('../src/main/db');
    initDb();

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
    const { initDb } = await import('../src/main/db');
    const { insertRun, getInterruptedRuns } = await import('../src/main/db');
    initDb();

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/runDb.test.ts --reporter=verbose`
Expected: FAIL — `insertRun`, `updateRunStatus`, `getInterruptedRuns`, `incrementResumeAttempts` do not exist

- [ ] **Step 3: Add `runs` table schema and helpers to `src/main/db.ts`**

After the `browser_tabs` table creation (after line 95), add:

```typescript
    // Run persistence for auto-resume
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
```

Then add these exported functions after the `saveBrowserTabs` function (after line 140):

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/runDb.test.ts --reporter=verbose`
Expected: PASS — all 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts tests/runDb.test.ts
git commit -m "feat: add runs table and DB helpers for persistent run tracking"
```

---

### Task 3: Wire run registry to DB persistence

**Files:**
- Modify: `src/main/runRegistry.ts`
- Modify: `src/main/registerIpc.ts:37-38` (pass extra args to createRun)

- [ ] **Step 1: Write the failing test**

Add to `tests/runLifecycle.test.ts`, a new describe block at the bottom:

```typescript
describe('interruptAllRuns', () => {
  it('transitions all running runs to interrupted status', () => {
    const id1 = generateRunId();
    const id2 = generateRunId();
    createRun(id1, 'conv-a');
    createRun(id2, 'conv-b');

    const { interruptAllRuns } = require('../src/main/runRegistry');
    const count = interruptAllRuns();

    expect(count).toBe(2);
    expect(getRun(id1)!.status).toBe('interrupted');
    expect(getRun(id2)!.status).toBe('interrupted');

    // Cleanup
    removeRun(id1);
    removeRun(id2);
  });
});
```

Note: update the `removeRun` function to also allow removing `interrupted` runs (see step 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runLifecycle.test.ts --reporter=verbose`
Expected: FAIL — `interruptAllRuns` is not exported

- [ ] **Step 3: Update `src/main/runRegistry.ts`**

Replace the entire file with:

```typescript
/**
 * In-memory registry of in-flight Codex runs.
 *
 * Each run tracks a single Codex process execution tied to a conversation.
 * Supports lifecycle transitions: running → completed | failed | cancelled | interrupted.
 *
 * DB persistence is optional — callers (registerIpc, main) handle DB writes
 * so this module stays free of DB imports and remains easy to test.
 */

import type { RunStatus } from '../shared/types';
export type { RunStatus };

export interface RunRecord {
  runId: string;
  conversationId: string;
  status: RunStatus;
  abort: AbortController;
  startedAt: number;
  error?: string;
}

const runs = new Map<string, RunRecord>();

export function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRun(runId: string, conversationId: string): RunRecord {
  const record: RunRecord = {
    runId,
    conversationId,
    status: 'running',
    abort: new AbortController(),
    startedAt: Date.now(),
  };
  runs.set(runId, record);
  return record;
}

export function getRun(runId: string): RunRecord | undefined {
  return runs.get(runId);
}

/** Get the currently running run for a conversation, if any. */
export function getActiveRunForConversation(conversationId: string): RunRecord | undefined {
  for (const run of runs.values()) {
    if (run.conversationId === conversationId && run.status === 'running') {
      return run;
    }
  }
  return undefined;
}

/** Transition a run to a terminal state. Returns false if already terminal. */
export function completeRun(runId: string, status: 'completed' | 'failed' | 'cancelled', error?: string): boolean {
  const run = runs.get(runId);
  if (!run || run.status !== 'running') return false;
  run.status = status;
  if (error) run.error = error;
  return true;
}

/** Remove a terminal run from the registry. Call after cleanup is done. */
export function removeRun(runId: string): void {
  const run = runs.get(runId);
  if (run && run.status !== 'running') {
    runs.delete(runId);
  }
}

/** Cancel a run by runId. Aborts the signal and transitions state. Returns false if not cancellable. */
export function cancelRun(runId: string): boolean {
  const run = runs.get(runId);
  if (!run || run.status !== 'running') return false;
  run.abort.abort();
  run.status = 'cancelled';
  return true;
}

/** Cancel all running runs. Called on app quit to prevent orphan processes. */
export function cancelAllRuns(): number {
  let count = 0;
  for (const run of runs.values()) {
    if (run.status === 'running') {
      run.abort.abort();
      run.status = 'cancelled';
      count++;
    }
  }
  return count;
}

/** Interrupt all running runs — abort processes but mark as 'interrupted' for resume. */
export function interruptAllRuns(): number {
  let count = 0;
  for (const run of runs.values()) {
    if (run.status === 'running') {
      run.abort.abort();
      run.status = 'interrupted';
      count++;
    }
  }
  return count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/runLifecycle.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Update `src/main/registerIpc.ts` to persist runs to DB**

Add import at top of file (after existing imports):

```typescript
import { insertRun, updateRunStatus } from './db';
```

In the `CHAT_SEND` handler, after `const run = createRun(runId, conversationId);` (line 38), add:

```typescript
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
```

In the async IIFE, after `completeRun(runId, 'failed', result.error);` (line 87), add:

```typescript
          updateRunStatus(runId, 'failed', result.error);
```

After `completeRun(runId, 'completed');` (line 92), add:

```typescript
          updateRunStatus(runId, 'completed');
```

In the catch block, after `completeRun(runId, 'failed', message);` (line 99), add:

```typescript
        updateRunStatus(runId, 'failed', message);
```

In the cancelled check block (around line 60-66), after the `if (run.status === 'cancelled')` block's `removeRun(runId);`, add before `return;`:

```typescript
          updateRunStatus(runId, 'cancelled');
```

In the `CHAT_STOP` handler, after `const cancelled = cancelRun(runId);` (line 118), add:

```typescript
    if (cancelled) updateRunStatus(runId, 'cancelled');
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: PASS — all existing and new tests

- [ ] **Step 7: Commit**

```bash
git add src/main/runRegistry.ts src/main/registerIpc.ts tests/runLifecycle.test.ts
git commit -m "feat: wire run registry to DB persistence, add interruptAllRuns"
```

---

### Task 4: Implement resume logic and update app lifecycle

**Files:**
- Create: `src/main/resumeRuns.ts`
- Modify: `src/main/main.ts`
- Create: `tests/resumeRuns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/resumeRuns.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB module
vi.mock('../src/main/db', () => ({
  getInterruptedRuns: vi.fn(),
  updateRunStatus: vi.fn(),
  incrementResumeAttempts: vi.fn(),
  getConversation: vi.fn(),
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), run: vi.fn(), all: vi.fn() })),
  })),
}));

// Mock runRegistry
vi.mock('../src/main/runRegistry', () => ({
  createRun: vi.fn(() => ({
    runId: 'run-1',
    conversationId: 'conv-1',
    status: 'running',
    abort: new AbortController(),
    startedAt: Date.now(),
  })),
  generateRunId: vi.fn(() => 'run-resume-1'),
}));

// Mock codexChat
vi.mock('../src/main/codex/codexChat', () => ({
  streamCodexChat: vi.fn(() => Promise.resolve({ response: 'ok', contentBlocks: [] })),
}));

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [{ webContents: { send: vi.fn(), isDestroyed: () => false } }]) },
}));

import { getInterruptedRuns, updateRunStatus, incrementResumeAttempts, getConversation } from '../src/main/db';
import { createRun } from '../src/main/runRegistry';

describe('resumeInterruptedRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no interrupted runs exist', async () => {
    (getInterruptedRuns as any).mockReturnValue([]);

    const { resumeInterruptedRuns } = await import('../src/main/resumeRuns');
    await resumeInterruptedRuns();

    expect(createRun).not.toHaveBeenCalled();
  });

  it('marks stale running rows as interrupted before resuming', async () => {
    (getInterruptedRuns as any).mockReturnValue([
      { id: 'run-old', conversation_id: 'conv-1', status: 'running', user_text: 'hi', model: 'o3', tier: 'think', started_at: '2026-01-01', resume_attempts: 0 },
    ]);
    (getConversation as any).mockReturnValue({ id: 'conv-1', codex_thread_id: 'thread-abc' });

    const { resumeInterruptedRuns } = await import('../src/main/resumeRuns');
    await resumeInterruptedRuns();

    // Should mark running → interrupted first
    expect(updateRunStatus).toHaveBeenCalledWith('run-old', 'interrupted');
  });

  it('skips runs that have exceeded max resume attempts', async () => {
    (getInterruptedRuns as any).mockReturnValue([
      { id: 'run-maxed', conversation_id: 'conv-1', status: 'interrupted', user_text: 'hi', model: 'o3', tier: 'think', started_at: '2026-01-01', resume_attempts: 3 },
    ]);

    const { resumeInterruptedRuns } = await import('../src/main/resumeRuns');
    await resumeInterruptedRuns();

    expect(updateRunStatus).toHaveBeenCalledWith('run-maxed', 'failed', 'Exceeded maximum resume attempts (3)');
    expect(createRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/resumeRuns.test.ts --reporter=verbose`
Expected: FAIL — `src/main/resumeRuns.ts` does not exist

- [ ] **Step 3: Create `src/main/resumeRuns.ts`**

```typescript
import { BrowserWindow } from 'electron';
import { getInterruptedRuns, updateRunStatus, incrementResumeAttempts, getConversation } from './db';
import { createRun } from './runRegistry';
import { streamCodexChat } from './codex/codexChat';
import { IPC_EVENTS } from './ipc-channels';
import type { RunRow } from './db';

const MAX_RESUME_ATTEMPTS = 3;

function getWebContents() {
  const win = BrowserWindow.getAllWindows()[0];
  return win?.webContents;
}

async function resumeSingleRun(row: RunRow): Promise<void> {
  const wc = getWebContents();
  if (!wc || wc.isDestroyed()) return;

  const conversation = getConversation(row.conversation_id);
  const threadId = conversation?.codex_thread_id;

  if (!threadId) {
    updateRunStatus(row.id, 'failed', 'No thread ID found — cannot resume session');
    wc.send(IPC_EVENTS.CHAT_RESUME_FAILED, {
      runId: row.id,
      conversationId: row.conversation_id,
      error: 'No thread ID found — cannot resume session',
      attempts: row.resume_attempts,
    });
    return;
  }

  incrementResumeAttempts(row.id);

  // Create a fresh in-memory run record
  const run = createRun(row.id, row.conversation_id);

  // Notify renderer that this run is active again
  wc.send(IPC_EVENTS.CHAT_RUN_START, { runId: row.id, conversationId: row.conversation_id });
  updateRunStatus(row.id, 'running');

  try {
    const result = await streamCodexChat({
      webContents: wc,
      userText: row.user_text,
      model: row.model ?? undefined,
      conversationId: row.conversation_id,
      signal: run.abort.signal,
    });

    if (run.status === 'cancelled') {
      updateRunStatus(row.id, 'cancelled');
      if (!wc.isDestroyed()) {
        wc.send(IPC_EVENTS.CHAT_RUN_END, { runId: row.id, conversationId: row.conversation_id, status: 'cancelled' });
      }
      return;
    }

    if (result.error) {
      updateRunStatus(row.id, 'failed', result.error);
      if (!wc.isDestroyed()) {
        wc.send(IPC_EVENTS.CHAT_RUN_END, { runId: row.id, conversationId: row.conversation_id, status: 'failed', error: result.error });
      }
    } else {
      updateRunStatus(row.id, 'completed');
      if (!wc.isDestroyed()) {
        wc.send(IPC_EVENTS.CHAT_RUN_END, { runId: row.id, conversationId: row.conversation_id, status: 'completed' });
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    updateRunStatus(row.id, 'failed', message);
    if (!wc.isDestroyed()) {
      wc.send(IPC_EVENTS.CHAT_RESUME_FAILED, {
        runId: row.id,
        conversationId: row.conversation_id,
        error: message,
        attempts: row.resume_attempts + 1,
      });
    }
  }
}

export async function resumeInterruptedRuns(): Promise<void> {
  const rows = getInterruptedRuns();
  if (rows.length === 0) return;

  console.log(`[resume] Found ${rows.length} interrupted run(s) to resume`);

  for (const row of rows) {
    // Runs that were 'running' in DB survived a crash — mark as interrupted first
    if (row.status === 'running') {
      updateRunStatus(row.id, 'interrupted');
    }

    // Check max attempts
    if (row.resume_attempts >= MAX_RESUME_ATTEMPTS) {
      console.log(`[resume] Skipping ${row.id} — exceeded max attempts (${MAX_RESUME_ATTEMPTS})`);
      updateRunStatus(row.id, 'failed', `Exceeded maximum resume attempts (${MAX_RESUME_ATTEMPTS})`);
      continue;
    }

    // Resume asynchronously — don't block other resumes
    void resumeSingleRun(row);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/resumeRuns.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/resumeRuns.ts tests/resumeRuns.test.ts
git commit -m "feat: add resumeInterruptedRuns to re-spawn Codex on startup"
```

---

### Task 5: Update app lifecycle in main.ts

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Update imports in `src/main/main.ts`**

Replace the import line:

```typescript
import { cancelAllRuns } from './runRegistry';
```

with:

```typescript
import { interruptAllRuns } from './runRegistry';
import { getInterruptedRuns, updateRunStatus } from './db';
import { resumeInterruptedRuns } from './resumeRuns';
```

- [ ] **Step 2: Add resume call on startup**

In the `app.whenReady()` handler, after `await createAppWindow();` (line 62), add:

```typescript
  // Resume any interrupted runs from previous session
  void resumeInterruptedRuns();
```

- [ ] **Step 3: Update shutdown handler**

Replace the `before-quit` handler (lines 71-80) with:

```typescript
app.on('before-quit', async () => {
  // Interrupt all in-flight Codex runs — abort processes but mark as resumable
  const interrupted = interruptAllRuns();
  if (interrupted > 0) {
    console.log(`[main] interrupted ${interrupted} active run(s) on quit`);
    // Persist interrupted status to DB
    const rows = getInterruptedRuns();
    for (const row of rows) {
      if (row.status === 'running') {
        updateRunStatus(row.id, 'interrupted');
      }
    }
  }
  // Close the browser bridge HTTP server so it doesn't hold the process alive
  await closeBrowserBridge();
});
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts
git commit -m "feat: resume interrupted runs on startup, interrupt on shutdown"
```

---

### Task 6: Add preload bridge and IPC handlers for retry/dismiss

**Files:**
- Modify: `src/main/preload.ts`
- Modify: `src/main/registerIpc.ts`

- [ ] **Step 1: Add preload bridge methods**

In `src/main/preload.ts`, inside the `chat` object (after the `onVerification` listener, around line 47), add:

```typescript
      onResumeFailed: (cb: (payload: { runId: string; conversationId: string; error: string; attempts: number }) => void) =>
        onEvent(IPC_EVENTS.CHAT_RESUME_FAILED, cb),
      resumeRetry: (runId: string) => ipcRenderer.invoke(IPC.CHAT_RESUME_RETRY, runId),
      resumeDismiss: (runId: string) => ipcRenderer.invoke(IPC.CHAT_RESUME_DISMISS, runId),
```

- [ ] **Step 2: Add IPC handlers in `src/main/registerIpc.ts`**

Add import at top (add `getConversation` to existing db import):

```typescript
import { insertRun, updateRunStatus, incrementResumeAttempts, getConversation as getConv } from './db';
```

Note: rename to `getConv` to avoid conflict if `getConversation` is already imported elsewhere. Check existing imports first — if `getConversation` is not imported, use that name directly.

After the `CHAT_STOP` handler, add:

```typescript
  ipcMain.handle(IPC.CHAT_RESUME_RETRY, async (_event, runId: string) => {
    if (!runId) return { ok: false, error: 'missing runId' };
    // Re-trigger resume for this specific run
    const { resumeSingleRunById } = await import('./resumeRuns');
    const result = await resumeSingleRunById(runId);
    return { ok: result };
  });

  ipcMain.handle(IPC.CHAT_RESUME_DISMISS, async (_event, runId: string) => {
    if (!runId) return { ok: false, error: 'missing runId' };
    updateRunStatus(runId, 'failed', 'Dismissed by user');
    return { ok: true };
  });
```

- [ ] **Step 3: Add `resumeSingleRunById` export to `src/main/resumeRuns.ts`**

Add at the bottom of the file:

```typescript
export async function resumeSingleRunById(runId: string): Promise<boolean> {
  const { getDb } = await import('./db');
  const row = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
  if (!row) return false;
  if (row.resume_attempts >= MAX_RESUME_ATTEMPTS) {
    updateRunStatus(runId, 'failed', `Exceeded maximum resume attempts (${MAX_RESUME_ATTEMPTS})`);
    return false;
  }
  await resumeSingleRun(row);
  return true;
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/preload.ts src/main/registerIpc.ts src/main/resumeRuns.ts
git commit -m "feat: add retry/dismiss IPC handlers for failed resume notifications"
```

---

### Task 7: Add resume failed notification to renderer

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`

- [ ] **Step 1: Add resume failed listener to ChatPanel**

In the `useEffect` that subscribes to streaming events (around line 287), add a new subscription after `unsubTitle`:

```typescript
    const unsubResumeFailed = api.onResumeFailed?.((payload: { runId: string; conversationId: string; error: string; attempts: number }) => {
      if (payload.conversationId !== conversationIdRef.current) return;

      setMessages((prev) => [
        ...prev,
        {
          id: `resume-failed-${Date.now()}`,
          role: 'assistant' as const,
          content: `**Resume failed:** ${payload.error}\n\nThis task was interrupted and could not be automatically resumed.`,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        },
      ]);

      // Show inline retry/dismiss buttons via a custom message
      setMessages((prev) => [
        ...prev,
        {
          id: `resume-actions-${Date.now()}`,
          role: 'assistant' as const,
          content: '',
          timestamp: '',
          // We'll use a special contentBlocks entry to render buttons
          contentBlocks: [{
            type: 'text',
            content: `_Use the retry button in the input bar to resend your message, or start a new conversation._`,
          }],
        },
      ]);
    });
```

Add cleanup in the return function:

```typescript
      unsubResumeFailed?.();
```

- [ ] **Step 2: Run the app in dev mode and verify**

Run: `npm run dev`
- Verify the app starts without errors
- Check the console for any TypeScript compilation errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx
git commit -m "feat: show resume failed notification in chat panel"
```

---

### Task 8: Final integration test and cleanup

**Files:**
- Modify: `tests/runLifecycle.test.ts` (update length assertion)

- [ ] **Step 1: Update the RUN_STATUSES length test**

In `tests/runLifecycle.test.ts`, the existing test checks `RUN_STATUSES` has length 4. We already added a test for length 5 in Task 1. Verify the old test was updated:

The test at line 129 should now read:
```typescript
      expect(RUN_STATUSES).toHaveLength(5);
```

If it still says 4, update it.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: PASS — all tests green

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "test: update anti-staleness tests for interrupted status"
```
