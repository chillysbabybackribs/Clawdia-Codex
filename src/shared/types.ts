export interface MessageAttachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  size: number;
  mimeType: string;
  path?: string;
  dataUrl?: string;
  textContent?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contentBlocks?: ContentBlock[];
  timestamp: string;
  attachments?: MessageAttachment[];
  isStreaming?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
  input?: string;
  output?: string;
  durationMs?: number;
}

// ── IPC event names — shared with tests for anti-staleness ───────────────────

export const IPC_EVENT_NAMES = {
  CHAT_STREAM_TEXT: 'chat:stream:text',
  CHAT_STREAM_END: 'chat:stream:end',
  CHAT_RUN_START: 'chat:run:start',
  CHAT_RUN_END: 'chat:run:end',
  CHAT_TITLE_UPDATED: 'chat:title-updated',
  CHAT_TOOL_ACTIVITY: 'chat:tool-activity',
  CHAT_VERIFICATION: 'chat:verification',
  CHAT_RESUME_FAILED: 'chat:resume:failed',
} as const;

// ── Run lifecycle ────────────────────────────────────────────────────────────

/** All valid run statuses — shared between production code and tests. */
export const RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled', 'interrupted'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

// ── Verification ─────────────────────────────────────────────────────────────

/** The kinds of verification the system can perform. Extend this union to add new kinds. */
export type VerificationKind =
  | 'browser:url'
  | 'browser:title'
  | 'browser:text_present'
  | 'browser:selector_present'
  | 'fs:exists'
  | 'fs:modified'
  | 'fs:content_hash'
  | 'fs:dir_contents'
  | 'os:window_focused'
  | 'os:process_running';

/** Confidence in the verification result. */
export type VerificationConfidence = 'high' | 'medium' | 'low';

/** The outcome of a single verification check. */
export interface VerificationResult {
  kind: VerificationKind;
  target: string;
  changed: boolean | null; // null = indeterminate
  before?: string;
  after?: string;
  confidence: VerificationConfidence;
  note?: string;
  timestampMs: number;
}

/** All valid verification kinds — used by both production code and tests for anti-staleness. */
export const VERIFICATION_KINDS: readonly VerificationKind[] = [
  'browser:url',
  'browser:title',
  'browser:text_present',
  'browser:selector_present',
  'fs:exists',
  'fs:modified',
  'fs:content_hash',
  'fs:dir_contents',
  'os:window_focused',
  'os:process_running',
] as const;

/** All valid tool call statuses — shared between production and tests. */
export const TOOL_CALL_STATUSES = ['running', 'success', 'error'] as const;

export interface VerificationContentBlock {
  type: 'verification';
  result: VerificationResult;
}

// ── Content blocks ───────────────────────────────────────────────────────────

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface ToolContentBlock {
  type: 'tool';
  tool: ToolCall;
}

export type ContentBlock = TextBlock | ToolContentBlock | VerificationContentBlock;

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messageCount?: number;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  active: boolean;
}
