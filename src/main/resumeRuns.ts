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
