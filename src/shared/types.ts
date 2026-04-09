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

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface ToolContentBlock {
  type: 'tool';
  tool: ToolCall;
}

export type ContentBlock = TextBlock | ToolContentBlock;

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
