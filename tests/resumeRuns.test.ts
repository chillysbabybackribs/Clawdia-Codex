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
