/**
 * Lightweight filesystem state verification.
 *
 * Captures file/directory metadata snapshots and compares before/after
 * to determine whether a meaningful change occurred.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { VerificationResult } from '../../shared/types';

export interface FsSnapshot {
  path: string;
  exists: boolean;
  size: number | null;
  mtimeMs: number | null;
  contentHash: string | null; // sha256 of first 64KB
  timestampMs: number;
}

export interface DirSnapshot {
  path: string;
  exists: boolean;
  entries: string[] | null;
  timestampMs: number;
}

const HASH_LIMIT = 64 * 1024; // only hash first 64KB

/** Capture a file metadata snapshot. Cheap — no full read for large files. */
export function captureFileSnapshot(filePath: string): FsSnapshot {
  try {
    const stat = fs.statSync(filePath);
    let contentHash: string | null = null;
    if (stat.isFile() && stat.size <= HASH_LIMIT) {
      const content = fs.readFileSync(filePath);
      contentHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    } else if (stat.isFile()) {
      // Hash only first 64KB for large files
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(HASH_LIMIT);
      fs.readSync(fd, buf, 0, HASH_LIMIT, 0);
      fs.closeSync(fd);
      contentHash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    }
    return {
      path: filePath,
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      contentHash,
      timestampMs: Date.now(),
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      size: null,
      mtimeMs: null,
      contentHash: null,
      timestampMs: Date.now(),
    };
  }
}

/** Capture a directory listing snapshot. */
export function captureDirSnapshot(dirPath: string): DirSnapshot {
  try {
    const entries = fs.readdirSync(dirPath).sort();
    return { path: dirPath, exists: true, entries, timestampMs: Date.now() };
  } catch {
    return { path: dirPath, exists: false, entries: null, timestampMs: Date.now() };
  }
}

/** Verify file existence changed. */
export function verifyFileExists(before: FsSnapshot, after: FsSnapshot): VerificationResult {
  const created = !before.exists && after.exists;
  const deleted = before.exists && !after.exists;
  return {
    kind: 'fs:exists',
    target: after.path,
    changed: created || deleted,
    before: before.exists ? 'exists' : 'absent',
    after: after.exists ? 'exists' : 'absent',
    confidence: 'high',
    note: created ? 'created' : deleted ? 'deleted' : undefined,
    timestampMs: after.timestampMs,
  };
}

/** Verify file was modified (mtime or content hash changed). */
export function verifyFileModified(before: FsSnapshot, after: FsSnapshot): VerificationResult {
  if (!before.exists || !after.exists) {
    return {
      kind: 'fs:modified',
      target: after.path,
      changed: null,
      confidence: 'low',
      note: !after.exists ? 'file does not exist' : 'file did not exist before',
      timestampMs: after.timestampMs,
    };
  }
  const hashChanged = before.contentHash !== after.contentHash;
  const mtimeChanged = before.mtimeMs !== after.mtimeMs;
  const sizeChanged = before.size !== after.size;
  return {
    kind: 'fs:modified',
    target: after.path,
    changed: hashChanged || sizeChanged,
    before: `${before.size}B mtime=${before.mtimeMs}`,
    after: `${after.size}B mtime=${after.mtimeMs}`,
    confidence: hashChanged ? 'high' : mtimeChanged ? 'medium' : 'high',
    note: hashChanged ? 'content changed' : sizeChanged ? 'size changed' : undefined,
    timestampMs: after.timestampMs,
  };
}

/** Verify file content hash changed. */
export function verifyContentHash(before: FsSnapshot, after: FsSnapshot): VerificationResult {
  if (!before.contentHash || !after.contentHash) {
    return {
      kind: 'fs:content_hash',
      target: after.path,
      changed: null,
      confidence: 'low',
      note: 'hash unavailable',
      timestampMs: after.timestampMs,
    };
  }
  return {
    kind: 'fs:content_hash',
    target: after.path,
    changed: before.contentHash !== after.contentHash,
    before: before.contentHash,
    after: after.contentHash,
    confidence: 'high',
    timestampMs: after.timestampMs,
  };
}

/** Verify directory contents changed. */
export function verifyDirContents(before: DirSnapshot, after: DirSnapshot): VerificationResult {
  if (!before.exists && !after.exists) {
    return {
      kind: 'fs:dir_contents',
      target: after.path,
      changed: false,
      confidence: 'high',
      note: 'directory does not exist',
      timestampMs: after.timestampMs,
    };
  }
  if (!before.entries || !after.entries) {
    return {
      kind: 'fs:dir_contents',
      target: after.path,
      changed: null,
      confidence: 'low',
      note: 'could not list directory',
      timestampMs: after.timestampMs,
    };
  }
  const beforeSet = new Set(before.entries);
  const afterSet = new Set(after.entries);
  const added = after.entries.filter(e => !beforeSet.has(e));
  const removed = before.entries.filter(e => !afterSet.has(e));
  const changed = added.length > 0 || removed.length > 0;
  return {
    kind: 'fs:dir_contents',
    target: after.path,
    changed,
    before: `${before.entries.length} entries`,
    after: `${after.entries.length} entries`,
    confidence: 'high',
    note: changed
      ? `+${added.length} -${removed.length}`
      : undefined,
    timestampMs: after.timestampMs,
  };
}

/** Compare two file snapshots and return all meaningful verifications. */
export function diffFileSnapshots(before: FsSnapshot, after: FsSnapshot): VerificationResult[] {
  const results: VerificationResult[] = [];
  const existsResult = verifyFileExists(before, after);
  if (existsResult.changed) {
    results.push(existsResult);
    return results; // if created or deleted, that's the whole story
  }
  const modResult = verifyFileModified(before, after);
  results.push(modResult);
  return results;
}
