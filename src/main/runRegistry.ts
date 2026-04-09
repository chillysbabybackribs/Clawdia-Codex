/**
 * In-memory registry of in-flight Codex runs.
 *
 * Each run tracks a single Codex process execution tied to a conversation.
 * Supports lifecycle transitions: running → completed | failed | cancelled.
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
