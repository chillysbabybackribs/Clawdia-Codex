import React from 'react';

interface WelcomeScreenProps {
  onComplete: () => void;
}

export default function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="flex flex-col items-center gap-6 max-w-[400px] w-full">
        <div className="flex flex-col items-center gap-2">
          <div className="text-[28px] font-bold text-text-primary tracking-tight">Clawdia</div>
          <div className="text-sm text-text-tertiary text-center leading-relaxed">
            AI desktop workspace powered by Codex.
          </div>
        </div>
        <div className="w-full h-px bg-white/[0.06]" />
        <div className="flex flex-col gap-2 w-full">
          {[
            ['Terminal', 'Execute commands, install packages, run builds'],
            ['Browser', 'Search, navigate, click, extract data from any site'],
            ['Files', 'Read, write, edit files anywhere on your system'],
            ['Memory', 'Remembers facts and context across conversations'],
          ].map(([title, desc]) => (
            <div key={title} className="flex items-start gap-3 py-1">
              <div className="w-1 h-1 rounded-full bg-accent/60 mt-[7px] flex-shrink-0" />
              <div>
                <span className="text-2xs font-medium text-text-secondary">{title}</span>
                <span className="text-2xs text-text-muted"> -- {desc}</span>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onComplete}
          className="w-full h-[42px] rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all cursor-pointer"
        >
          Get Started
        </button>
        <p className="text-2xs text-text-muted text-center">
          Make sure you have the Codex CLI installed and authenticated.
          Run <code className="font-mono text-text-secondary">codex --version</code> to verify.
        </p>
      </div>
    </div>
  );
}
