import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, MessageAttachment } from '../../shared/types';
import InputBar from './InputBar';
import MarkdownRenderer from './MarkdownRenderer';
import TabStrip from './TabStrip';
import { ToolBlock as ToolBlockComponent, VerificationBlock } from './ToolActivity';
import type { ToolCall, VerificationResult } from '../../shared/types';
import type { ConversationTab } from '../tabLogic';

interface ChatPanelProps {
  tabId: string;
  loadConversationId?: string | null;
  browserVisible: boolean;
  onToggleBrowser: () => void;
  onOpenSettings: () => void;
  tabs: ConversationTab[];
  activeTabId: string;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSwitchTab: (tabId: string) => void;
  onReorderTabs: (fromIndex: number, toIndex: number) => void;
  onOpenConversation: (id: string) => void;
  onConversationMetaResolved: (
    tabId: string,
    patch: Partial<ConversationTab>,
  ) => void;
  onToggleTerminal?: () => void;
  terminalOpen?: boolean;
  onToggleDocs?: () => void;
  docsOpen?: boolean;
  onToggleFiles?: () => void;
  filesOpen?: boolean;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentGallery({ attachments }: { attachments: MessageAttachment[] }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => a.kind === 'image' && a.dataUrl);
  const files = attachments.filter((a) => a.kind !== 'image' || !a.dataUrl);

  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <div className="flex flex-col gap-2">
          {images.map((attachment) => (
            <div
              key={attachment.id}
              className="overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.03] max-w-[420px]"
            >
              <img src={attachment.dataUrl} alt={attachment.name} className="block w-full max-h-[320px] object-cover" />
              <div className="px-3 py-2.5 border-t border-white/[0.06]">
                <div className="text-[12px] text-text-primary truncate">{attachment.name}</div>
                <div className="mt-0.5 text-[11px] text-text-secondary/80">{formatAttachmentSize(attachment.size)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          {files.map((attachment) => (
            <div
              key={attachment.id}
              className="rounded-xl border border-white/[0.10] bg-white/[0.03] px-3 py-2.5 max-w-[420px]"
            >
              <div className="text-[12px] text-text-primary break-all">{attachment.name}</div>
              <div className="mt-0.5 text-[11px] text-text-secondary/80">{formatAttachmentSize(attachment.size)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Copy button with checkmark feedback */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [text]);

  return (
    <button
      onClick={() => { void handleCopy(); }}
      title="Copy message"
      className="flex items-center justify-center w-5 h-5 transition-all duration-150 cursor-pointer hover:text-white text-text-muted/0 group-hover:text-text-muted/50"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-status-success">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function RetryButton({ messageContent }: { messageContent: string }) {
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent('clawdia:prefill-input', { detail: messageContent }));
  };

  return (
    <button
      onClick={handleClick}
      title="Edit and resend"
      className="flex items-center justify-center w-5 h-5 transition-all duration-150 cursor-pointer hover:text-white text-text-muted/0 group-hover:text-text-muted/50"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 0 1 15.3-6.3L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.3 6.3L3 16" />
        <path d="M8 16H3v5" />
      </svg>
    </button>
  );
}

const AssistantMessage = React.memo(function AssistantMessage({
  message,
}: {
  message: Message;
}) {
  const blocks = message.contentBlocks;

  // Fallback for legacy messages without content blocks
  if (!blocks || blocks.length === 0) {
    return (
      <div className="assistant-message flex justify-start animate-slide-up group">
        <div className="assistant-message-body max-w-[92%] px-1 py-2 text-text-primary">
          <div className={`stream-response-container ${message.isStreaming ? 'is-streaming' : 'is-complete'}`}>
            <MarkdownRenderer content={message.content} isStreaming={message.isStreaming} />
          </div>
          <div className="mt-1 flex items-center gap-1">
            {!message.isStreaming && message.content && <CopyButton text={message.content} />}
            <span className="text-[11px] text-text-secondary/70">{message.timestamp}</span>
          </div>
        </div>
      </div>
    );
  }

  const lastTextBlockIdx = blocks.reduce(
    (acc, b, i) => (b.type === 'text' ? i : acc), -1,
  );

  return (
    <div className="assistant-message flex justify-start animate-slide-up group">
      <div className="assistant-message-body max-w-[92%] px-1 py-2 text-text-primary">
        <div className={`stream-response-container ${message.isStreaming ? 'is-streaming' : 'is-complete'}`}>
          {blocks.map((block, i) => {
            if (block.type === 'text') {
              const isLastTextAndStreaming = message.isStreaming && i === lastTextBlockIdx;
              return (
                <div key={`text-${i}`}>
                  <MarkdownRenderer
                    content={block.content}
                    isStreaming={isLastTextAndStreaming}
                  />
                </div>
              );
            }
            if (block.type === 'verification') {
              return (
                <div key={`verify-${i}`} className="my-0.5">
                  <VerificationBlock result={block.result} />
                </div>
              );
            }
            // tool block
            return (
              <div key={block.tool.id} className="my-1">
                <ToolBlockComponent tool={block.tool} />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex items-center gap-1">
          {!message.isStreaming && message.content && <CopyButton text={message.content} />}
          <span className="text-[11px] text-text-secondary/70">{message.timestamp}</span>
        </div>
      </div>
    </div>
  );
});

export default function ChatPanel({
  tabId,
  loadConversationId,
  browserVisible,
  onToggleBrowser,
  onOpenSettings,
  tabs,
  activeTabId,
  onNewTab,
  onCloseTab,
  onSwitchTab,
  onReorderTabs,
  onOpenConversation,
  onConversationMetaResolved,
  onToggleTerminal,
  terminalOpen = false,
  onToggleDocs,
  docsOpen = false,
  onToggleFiles,
  filesOpen = false,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(loadConversationId ?? null);
  const [historyMode, setHistoryMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingMsgRef = useRef<Message | null>(null);
  const conversationIdRef = useRef(conversationId);
  const activeRunIdRef = useRef<string | null>(null);

  conversationIdRef.current = conversationId;

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // ResizeObserver-based auto-scroll
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 120;
      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    });

    // Observe the inner content
    const inner = container.firstElementChild;
    if (inner) observer.observe(inner);

    return () => observer.disconnect();
  }, []);

  // Load conversation from DB
  useEffect(() => {
    if (!loadConversationId) return;
    setConversationId(loadConversationId);
    const api = (window as any).clawdia;
    if (!api) return;

    api.chat.load(loadConversationId).then((msgs: Message[]) => {
      setMessages(msgs || []);
      setTimeout(scrollToBottom, 50);
    }).catch((err: any) => {
      console.error('Failed to load conversation:', err);
    });
  }, [loadConversationId, scrollToBottom]);

  // Subscribe to streaming events
  useEffect(() => {
    const api = (window as any).clawdia?.chat;
    if (!api) return;

    const unsubText = api.onStreamText((payload: { delta: string; conversationId: string }) => {
      if (payload.conversationId !== conversationIdRef.current) return;

      setIsStreaming(true);

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.isStreaming) {
          const blocks = [...(last.contentBlocks || [])];
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock?.type === 'text') {
            blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + payload.delta };
          } else {
            blocks.push({ type: 'text', content: payload.delta });
          }
          const updated = {
            ...last,
            content: last.content + payload.delta,
            contentBlocks: blocks,
          };
          streamingMsgRef.current = updated;
          return [...prev.slice(0, -1), updated];
        }
        // New assistant message
        const newMsg: Message = {
          id: `stream-${Date.now()}`,
          role: 'assistant',
          content: payload.delta,
          contentBlocks: [{ type: 'text', content: payload.delta }],
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          isStreaming: true,
        };
        streamingMsgRef.current = newMsg;
        return [...prev, newMsg];
      });
    });

    const unsubEnd = api.onStreamEnd((data: any) => {
      if (data?.conversationId && data.conversationId !== conversationIdRef.current) return;
      // Mark streaming message as complete (Codex process sent its final text)
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.isStreaming) {
          return [...prev.slice(0, -1), { ...last, isStreaming: false }];
        }
        return prev;
      });
    });

    // Explicit run lifecycle — terminal state
    const unsubRunEnd = api.onRunEnd?.((payload: { runId: string; conversationId: string; status: string; error?: string }) => {
      if (payload.conversationId !== conversationIdRef.current) return;
      // Only act if this is the active run
      if (activeRunIdRef.current && payload.runId !== activeRunIdRef.current) return;

      activeRunIdRef.current = null;
      setIsStreaming(false);
      streamingMsgRef.current = null;

      // Finalize any still-streaming message
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.isStreaming) {
          return [...prev.slice(0, -1), { ...last, isStreaming: false }];
        }
        return prev;
      });

      // Show error/cancellation detail
      if (payload.status === 'failed' && payload.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant' as const,
            content: `**Error:** ${payload.error}`,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          },
        ]);
      }
    });

    const unsubTool = api.onToolActivity?.((payload: ToolCall & { conversationId: string }) => {
      if (payload.conversationId !== conversationIdRef.current) return;

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;

        const blocks = [...(last.contentBlocks || [])];
        const existingIdx = blocks.findIndex(
          (b) => b.type === 'tool' && b.tool.id === payload.id,
        );
        if (existingIdx >= 0) {
          blocks[existingIdx] = { type: 'tool', tool: payload };
        } else {
          blocks.push({ type: 'tool', tool: payload });
        }
        const updated = { ...last, contentBlocks: blocks };
        streamingMsgRef.current = last.isStreaming ? updated : streamingMsgRef.current;
        return [...prev.slice(0, -1), updated];
      });
    });

    const unsubVerification = api.onVerification?.((payload: VerificationResult & { conversationId: string }) => {
      if (payload.conversationId !== conversationIdRef.current) return;

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;

        const blocks = [...(last.contentBlocks || [])];
        blocks.push({ type: 'verification', result: payload });
        const updated = { ...last, contentBlocks: blocks };
        streamingMsgRef.current = last.isStreaming ? updated : streamingMsgRef.current;
        return [...prev.slice(0, -1), updated];
      });
    });

    const unsubTitle = api.onTitleUpdated?.((payload: { conversationId: string; title: string }) => {
      if (payload.conversationId !== conversationIdRef.current) return;
      onConversationMetaResolved(tabId, { title: payload.title });
    });

    return () => {
      unsubText?.();
      unsubEnd?.();
      unsubRunEnd?.();
      unsubTool?.();
      unsubVerification?.();
      unsubTitle?.();
    };
  }, [tabId, onConversationMetaResolved]);

  const handleSend = useCallback(async (
    text: string,
    attachments?: MessageAttachment[],
    tier?: string,
  ) => {
    const api = (window as any).clawdia;
    if (!api) return;

    // Ensure conversationId exists BEFORE send so streaming events match immediately
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      activeConversationId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setConversationId(activeConversationId);
      conversationIdRef.current = activeConversationId;
      onConversationMetaResolved(tabId, { conversationId: activeConversationId });
    }

    // Add user message to UI
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      attachments,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setTimeout(scrollToBottom, 50);

    try {
      // chat.send now returns immediately with { ok, conversationId, runId }
      const result = await api.chat.send(text, attachments, activeConversationId, tier);
      if (result?.runId) {
        activeRunIdRef.current = result.runId;
      }
      // Streaming state and terminal state are handled by onRunEnd — not here
    } catch (err) {
      console.error('Send failed:', err);
      setIsStreaming(false);
      activeRunIdRef.current = null;
    }
  }, [conversationId, tabId, onConversationMetaResolved, scrollToBottom]);

  const handleStop = useCallback(() => {
    const api = (window as any).clawdia;
    if (!api || !activeRunIdRef.current) return;
    api.chat.stop(activeRunIdRef.current);
  }, []);

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="flex flex-col h-full w-full bg-surface-0" style={{ background: '#000000' }}>
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ scrollBehavior: 'smooth' }}
      >
        <div className="mx-auto max-w-[780px]">
          {isEmpty && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
              <div className="text-[24px] font-bold text-text-primary/20 tracking-tight mb-2">Clawdia 8</div>
              <div className="text-[14px] text-text-muted/50">Start a conversation to get going.</div>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex justify-end mb-4 animate-slide-up group">
                  <div className="max-w-[85%]">
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mb-2">
                        <AttachmentGallery attachments={msg.attachments} />
                      </div>
                    )}
                    <div className="rounded-2xl px-4 py-3 text-[15px] leading-relaxed text-text-primary"
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      {msg.content}
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-1">
                      <RetryButton messageContent={msg.content} />
                      <CopyButton text={msg.content} />
                      <span className="text-[11px] text-text-secondary/70">{msg.timestamp}</span>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="mb-4">
                <AssistantMessage message={msg} />
              </div>
            );
          })}

          {/* Streaming shimmer when waiting for first token */}
          {isStreaming && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex justify-start mb-4">
              <div className="max-w-[92%] px-1 py-2">
                <div className="flex items-center gap-3">
                  <div className="thinking-shimmer-line h-[2px] w-[200px] rounded-full" />
                  <span className="inline-shimmer text-[13px]">Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Tab strip — connected to top of input area */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', background: '#131313', boxShadow: '0 -2px 8px rgba(0,0,0,0.45)' }}>
        <TabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onSwitch={onSwitchTab}
          onClose={onCloseTab}
          onNew={onNewTab}
          onReorder={onReorderTabs}
        />
      </div>

      {/* Input bar */}
      <InputBar
        onSend={handleSend}
        isStreaming={isStreaming}
        onStop={handleStop}
        onOpenSettings={onOpenSettings}
        onToggleHistory={() => setHistoryMode((v) => !v)}
        historyOpen={historyMode}
        onToggleTerminal={onToggleTerminal}
        terminalOpen={terminalOpen}
        onToggleDocs={onToggleDocs}
        docsOpen={docsOpen}
        onToggleFiles={onToggleFiles}
        filesOpen={filesOpen}
      />
    </div>
  );
}
