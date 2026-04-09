/**
 * Tests for filesystem verification module.
 *
 * Uses real temp files to test the actual fs operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  captureFileSnapshot,
  captureDirSnapshot,
  verifyFileExists,
  verifyFileModified,
  verifyContentHash,
  verifyDirContents,
  diffFileSnapshots,
} from '../src/main/verification/fsVerify';
import { assertValidVerification } from './helpers/contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawdia-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('fsVerify', () => {
  describe('captureFileSnapshot', () => {
    it('captures existing file metadata', () => {
      const filePath = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(filePath, 'hello world');
      const snap = captureFileSnapshot(filePath);
      expect(snap.exists).toBe(true);
      expect(snap.size).toBe(11);
      expect(snap.mtimeMs).toBeGreaterThan(0);
      expect(snap.contentHash).toBeTruthy();
      expect(snap.path).toBe(filePath);
    });

    it('captures non-existent file as absent', () => {
      const snap = captureFileSnapshot(path.join(tmpDir, 'nope.txt'));
      expect(snap.exists).toBe(false);
      expect(snap.size).toBeNull();
      expect(snap.contentHash).toBeNull();
    });
  });

  describe('captureDirSnapshot', () => {
    it('captures directory listing', () => {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), '');
      fs.writeFileSync(path.join(tmpDir, 'b.txt'), '');
      const snap = captureDirSnapshot(tmpDir);
      expect(snap.exists).toBe(true);
      expect(snap.entries).toContain('a.txt');
      expect(snap.entries).toContain('b.txt');
    });

    it('captures non-existent directory', () => {
      const snap = captureDirSnapshot(path.join(tmpDir, 'nope'));
      expect(snap.exists).toBe(false);
      expect(snap.entries).toBeNull();
    });
  });

  describe('verifyFileExists', () => {
    it('detects file creation', () => {
      const filePath = path.join(tmpDir, 'new.txt');
      const before = captureFileSnapshot(filePath);
      fs.writeFileSync(filePath, 'created');
      const after = captureFileSnapshot(filePath);
      const result = verifyFileExists(before, after);
      assertValidVerification(result);
      expect(result.kind).toBe('fs:exists');
      expect(result.changed).toBe(true);
      expect(result.before).toBe('absent');
      expect(result.after).toBe('exists');
      expect(result.note).toBe('created');
    });

    it('detects file deletion', () => {
      const filePath = path.join(tmpDir, 'gone.txt');
      fs.writeFileSync(filePath, 'temp');
      const before = captureFileSnapshot(filePath);
      fs.unlinkSync(filePath);
      const after = captureFileSnapshot(filePath);
      const result = verifyFileExists(before, after);
      assertValidVerification(result);
      expect(result.changed).toBe(true);
      expect(result.note).toBe('deleted');
    });

    it('detects no change when file persists', () => {
      const filePath = path.join(tmpDir, 'stable.txt');
      fs.writeFileSync(filePath, 'stable');
      const before = captureFileSnapshot(filePath);
      const after = captureFileSnapshot(filePath);
      const result = verifyFileExists(before, after);
      assertValidVerification(result);
      expect(result.changed).toBe(false);
    });
  });

  describe('verifyFileModified', () => {
    it('detects content modification', () => {
      const filePath = path.join(tmpDir, 'mod.txt');
      fs.writeFileSync(filePath, 'original');
      const before = captureFileSnapshot(filePath);
      fs.writeFileSync(filePath, 'modified content');
      const after = captureFileSnapshot(filePath);
      const result = verifyFileModified(before, after);
      assertValidVerification(result);
      expect(result.kind).toBe('fs:modified');
      expect(result.changed).toBe(true);
    });

    it('detects no modification for unchanged file', () => {
      const filePath = path.join(tmpDir, 'same.txt');
      fs.writeFileSync(filePath, 'same');
      const snap = captureFileSnapshot(filePath);
      const result = verifyFileModified(snap, snap);
      assertValidVerification(result);
      expect(result.changed).toBe(false);
    });

    it('handles missing file with low confidence', () => {
      const filePath = path.join(tmpDir, 'missing.txt');
      const before = captureFileSnapshot(filePath);
      const after = captureFileSnapshot(filePath);
      const result = verifyFileModified(before, after);
      assertValidVerification(result);
      expect(result.changed).toBeNull();
      expect(result.confidence).toBe('low');
    });
  });

  describe('verifyContentHash', () => {
    it('detects hash change', () => {
      const filePath = path.join(tmpDir, 'hash.txt');
      fs.writeFileSync(filePath, 'v1');
      const before = captureFileSnapshot(filePath);
      fs.writeFileSync(filePath, 'v2');
      const after = captureFileSnapshot(filePath);
      const result = verifyContentHash(before, after);
      assertValidVerification(result);
      expect(result.kind).toBe('fs:content_hash');
      expect(result.changed).toBe(true);
      expect(result.before).not.toBe(result.after);
    });

    it('handles missing hash gracefully', () => {
      const missing = captureFileSnapshot(path.join(tmpDir, 'nope'));
      const result = verifyContentHash(missing, missing);
      assertValidVerification(result);
      expect(result.changed).toBeNull();
      expect(result.confidence).toBe('low');
    });
  });

  describe('verifyDirContents', () => {
    it('detects added file in directory', () => {
      const before = captureDirSnapshot(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'new.txt'), '');
      const after = captureDirSnapshot(tmpDir);
      const result = verifyDirContents(before, after);
      assertValidVerification(result);
      expect(result.kind).toBe('fs:dir_contents');
      expect(result.changed).toBe(true);
      expect(result.note).toContain('+1');
    });

    it('detects removed file from directory', () => {
      fs.writeFileSync(path.join(tmpDir, 'will-delete.txt'), '');
      const before = captureDirSnapshot(tmpDir);
      fs.unlinkSync(path.join(tmpDir, 'will-delete.txt'));
      const after = captureDirSnapshot(tmpDir);
      const result = verifyDirContents(before, after);
      assertValidVerification(result);
      expect(result.changed).toBe(true);
      expect(result.note).toContain('-1');
    });

    it('detects no change in directory', () => {
      const snap = captureDirSnapshot(tmpDir);
      const result = verifyDirContents(snap, snap);
      assertValidVerification(result);
      expect(result.changed).toBe(false);
    });

    it('handles non-existent directory', () => {
      const noDir = captureDirSnapshot(path.join(tmpDir, 'nope'));
      const result = verifyDirContents(noDir, noDir);
      assertValidVerification(result);
      expect(result.changed).toBe(false);
    });
  });

  describe('diffFileSnapshots', () => {
    it('returns creation verification for new file', () => {
      const filePath = path.join(tmpDir, 'diff-new.txt');
      const before = captureFileSnapshot(filePath);
      fs.writeFileSync(filePath, 'new content');
      const after = captureFileSnapshot(filePath);
      const results = diffFileSnapshots(before, after);
      expect(results).toHaveLength(1);
      assertValidVerification(results[0]);
      expect(results[0].kind).toBe('fs:exists');
      expect(results[0].changed).toBe(true);
    });

    it('returns modification verification for changed file', () => {
      const filePath = path.join(tmpDir, 'diff-mod.txt');
      fs.writeFileSync(filePath, 'v1');
      const before = captureFileSnapshot(filePath);
      fs.writeFileSync(filePath, 'v2 longer');
      const after = captureFileSnapshot(filePath);
      const results = diffFileSnapshots(before, after);
      expect(results).toHaveLength(1);
      assertValidVerification(results[0]);
      expect(results[0].kind).toBe('fs:modified');
      expect(results[0].changed).toBe(true);
    });

    it('returns no-change for unchanged file', () => {
      const filePath = path.join(tmpDir, 'diff-same.txt');
      fs.writeFileSync(filePath, 'stable');
      const snap = captureFileSnapshot(filePath);
      const results = diffFileSnapshots(snap, snap);
      expect(results).toHaveLength(1);
      assertValidVerification(results[0]);
      expect(results[0].changed).toBe(false);
    });
  });
});
