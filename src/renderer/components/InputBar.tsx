import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TIERS, DEFAULT_TIER, type Tier } from '../../shared/models';
import type { MessageAttachment } from '../../shared/types';

interface InputBarProps {
  onSend: (message: string, attachments?: MessageAttachment[], tier?: string) => void;
  isStreaming: boolean;
  onStop: () => void;
  disabled?: boolean;
  onOpenSettings?: () => void;
  onToggleHistory?: () => void;
  historyOpen?: boolean;
  onToggleTerminal?: () => void;
  terminalOpen?: boolean;
  onToggleDocs?: () => void;
  docsOpen?: boolean;
  onToggleFiles?: () => void;
  filesOpen?: boolean;
}

const LARGE_PASTE_CHAR_THRESHOLD = 2000;
const LARGE_PASTE_LINE_THRESHOLD = 50;

export default function InputBar({
  onSend,
  isStreaming,
  onStop,
  disabled = false,
  onOpenSettings,
  onToggleHistory,
  historyOpen = false,
  onToggleTerminal,
  terminalOpen = false,
  onToggleDocs,
  docsOpen = false,
  onToggleFiles,
  filesOpen = false,
}: InputBarProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const isTextLikeFile = useCallback((file: File) => {
    if (file.type.startsWith('text/')) return true;
    return /\.(txt|md|mdx|json|js|jsx|ts|tsx|css|html|xml|csv|yml|yaml|log)$/i.test(file.name);
  }, []);

  const readFileAsDataUrl = useCallback((file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  }), []);

  const readFileAsText = useCallback((file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  }), []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (disabled || isStreaming) return;
    textareaRef.current?.focus();
  }, [disabled, isStreaming]);

  // Load tier on mount
  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api) return;
    api?.settings.getTier().then((t: string) => {
      if (t === 'fast' || t === 'balanced' || t === 'deep') setTier(t as Tier);
    });
  }, []);

  // Prefill input from external event
  useEffect(() => {
    const handler = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail;
      setText(cmd + ' ');
      textareaRef.current?.focus();
    };
    window.addEventListener('clawdia:prefill-input', handler);
    return () => window.removeEventListener('clawdia:prefill-input', handler);
  }, []);

  const handleSend = useCallback(() => {
    if (disabled) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments, tier);
    setText('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [text, attachments, onSend, disabled, tier]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape' && isStreaming) { onStop(); }
  }, [handleSend, isStreaming, onStop]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 280) + 'px';
  }, []);

  const handlePickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));

    if (imageItems.length > 0) {
      e.preventDefault();
      const nextAttachments = await Promise.all(imageItems.map(async (item) => {
        const file = item.getAsFile();
        if (!file) return null;
        const dataUrl = await readFileAsDataUrl(file);
        const ext = item.type.replace('image/', '') || 'png';
        const attachment: MessageAttachment = {
          id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'image',
          name: `pasted-image.${ext}`,
          size: file.size,
          mimeType: item.type,
          dataUrl,
        };
        return attachment;
      }));
      const valid = nextAttachments.filter((a): a is MessageAttachment => a !== null);
      if (valid.length > 0) setAttachments(prev => [...prev, ...valid]);
      return;
    }

    const pastedText = e.clipboardData.getData('text/plain');
    if (!pastedText) return;
    const lineCount = pastedText.split('\n').length;
    const isLarge = pastedText.length > LARGE_PASTE_CHAR_THRESHOLD || lineCount > LARGE_PASTE_LINE_THRESHOLD;
    if (isLarge) {
      e.preventDefault();
      const attachment: MessageAttachment = {
        id: `paste-txt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'file',
        name: 'Pasted text.txt',
        size: new Blob([pastedText]).size,
        mimeType: 'text/plain',
        textContent: pastedText,
      };
      setAttachments(prev => [...prev, attachment]);
    }
  }, [readFileAsDataUrl]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  const handleFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const nextAttachments = await Promise.all(files.map(async (file) => {
      const isImage = file.type.startsWith('image/');
      const attachment: MessageAttachment = {
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        kind: isImage ? 'image' : 'file',
        name: file.name,
        size: file.size,
        mimeType: file.type || (isImage ? 'image/png' : 'application/octet-stream'),
        path: (file as File & { path?: string }).path,
      };
      if (isImage) {
        attachment.dataUrl = await readFileAsDataUrl(file);
      } else if (file.size <= 512_000 && isTextLikeFile(file)) {
        const textContent = await readFileAsText(file);
        attachment.textContent = textContent.slice(0, 12_000);
      }
      return attachment;
    }));
    setAttachments((prev) => [...prev, ...nextAttachments]);
    e.target.value = '';
  }, [isTextLikeFile, readFileAsDataUrl, readFileAsText]);

  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <div
      className={`w-full px-0 pb-0 pt-0${disabled ? ' opacity-50 pointer-events-none' : ''}`}
      style={{ background: '#131313', borderTop: 'none' }}
      onPaste={handlePaste}
    >
      <div className="relative flex w-full flex-col transition-all duration-200 bg-[#131313]">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.mdx,.json,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
          className="hidden"
          onChange={handleFilesSelected}
        />
        {attachments.length > 0 && (
          <div className="px-3 pt-3 pb-1 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className={`group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] ${
                  attachment.kind === 'image' ? 'w-[132px]' : 'max-w-[220px] px-3 py-2.5'
                }`}
              >
                {attachment.kind === 'image' && attachment.dataUrl ? (
                  <>
                    <img src={attachment.dataUrl} alt={attachment.name} className="block w-full h-[92px] object-cover" />
                    <div className="px-2.5 py-2">
                      <div className="text-[11px] text-text-primary truncate">{attachment.name}</div>
                      <div className="mt-0.5 text-[10px] text-text-muted">{formatBytes(attachment.size)}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="pr-5 text-[12px] text-text-primary truncate">{attachment.name}</div>
                    <div className="mt-1 text-[11px] text-text-muted">{formatBytes(attachment.size)}</div>
                  </>
                )}
                <button
                  onClick={() => handleRemoveAttachment(attachment.id)}
                  title="Remove attachment"
                  className="absolute top-1.5 right-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-black/45 text-white/70 hover:text-white hover:bg-black/65 transition-all cursor-pointer"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Top half: textarea + controls */}
        <div className="flex items-center gap-2 px-4 py-5">
          {/* Attach */}
          <button
            onClick={handlePickFiles}
            disabled={isStreaming}
            title="Attach file"
            className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md transition-all text-[18px] font-light no-drag ${
              isStreaming ? 'text-text-tertiary/35 cursor-default' : 'text-[#aaaaaa] hover:text-white hover:bg-white/[0.08] cursor-pointer'
            }`}
          >
            +
          </button>

          {/* Textarea */}
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? 'Waiting for response...' : 'Ask me anything...'}
              rows={1}
              disabled={disabled || isStreaming}
              className="w-full bg-transparent text-text-primary text-[18px] placeholder:text-[#888888] resize-none outline-none max-h-[280px] leading-[1.6]"
            />
          </div>

          {/* Send / Stop */}
          <div className="flex items-center gap-2 flex-shrink-0 no-drag">
            {isStreaming ? (
              <button
                onClick={onStop}
                title="Stop (Esc)"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.08] text-white/60 hover:bg-white/[0.14] hover:text-white transition-all cursor-pointer"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                title="Send (Enter)"
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer ${
                  canSend ? 'bg-white text-black hover:bg-white/90 shadow-sm shadow-black/20' : 'bg-white/[0.15] text-white/50 cursor-default'
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="19 12 12 5 5 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="mx-0 h-px bg-white/[0.07]" />

        {/* Bottom footer */}
        <div className="flex items-center px-4 py-2" style={{ background: '#171717', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="w-[120px]" />

          {/* Center: panel toggles */}
          <div className="flex flex-1 items-center justify-center gap-1">
            <button
              onClick={onToggleHistory}
              className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
                historyOpen ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
              }`}
            >
              History
            </button>
            <button
              onClick={onToggleTerminal}
              className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
                terminalOpen ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
              }`}
            >
              Terminal
            </button>
            <button
              onClick={onToggleDocs}
              className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
                docsOpen ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
              }`}
            >
              Docs
            </button>
            <button
              onClick={onToggleFiles}
              className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
                filesOpen ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
              }`}
            >
              Files
            </button>
            <div className="flex items-center gap-1">
              {(['fast', 'balanced', 'deep'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setTier(t); (window as any).clawdia?.settings.setTier(t); }}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium uppercase tracking-[0.08em] transition-all cursor-pointer ${
                    tier === t ? 'text-text-secondary bg-white/[0.07]' : 'text-white/[0.32] hover:text-text-muted hover:bg-white/[0.04]'
                  }`}
                >
                  {TIERS[t].label}
                </button>
              ))}
            </div>
          </div>

          {/* Right: settings gear */}
          <div className="w-[120px] flex items-center justify-end">
            <button
              onClick={onOpenSettings}
              title="Settings"
              className="flex items-center justify-center w-6 h-6 rounded-md text-text-muted hover:text-text-secondary hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
