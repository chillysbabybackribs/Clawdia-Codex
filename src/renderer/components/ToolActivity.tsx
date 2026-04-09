import { useState, useCallback } from 'react';
import type { ToolCall, VerificationResult } from '../../shared/types';

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  shell_exec: 'Bash',
  bash: 'Bash',
  file_read: 'Read',
  file_write: 'Write',
  file_edit: 'Edit',
  file_list_directory: 'List',
  file_search: 'Search',
  directory_tree: 'List',
  browser_navigate: 'Navigate',
  browser_search: 'Search',
  browser_click: 'Click',
  browser_type: 'Type',
  browser_screenshot: 'Screenshot',
  browser_scroll: 'Scroll',
  browser_extract_text: 'Extract',
  browser_read_page: 'Read Page',
  codex_command_execution: 'Shell',
  codex_function_call: 'Tool Call',
  codex_mcp_tool_call: 'MCP',
};

function getDisplayName(name: string): string {
  return TOOL_DISPLAY_NAMES[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function tryParseJson(value: string): unknown | null {
  try { return JSON.parse(value); } catch { return null; }
}

function stringifyPreview(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyPreview).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 4)
      .map(([key, item]) => `${key}: ${stringifyPreview(item)}`)
      .join(' · ');
  }
  return String(value);
}

const PREVIEW_CHAR_LIMIT = 200;

function toSingleLinePreview(value: string, maxChars = PREVIEW_CHAR_LIMIT): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty)';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

/** Return true if the tool output is interesting enough to show inline. */
function hasSubstantiveOutput(tool: ToolCall): boolean {
  if (!tool.output) return false;
  const trimmed = tool.output.trim();
  // Skip trivial outputs
  if (!trimmed || trimmed === '{}' || trimmed === '{"ok":true,"data":{}}') return false;
  // Skip outputs that are just "ok" JSON wrappers with no real data
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.ok === true) {
      const dataStr = JSON.stringify(parsed.data ?? {});
      if (dataStr === '{}' || dataStr === '""') return false;
    }
  } catch { /* not JSON, that's fine — treat as substantive */ }
  return trimmed.length > 5;
}

function getCleanLabel(tool: ToolCall): string {
  const displayName = getDisplayName(tool.name);
  const input = tool.input ? tryParseJson(tool.input) : null;
  const args = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  if (!args) return displayName;

  switch (tool.name) {
    case 'shell_exec':
    case 'bash':
    case 'codex_command_execution': {
      const cmd = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : '';
      if (!cmd) return displayName;
      const inner = cmd.match(/^\/bin\/(?:bash|sh)\s+.*?"([^"]+)"$/) ?? cmd.match(/^\/bin\/(?:bash|sh)\s+.*?'([^']+)'$/);
      const effective = inner ? inner[1] : cmd;
      const tokens = effective.trim().split(/\s+/).filter(w => !w.startsWith('-') && w.length > 1).slice(0, 4);
      return tokens.join(' ') || effective.slice(0, 60);
    }
    case 'file_read':
    case 'file_write':
    case 'file_edit': {
      const p = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : '';
      if (!p) return displayName;
      const parts = p.split('/').filter(Boolean);
      return parts.length > 1 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : parts[0] || displayName;
    }
    case 'file_list_directory':
    case 'directory_tree': {
      const p = typeof args.path === 'string' ? args.path : '';
      if (!p) return displayName;
      const parts = p.split('/').filter(Boolean);
      return parts[parts.length - 1] || p || displayName;
    }
    case 'browser_navigate': {
      const url = typeof args.url === 'string' ? args.url : '';
      return url ? url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) : displayName;
    }
    default: {
      const bestStr = Object.values(args).find(v => typeof v === 'string' && v.length > 2 && v.length < 120);
      return typeof bestStr === 'string' ? bestStr.slice(0, 80) : displayName;
    }
  }
}

function formatUrlPreview(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
}

function looksLikeBase64(value: string): boolean {
  return value.length > 120 && /^[A-Za-z0-9+/=]+$/.test(value);
}

function sanitizeForDisplay(value: unknown): unknown {
  if (typeof value === 'string') return looksLikeBase64(value) ? '[base64 data hidden]' : value;
  if (Array.isArray(value)) return value.map(sanitizeForDisplay);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      if ((key === 'data' || key === 'base64') && typeof item === 'string' && looksLikeBase64(item)) {
        next[key] = '[base64 data hidden]';
        continue;
      }
      next[key] = sanitizeForDisplay(item);
    }
    return next;
  }
  return value;
}

function summarizeToolPayload(label: 'IN' | 'OUT', tool: ToolCall, value: string): string {
  const parsed = tryParseJson(value);
  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;

  if (obj) {
    if (label === 'IN') {
      if (typeof obj.url === 'string') return formatUrlPreview(obj.url);
      if (typeof obj.query === 'string') return obj.query;
      if (typeof obj.command === 'string') return obj.command;
      if (typeof obj.path === 'string') return obj.path.split('/').pop() || obj.path;
    }
    if (label === 'OUT') {
      if (typeof obj.data === 'string' && obj.data.trim()) return toSingleLinePreview(obj.data);
      if (typeof obj.title === 'string' && typeof obj.url === 'string') {
        return `${obj.title || '(untitled)'} · ${formatUrlPreview(obj.url)}`;
      }
      if (obj.ok === true) {
        const summary = stringifyPreview({ ...obj, ok: undefined }).replace(/ok:\s*/g, '').trim();
        return summary ? `OK · ${summary}` : 'OK';
      }
    }
    const generic = stringifyPreview(obj);
    if (generic) return toSingleLinePreview(generic);
  }
  return toSingleLinePreview(value);
}

function formatExpandedValue(value: string): string {
  const parsed = tryParseJson(value);
  if (parsed == null) return value || '(empty)';
  return JSON.stringify(sanitizeForDisplay(parsed), null, 2);
}

const OUTPUT_LINE_LIMIT = 30;

function ToolPayloadCopyButton({ text, label }: { text: string; label: 'IN' | 'OUT' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [text]);

  return (
    <button
      onClick={(e) => { e.stopPropagation(); void handleCopy(); }}
      title={`Copy ${label} payload`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/50 cursor-pointer"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

function ExpandableRow({ label, tool, value, defaultOpen = false }: { label: 'IN' | 'OUT'; tool: ToolCall; value: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const preview = summarizeToolPayload(label, tool, value);
  const expandedValue = formatExpandedValue(value);

  return (
    <div className="border-t border-white/[0.04] first:border-t-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
      >
        <span className="w-8 flex-shrink-0 text-[10px] font-medium uppercase tracking-wider text-white/25">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-mono text-white/45">{preview}</span>
        <span className="flex-shrink-0 text-[10px] text-white/20">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="ml-[44px] rounded-md bg-black/25 px-3 py-2">
            <div className="mb-2 flex items-center justify-end">
              <ToolPayloadCopyButton text={expandedValue} label={label} />
            </div>
            <pre className="text-[12px] font-mono text-white/40 whitespace-pre-wrap break-all leading-relaxed overflow-hidden">{expandedValue}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

const VERIFICATION_KIND_LABELS: Record<string, string> = {
  'browser:url': 'URL',
  'browser:title': 'Title',
  'browser:text_present': 'Text',
  'browser:selector_present': 'Selector',
  'fs:exists': 'File',
  'fs:modified': 'Modified',
  'fs:content_hash': 'Hash',
  'fs:dir_contents': 'Dir',
  'os:window_focused': 'Window',
  'os:process_running': 'Proc',
};

function verificationSummary(r: VerificationResult): string {
  if (r.changed === null) return r.note || 'indeterminate';
  if (r.changed) {
    if (r.before && r.after) return `${r.before} → ${r.after}`;
    return r.note || 'changed';
  }
  return 'no change';
}

export function VerificationBlock({ result }: { result: VerificationResult }) {
  const kindLabel = VERIFICATION_KIND_LABELS[result.kind] ?? result.kind;
  const isChanged = result.changed === true;
  const isIndeterminate = result.changed === null;

  return (
    <div className="flex items-center gap-2 py-[2px] ml-[22px]">
      {isIndeterminate ? (
        <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center text-yellow-400/50">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </span>
      ) : isChanged ? (
        <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center text-blue-400/50">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v20M2 12h20"/></svg>
        </span>
      ) : (
        <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center text-white/18">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
      )}
      <span className="flex-shrink-0 text-[9px] font-medium text-white/25 uppercase tracking-wider w-10">
        {kindLabel.length <= 6 ? kindLabel : kindLabel.slice(0, 6)}
      </span>
      <span className={`text-[11px] font-mono truncate ${
        isIndeterminate ? 'text-yellow-400/35' : isChanged ? 'text-blue-400/40' : 'text-white/25'
      }`}>
        {verificationSummary(result)}
      </span>
      {result.confidence !== 'high' && (
        <span className="text-[9px] text-white/15">({result.confidence})</span>
      )}
    </div>
  );
}

export function ToolBlock({ tool, isActiveTool = false, isPastTool = false }: { tool: ToolCall; isActiveTool?: boolean; isPastTool?: boolean }) {
  const displayName = getDisplayName(tool.name);
  const hasCard = !!(tool.input || tool.output);
  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';
  const isComplete = tool.status === 'success' || tool.status === 'error';
  const label = getCleanLabel(tool);
  const showOutput = isComplete && hasSubstantiveOutput(tool);

  // Only auto-open the detail card for errors — output is retracted by default
  const [open, setOpen] = useState(isError);

  const outputLines = tool.output?.split('\n') ?? [];
  const outputValue = outputLines.length > OUTPUT_LINE_LIMIT
    ? `${outputLines.slice(0, OUTPUT_LINE_LIMIT).join('\n')}\n\n[${outputLines.length - OUTPUT_LINE_LIMIT} more lines hidden]`
    : tool.output;

  // Show a brief inline output preview for completed tools (no click needed)
  const inlinePreview = showOutput && !open
    ? toSingleLinePreview(summarizeToolPayload('OUT', tool, tool.output!), 120)
    : null;

  return (
    <div className={`tool-row flex flex-col transition-all duration-300 ${isPastTool ? 'opacity-25' : 'opacity-100'}`}>
      <button
        onClick={() => hasCard && setOpen(o => !o)}
        className={`group flex items-center gap-2 py-[4px] text-left w-full ${hasCard ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {isRunning ? (
          <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
            <span className="tool-status-dot w-[5px] h-[5px] rounded-full bg-white/40" />
          </span>
        ) : isError ? (
          <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center text-red-400/60">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </span>
        ) : (
          <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center text-white/18">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        )}
        <span className="flex-shrink-0 text-[10px] font-medium text-white/30 uppercase tracking-wider w-10">
          {displayName.length <= 6 ? displayName : displayName.slice(0, 6)}
        </span>
        <span className={`flex-1 min-w-0 text-[12px] font-mono truncate ${
          isError ? 'text-red-400/50'
            : isActiveTool ? 'tool-label-shimmer'
            : isPastTool ? 'text-white/20'
            : isRunning ? 'text-white/50'
            : 'text-white/35'
        }`}>{label}</span>
        {tool.durationMs != null && tool.durationMs > 0 && (
          <span className="flex-shrink-0 text-[10px] text-white/20 mr-1 font-mono">
            {tool.durationMs < 1000 ? `${tool.durationMs}ms` : `${(tool.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        {hasCard && (
          <span className="flex-shrink-0 text-[10px] text-white/15 group-hover:text-white/40 transition-colors">
            {open ? '▾' : '▸'}
          </span>
        )}
      </button>
      {/* Inline output preview when card is collapsed — shows output without clicking */}
      {inlinePreview && (
        <div className="ml-[22px] mt-0 mb-0.5 text-[11px] font-mono text-white/25 truncate cursor-pointer" onClick={() => setOpen(true)}>
          → {inlinePreview}
        </div>
      )}
      {hasCard && open && (
        <div className="ml-5 mt-1 mb-1 rounded-lg border border-white/[0.05] bg-white/[0.015] overflow-hidden">
          {tool.input && <ExpandableRow label="IN" tool={tool} value={tool.input} />}
          {tool.output && <ExpandableRow label="OUT" tool={tool} value={outputValue || '(no output)'} defaultOpen={isError} />}
          {isRunning && !tool.output && <ExpandableRow label="OUT" tool={tool} value="Running..." />}
        </div>
      )}
    </div>
  );
}

