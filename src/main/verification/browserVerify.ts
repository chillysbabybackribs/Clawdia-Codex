/**
 * Lightweight browser state verification.
 *
 * Captures compact browser state snapshots and compares before/after
 * to determine whether a meaningful change occurred.
 */

import type { VerificationResult, VerificationKind } from '../../shared/types';

export interface BrowserSnapshot {
  url: string;
  title: string;
  timestampMs: number;
}

/** Capture a minimal browser state snapshot from a WebContents-like object. */
export async function captureBrowserSnapshot(
  wc: { executeJavaScript: (code: string) => Promise<any>; getURL: () => string; getTitle: () => string },
): Promise<BrowserSnapshot> {
  return {
    url: wc.getURL(),
    title: wc.getTitle(),
    timestampMs: Date.now(),
  };
}

/** Verify that the URL changed between two snapshots. */
export function verifyUrlChanged(before: BrowserSnapshot, after: BrowserSnapshot): VerificationResult {
  return {
    kind: 'browser:url',
    target: after.url,
    changed: before.url !== after.url,
    before: before.url,
    after: after.url,
    confidence: 'high',
    timestampMs: after.timestampMs,
  };
}

/** Verify that the page title changed between two snapshots. */
export function verifyTitleChanged(before: BrowserSnapshot, after: BrowserSnapshot): VerificationResult {
  return {
    kind: 'browser:title',
    target: after.title,
    changed: before.title !== after.title,
    before: before.title,
    after: after.title,
    confidence: 'high',
    timestampMs: after.timestampMs,
  };
}

/** Verify that specific text is present on the page. */
export async function verifyTextPresent(
  wc: { executeJavaScript: (code: string) => Promise<any> },
  expectedText: string,
): Promise<VerificationResult> {
  try {
    const found: boolean = await wc.executeJavaScript(
      `document.body.innerText.includes(${JSON.stringify(expectedText)})`,
    );
    return {
      kind: 'browser:text_present',
      target: expectedText,
      changed: null, // presence check, not a diff
      after: found ? 'present' : 'absent',
      confidence: 'high',
      timestampMs: Date.now(),
    };
  } catch {
    return {
      kind: 'browser:text_present',
      target: expectedText,
      changed: null,
      confidence: 'low',
      note: 'failed to check text presence',
      timestampMs: Date.now(),
    };
  }
}

/** Verify that a CSS selector matches at least one element. */
export async function verifySelectorPresent(
  wc: { executeJavaScript: (code: string) => Promise<any> },
  selector: string,
): Promise<VerificationResult> {
  try {
    const found: boolean = await wc.executeJavaScript(
      `!!document.querySelector(${JSON.stringify(selector)})`,
    );
    return {
      kind: 'browser:selector_present',
      target: selector,
      changed: null,
      after: found ? 'present' : 'absent',
      confidence: 'high',
      timestampMs: Date.now(),
    };
  } catch {
    return {
      kind: 'browser:selector_present',
      target: selector,
      changed: null,
      confidence: 'low',
      note: 'failed to query selector',
      timestampMs: Date.now(),
    };
  }
}

/** Compare two snapshots and return all meaningful verifications. */
export function diffBrowserSnapshots(before: BrowserSnapshot, after: BrowserSnapshot): VerificationResult[] {
  const results: VerificationResult[] = [];
  const urlResult = verifyUrlChanged(before, after);
  if (urlResult.changed) results.push(urlResult);
  const titleResult = verifyTitleChanged(before, after);
  if (titleResult.changed) results.push(titleResult);
  // If nothing changed, push a single no-change result
  if (results.length === 0) {
    results.push({
      kind: 'browser:url',
      target: after.url,
      changed: false,
      before: before.url,
      after: after.url,
      confidence: 'high',
      timestampMs: after.timestampMs,
    });
  }
  return results;
}
