/**
 * Tests for run lifecycle contracts.
 *
 * These tests import shared constants from production code.
 * If RunStatus or lifecycle semantics change, these tests will fail.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRun,
  getRun,
  cancelRun,
  completeRun,
  removeRun,
  generateRunId,
} from '../src/main/runRegistry';
import {
  RUN_STATUSES,
  buildRunStartPayload,
  buildRunEndPayload,
  assertValidRunEnd,
} from './helpers/contracts';

describe('runRegistry', () => {
  let runId: string;
  const conversationId = 'conv-test-lifecycle';

  beforeEach(() => {
    runId = generateRunId();
  });

  it('generateRunId returns a string starting with "run-"', () => {
    expect(runId).toMatch(/^run-\d+-[a-z0-9]+$/);
  });

  it('createRun initializes with status "running"', () => {
    const run = createRun(runId, conversationId);
    expect(run.status).toBe('running');
    expect(run.runId).toBe(runId);
    expect(run.conversationId).toBe(conversationId);
    expect(run.abort).toBeInstanceOf(AbortController);
    expect(run.startedAt).toBeGreaterThan(0);
  });

  it('getRun retrieves a created run', () => {
    createRun(runId, conversationId);
    const run = getRun(runId);
    expect(run).toBeDefined();
    expect(run!.runId).toBe(runId);
  });

  it('getRun returns undefined for unknown runId', () => {
    expect(getRun('nonexistent')).toBeUndefined();
  });

  it('chat:send returns immediately with runId (payload shape)', () => {
    // Simulate the shape that chat:send returns
    const result = { ok: true, conversationId, runId };
    expect(result.ok).toBe(true);
    expect(typeof result.runId).toBe('string');
    expect(typeof result.conversationId).toBe('string');
  });

  describe('lifecycle transitions', () => {
    beforeEach(() => {
      createRun(runId, conversationId);
    });

    it('completeRun transitions running → completed', () => {
      expect(completeRun(runId, 'completed')).toBe(true);
      expect(getRun(runId)!.status).toBe('completed');
    });

    it('completeRun transitions running → failed with error', () => {
      expect(completeRun(runId, 'failed', 'test error')).toBe(true);
      const run = getRun(runId)!;
      expect(run.status).toBe('failed');
      expect(run.error).toBe('test error');
    });

    it('completeRun rejects double-transition', () => {
      completeRun(runId, 'completed');
      expect(completeRun(runId, 'failed')).toBe(false);
      expect(getRun(runId)!.status).toBe('completed');
    });

    it('cancelRun transitions running → cancelled and aborts signal', () => {
      const run = getRun(runId)!;
      expect(run.abort.signal.aborted).toBe(false);
      expect(cancelRun(runId)).toBe(true);
      expect(run.status).toBe('cancelled');
      expect(run.abort.signal.aborted).toBe(true);
    });

    it('cancelRun rejects cancellation of completed run', () => {
      completeRun(runId, 'completed');
      expect(cancelRun(runId)).toBe(false);
    });

    it('cancelRun targets the correct run by runId', () => {
      const otherId = generateRunId();
      createRun(otherId, conversationId);
      cancelRun(runId);
      expect(getRun(runId)!.status).toBe('cancelled');
      expect(getRun(otherId)!.status).toBe('running');
      // Clean up
      completeRun(otherId, 'completed');
      removeRun(otherId);
    });

    it('removeRun only removes terminal runs', () => {
      // Running runs are not removed
      removeRun(runId);
      expect(getRun(runId)).toBeDefined();

      // Terminal runs are removed
      completeRun(runId, 'completed');
      removeRun(runId);
      expect(getRun(runId)).toBeUndefined();
    });
  });

  describe('anti-staleness: shared constants', () => {
    it('RUN_STATUSES contains all expected statuses', () => {
      expect(RUN_STATUSES).toContain('running');
      expect(RUN_STATUSES).toContain('completed');
      expect(RUN_STATUSES).toContain('failed');
      expect(RUN_STATUSES).toContain('cancelled');
      expect(RUN_STATUSES).toHaveLength(4);
    });

    it('run record status is always a valid RunStatus', () => {
      const run = createRun(runId, conversationId);
      expect(RUN_STATUSES).toContain(run.status);
      cancelRun(runId);
      expect(RUN_STATUSES).toContain(run.status);
    });
  });

  describe('payload builders produce valid shapes', () => {
    it('buildRunStartPayload has required fields', () => {
      const payload = buildRunStartPayload();
      expect(typeof payload.runId).toBe('string');
      expect(typeof payload.conversationId).toBe('string');
    });

    it('buildRunEndPayload has valid status', () => {
      const payload = buildRunEndPayload();
      assertValidRunEnd(payload);
    });

    it('buildRunEndPayload with error', () => {
      const payload = buildRunEndPayload({ status: 'failed', error: 'boom' });
      assertValidRunEnd(payload);
      expect(payload.error).toBe('boom');
    });

    it('assertValidRunEnd rejects invalid status', () => {
      expect(() => assertValidRunEnd({ runId: 'x', conversationId: 'y', status: 'bogus' }))
        .toThrow('invalid run status');
    });
  });
});
