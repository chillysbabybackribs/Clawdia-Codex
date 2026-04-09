import React from 'react';

export default function TerminalPanel() {
  return (
    <div className="flex flex-col h-full" style={{ background: '#0a0a0a' }}>
      <div className="flex items-center h-[38px] px-4 border-b border-white/[0.08] flex-shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-secondary/70">Terminal</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[13px] text-text-muted/50">Terminal not available in this build</span>
      </div>
    </div>
  );
}
