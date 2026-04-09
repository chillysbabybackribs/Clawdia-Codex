import React, { useState, useEffect } from 'react';
import { TIERS, DEFAULT_TIER, type Tier } from '../../shared/models';

interface SettingsViewProps {
  onBack: () => void;
}

export default function SettingsView({ onBack }: SettingsViewProps) {
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api) return;
    api.settings.getTier().then((t: string) => {
      if (t === 'fast' || t === 'balanced' || t === 'deep') setTier(t);
    });
  }, []);

  const handleSave = async () => {
    const api = (window as any).clawdia;
    if (!api) return;
    await api.settings.setTier(tier);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sectionCardClass = 'flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4';

  return (
    <div className="flex flex-col h-full bg-surface-0">
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
        <span className="text-xs text-text-tertiary">Settings</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto w-full max-w-[480px] flex flex-col gap-6">
          <section className={sectionCardClass}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">Model Tier</label>
            <p className="text-2xs text-text-muted -mt-1">Choose the performance tier for Codex responses.</p>
            <div className="flex flex-col gap-1">
              {(Object.entries(TIERS) as [Tier, typeof TIERS[Tier]][]).map(([key, config]) => (
                <label
                  key={key}
                  className={`flex items-start px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                    tier === key ? 'border-accent/40 bg-accent/10' : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.02]'
                  }`}
                >
                  <input type="radio" name="tier" value={key} checked={tier === key} onChange={() => setTier(key)} className="sr-only" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-text-primary">{config.label}</span>
                    <span className="text-2xs text-text-muted">{config.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </section>
          <section className={sectionCardClass}>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider">About</label>
            <div className="text-2xs text-text-muted space-y-1">
              <p>Clawdia -- Codex AI Workspace</p>
              <p>Powered by OpenAI Codex CLI. Authentication is handled by the Codex CLI directly.</p>
            </div>
          </section>
        </div>
      </div>
      <div className="sticky bottom-0 flex-shrink-0 border-t border-border-subtle bg-surface-0/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-[480px]">
          <button onClick={handleSave} className={`h-[38px] w-full rounded-xl text-sm font-medium transition-all cursor-pointer ${saved ? 'bg-status-success/20 text-status-success' : 'bg-accent/90 hover:bg-accent text-surface-0'}`}>
            {saved ? 'Saved' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
