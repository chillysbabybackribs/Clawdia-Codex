/**
 * Lightweight OS state verification.
 *
 * Verifies window focus and process state after OS-level actions.
 * Uses the same xdotool/pgrep tools the OS MCP server relies on.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { VerificationResult } from '../../shared/types';

const execFileAsync = promisify(execFile);

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 5_000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

/** Verify that a specific window is focused (by title substring or window ID). */
export async function verifyWindowFocused(expectedTitle: string): Promise<VerificationResult> {
  try {
    const activeTitle = await run('xdotool', ['getactivewindow', 'getwindowname']);
    const matches = activeTitle.toLowerCase().includes(expectedTitle.toLowerCase());
    return {
      kind: 'os:window_focused',
      target: expectedTitle,
      changed: null, // presence check, not a diff
      after: activeTitle || '(no active window)',
      confidence: matches ? 'high' : 'medium',
      note: matches ? 'focused' : `active window: "${activeTitle}"`,
      timestampMs: Date.now(),
    };
  } catch {
    return {
      kind: 'os:window_focused',
      target: expectedTitle,
      changed: null,
      confidence: 'low',
      note: 'failed to check active window',
      timestampMs: Date.now(),
    };
  }
}

/** Verify that a process is running (by name). */
export async function verifyProcessRunning(processName: string): Promise<VerificationResult> {
  try {
    const output = await run('pgrep', ['-f', processName]);
    const running = output.length > 0;
    return {
      kind: 'os:process_running',
      target: processName,
      changed: null,
      after: running ? 'running' : 'not running',
      confidence: 'high',
      note: running ? `PID: ${output.split('\n')[0]}` : undefined,
      timestampMs: Date.now(),
    };
  } catch {
    return {
      kind: 'os:process_running',
      target: processName,
      changed: null,
      after: 'not running',
      confidence: 'medium',
      note: 'pgrep returned no results',
      timestampMs: Date.now(),
    };
  }
}
