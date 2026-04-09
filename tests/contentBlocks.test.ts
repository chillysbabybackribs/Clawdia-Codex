/**
 * Tests for content block contract validity.
 *
 * Anti-staleness: uses shared builders and assertors that import
 * from production types. If ContentBlock shape changes, these fail.
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_CALL_STATUSES,
  VERIFICATION_KINDS,
  buildTextBlock,
  buildToolBlock,
  buildVerificationBlock,
  buildToolCall,
  buildVerificationResult,
  assertValidContentBlock,
  assertValidVerification,
} from './helpers/contracts';

describe('content block contracts', () => {
  describe('text blocks', () => {
    it('buildTextBlock produces a valid text block', () => {
      const block = buildTextBlock('hello');
      assertValidContentBlock(block);
      expect(block.type).toBe('text');
    });
  });

  describe('tool blocks', () => {
    it('buildToolBlock produces a valid tool block', () => {
      const block = buildToolBlock();
      assertValidContentBlock(block);
      expect(block.type).toBe('tool');
    });

    for (const status of TOOL_CALL_STATUSES) {
      it(`tool block with status "${status}" is valid`, () => {
        const block = buildToolBlock({ status });
        assertValidContentBlock(block);
      });
    }

    it('rejects unknown tool status', () => {
      expect(() => assertValidContentBlock({
        type: 'tool',
        tool: { ...buildToolCall(), status: 'unknown' as any },
      })).toThrow('invalid tool status');
    });
  });

  describe('verification blocks', () => {
    it('buildVerificationBlock produces a valid verification block', () => {
      const block = buildVerificationBlock();
      assertValidContentBlock(block);
      expect(block.type).toBe('verification');
    });

    for (const kind of VERIFICATION_KINDS) {
      it(`verification with kind "${kind}" is valid`, () => {
        const block = buildVerificationBlock({ kind });
        assertValidContentBlock(block);
      });
    }

    it('verification with changed=null (indeterminate) is valid', () => {
      const block = buildVerificationBlock({ changed: null, confidence: 'low', note: 'could not verify' });
      assertValidContentBlock(block);
    });

    it('rejects unknown verification kind', () => {
      expect(() => assertValidVerification({
        ...buildVerificationResult(),
        kind: 'bogus:kind' as any,
      })).toThrow('invalid verification kind');
    });

    it('rejects missing target', () => {
      expect(() => assertValidVerification({
        ...buildVerificationResult(),
        target: 42 as any,
      })).toThrow('target must be a string');
    });

    it('rejects invalid confidence', () => {
      expect(() => assertValidVerification({
        ...buildVerificationResult(),
        confidence: 'maybe' as any,
      })).toThrow('invalid verification confidence');
    });
  });

  describe('unknown block types', () => {
    it('rejects unknown type', () => {
      expect(() => assertValidContentBlock({ type: 'image' }))
        .toThrow('unknown content block type');
    });
  });
});
