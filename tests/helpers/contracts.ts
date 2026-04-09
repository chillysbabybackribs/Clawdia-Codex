/**
 * Shared contract helpers for tests.
 *
 * These builders import types and constants from production code.
 * If production types change, tests using these builders will fail at compile time
 * or produce type errors — preventing silent contract drift.
 */

import type {
  ToolCall,
  VerificationResult,
  VerificationKind,
  VerificationConfidence,
  ContentBlock,
  RunStatus,
} from '../../src/shared/types';

import {
  RUN_STATUSES,
  VERIFICATION_KINDS,
  TOOL_CALL_STATUSES,
  IPC_EVENT_NAMES,
} from '../../src/shared/types';

// Re-export for test convenience — tests import from here, not directly from shared
export {
  RUN_STATUSES,
  VERIFICATION_KINDS,
  TOOL_CALL_STATUSES,
  IPC_EVENT_NAMES,
};
export type {
  ToolCall,
  VerificationResult,
  VerificationKind,
  VerificationConfidence,
  ContentBlock,
  RunStatus,
};

// ── Run lifecycle builders ───────────────────────────────────────────────────

export interface RunStartPayload {
  runId: string;
  conversationId: string;
}

export interface RunEndPayload {
  runId: string;
  conversationId: string;
  status: RunStatus;
  error?: string;
}

export function buildRunStartPayload(overrides?: Partial<RunStartPayload>): RunStartPayload {
  return {
    runId: 'run-test-001',
    conversationId: 'conv-test-001',
    ...overrides,
  };
}

export function buildRunEndPayload(overrides?: Partial<RunEndPayload>): RunEndPayload {
  return {
    runId: 'run-test-001',
    conversationId: 'conv-test-001',
    status: 'completed',
    ...overrides,
  };
}

// ── Tool call builders ───────────────────────────────────────────────────────

export function buildToolCall(overrides?: Partial<ToolCall>): ToolCall {
  return {
    id: 'tool-test-001',
    name: 'shell_exec',
    status: 'success',
    detail: 'echo hello',
    input: '{"command":"echo hello"}',
    output: 'hello',
    ...overrides,
  };
}

// ── Verification result builders ─────────────────────────────────────────────

export function buildVerificationResult(overrides?: Partial<VerificationResult>): VerificationResult {
  return {
    kind: 'fs:exists',
    target: '/tmp/test-file',
    changed: true,
    before: 'absent',
    after: 'exists',
    confidence: 'high',
    timestampMs: Date.now(),
    ...overrides,
  };
}

export function buildBrowserVerification(overrides?: Partial<VerificationResult>): VerificationResult {
  return {
    kind: 'browser:url',
    target: 'https://example.com',
    changed: true,
    before: 'https://old.example.com',
    after: 'https://example.com',
    confidence: 'high',
    timestampMs: Date.now(),
    ...overrides,
  };
}

export function buildFsVerification(overrides?: Partial<VerificationResult>): VerificationResult {
  return {
    kind: 'fs:exists',
    target: '/tmp/test-file',
    changed: true,
    before: 'absent',
    after: 'exists',
    confidence: 'high',
    timestampMs: Date.now(),
    ...overrides,
  };
}

// ── Content block builders ───────────────────────────────────────────────────

export function buildTextBlock(content = 'test text'): ContentBlock {
  return { type: 'text', content };
}

export function buildToolBlock(overrides?: Partial<ToolCall>): ContentBlock {
  return { type: 'tool', tool: buildToolCall(overrides) };
}

export function buildVerificationBlock(overrides?: Partial<VerificationResult>): ContentBlock {
  return { type: 'verification', result: buildVerificationResult(overrides) };
}

// ── Assertion helpers ────────────────────────────────────────────────────────

/** Assert that a verification result has valid shape (all required fields present, kind is valid). */
export function assertValidVerification(result: unknown): asserts result is VerificationResult {
  const r = result as Record<string, unknown>;
  if (!r || typeof r !== 'object') throw new Error('verification result is not an object');
  if (!VERIFICATION_KINDS.includes(r.kind as VerificationKind)) {
    throw new Error(`invalid verification kind: ${r.kind}. Valid: ${VERIFICATION_KINDS.join(', ')}`);
  }
  if (typeof r.target !== 'string') throw new Error('verification target must be a string');
  if (r.changed !== true && r.changed !== false && r.changed !== null) {
    throw new Error('verification changed must be true, false, or null');
  }
  if (!(['high', 'medium', 'low'] as const).includes(r.confidence as VerificationConfidence)) {
    throw new Error(`invalid verification confidence: ${r.confidence}`);
  }
  if (typeof r.timestampMs !== 'number') throw new Error('verification timestampMs must be a number');
}

/** Assert that a RunEndPayload has valid shape. */
export function assertValidRunEnd(payload: unknown): asserts payload is RunEndPayload {
  const p = payload as Record<string, unknown>;
  if (!p || typeof p !== 'object') throw new Error('run end payload is not an object');
  if (typeof p.runId !== 'string') throw new Error('runId must be a string');
  if (typeof p.conversationId !== 'string') throw new Error('conversationId must be a string');
  if (!RUN_STATUSES.includes(p.status as RunStatus)) {
    throw new Error(`invalid run status: ${p.status}. Valid: ${RUN_STATUSES.join(', ')}`);
  }
}

/** Assert that a content block has valid shape. */
export function assertValidContentBlock(block: unknown): asserts block is ContentBlock {
  const b = block as Record<string, unknown>;
  if (!b || typeof b !== 'object') throw new Error('content block is not an object');
  if (b.type === 'text') {
    if (typeof (b as any).content !== 'string') throw new Error('text block must have string content');
    return;
  }
  if (b.type === 'tool') {
    const tool = (b as any).tool;
    if (!tool || typeof tool !== 'object') throw new Error('tool block must have a tool object');
    if (!TOOL_CALL_STATUSES.includes(tool.status)) {
      throw new Error(`invalid tool status: ${tool.status}. Valid: ${TOOL_CALL_STATUSES.join(', ')}`);
    }
    return;
  }
  if (b.type === 'verification') {
    assertValidVerification((b as any).result);
    return;
  }
  throw new Error(`unknown content block type: ${b.type}`);
}
