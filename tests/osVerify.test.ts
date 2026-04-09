/**
 * Tests for OS verification module.
 *
 * Integration tests that call the real verification functions.
 * These verify the shape of results regardless of what's actually
 * running on the system.
 */

import { describe, it, expect } from 'vitest';
import { verifyWindowFocused, verifyProcessRunning } from '../src/main/verification/osVerify';
import { assertValidVerification, VERIFICATION_KINDS } from './helpers/contracts';

describe('osVerify', () => {
  describe('verifyWindowFocused', () => {
    it('returns a valid verification result', async () => {
      const result = await verifyWindowFocused('anything');
      assertValidVerification(result);
      expect(result.kind).toBe('os:window_focused');
      expect(result.target).toBe('anything');
      // changed is null because this is a presence check
      expect(result.changed).toBeNull();
    });

    it('has after field with window title or error note', async () => {
      const result = await verifyWindowFocused('test');
      assertValidVerification(result);
      // Either after is set (active window found) or note explains failure
      expect(result.after || result.note).toBeTruthy();
    });
  });

  describe('verifyProcessRunning', () => {
    it('returns a valid verification result for known process', async () => {
      // node is definitely running (we're running on it)
      const result = await verifyProcessRunning('node');
      assertValidVerification(result);
      expect(result.kind).toBe('os:process_running');
      expect(result.target).toBe('node');
      expect(result.after).toBe('running');
    });

    it('returns not running for nonexistent process', async () => {
      const result = await verifyProcessRunning('zzz_nonexistent_process_zzz_12345');
      assertValidVerification(result);
      expect(result.after).toBe('not running');
    });
  });

  describe('anti-staleness: OS verification kinds are in shared constant', () => {
    it('os:window_focused is a valid verification kind', () => {
      expect(VERIFICATION_KINDS).toContain('os:window_focused');
    });

    it('os:process_running is a valid verification kind', () => {
      expect(VERIFICATION_KINDS).toContain('os:process_running');
    });
  });
});
