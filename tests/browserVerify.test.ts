/**
 * Tests for browser verification module.
 *
 * Uses mock WebContents-like objects to test verification logic
 * without requiring Electron.
 */

import { describe, it, expect } from 'vitest';
import {
  captureBrowserSnapshot,
  verifyUrlChanged,
  verifyTitleChanged,
  verifyTextPresent,
  verifySelectorPresent,
  diffBrowserSnapshots,
} from '../src/main/verification/browserVerify';
import type { BrowserSnapshot } from '../src/main/verification/browserVerify';
import { assertValidVerification } from './helpers/contracts';

function makeSnapshot(overrides?: Partial<BrowserSnapshot>): BrowserSnapshot {
  return {
    url: 'https://example.com',
    title: 'Example',
    timestampMs: Date.now(),
    ...overrides,
  };
}

function mockWc(url: string, title: string, bodyText = '') {
  return {
    getURL: () => url,
    getTitle: () => title,
    executeJavaScript: async (code: string) => {
      if (code.includes('document.body.innerText.includes')) {
        return bodyText.includes(JSON.parse(code.match(/includes\((.+)\)/)![1]));
      }
      if (code.includes('document.querySelector')) {
        // Simulate: return true for known selectors
        return code.includes('"#exists"');
      }
      return null;
    },
  };
}

describe('browserVerify', () => {
  describe('captureBrowserSnapshot', () => {
    it('captures URL and title from WebContents', async () => {
      const wc = mockWc('https://test.com', 'Test Page');
      const snap = await captureBrowserSnapshot(wc);
      expect(snap.url).toBe('https://test.com');
      expect(snap.title).toBe('Test Page');
      expect(snap.timestampMs).toBeGreaterThan(0);
    });
  });

  describe('verifyUrlChanged', () => {
    it('detects URL change', () => {
      const before = makeSnapshot({ url: 'https://a.com' });
      const after = makeSnapshot({ url: 'https://b.com' });
      const result = verifyUrlChanged(before, after);
      assertValidVerification(result);
      expect(result.kind).toBe('browser:url');
      expect(result.changed).toBe(true);
      expect(result.before).toBe('https://a.com');
      expect(result.after).toBe('https://b.com');
    });

    it('detects no URL change', () => {
      const before = makeSnapshot({ url: 'https://same.com' });
      const after = makeSnapshot({ url: 'https://same.com' });
      const result = verifyUrlChanged(before, after);
      assertValidVerification(result);
      expect(result.changed).toBe(false);
    });
  });

  describe('verifyTitleChanged', () => {
    it('detects title change', () => {
      const before = makeSnapshot({ title: 'Old Title' });
      const after = makeSnapshot({ title: 'New Title' });
      const result = verifyTitleChanged(before, after);
      assertValidVerification(result);
      expect(result.kind).toBe('browser:title');
      expect(result.changed).toBe(true);
    });

    it('detects no title change', () => {
      const snap = makeSnapshot();
      const result = verifyTitleChanged(snap, snap);
      assertValidVerification(result);
      expect(result.changed).toBe(false);
    });
  });

  describe('verifyTextPresent', () => {
    it('reports text found as present', async () => {
      const wc = mockWc('https://test.com', 'Test', 'Hello world');
      const result = await verifyTextPresent(wc, 'Hello');
      assertValidVerification(result);
      expect(result.kind).toBe('browser:text_present');
      expect(result.after).toBe('present');
      expect(result.changed).toBeNull(); // presence check, not diff
    });

    it('reports text not found as absent', async () => {
      const wc = mockWc('https://test.com', 'Test', 'Hello world');
      const result = await verifyTextPresent(wc, 'Goodbye');
      assertValidVerification(result);
      expect(result.after).toBe('absent');
    });

    it('handles execution failure gracefully', async () => {
      const wc = {
        executeJavaScript: async () => { throw new Error('tab destroyed'); },
      };
      const result = await verifyTextPresent(wc, 'test');
      assertValidVerification(result);
      expect(result.changed).toBeNull();
      expect(result.confidence).toBe('low');
      expect(result.note).toContain('failed');
    });
  });

  describe('verifySelectorPresent', () => {
    it('reports found selector as present', async () => {
      const wc = mockWc('https://test.com', 'Test');
      const result = await verifySelectorPresent(wc, '#exists');
      assertValidVerification(result);
      expect(result.kind).toBe('browser:selector_present');
      expect(result.after).toBe('present');
    });

    it('reports missing selector as absent', async () => {
      const wc = mockWc('https://test.com', 'Test');
      const result = await verifySelectorPresent(wc, '#missing');
      assertValidVerification(result);
      expect(result.after).toBe('absent');
    });
  });

  describe('diffBrowserSnapshots', () => {
    it('returns change results when URL changed', () => {
      const before = makeSnapshot({ url: 'https://a.com' });
      const after = makeSnapshot({ url: 'https://b.com' });
      const results = diffBrowserSnapshots(before, after);
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) assertValidVerification(r);
      expect(results.some(r => r.kind === 'browser:url' && r.changed)).toBe(true);
    });

    it('returns no-change result when nothing changed', () => {
      const snap = makeSnapshot();
      const results = diffBrowserSnapshots(snap, snap);
      expect(results).toHaveLength(1);
      assertValidVerification(results[0]);
      expect(results[0].changed).toBe(false);
    });
  });
});
