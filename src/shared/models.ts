export type Tier = 'fast' | 'balanced' | 'deep';

export interface TierConfig {
  label: string;
  model: string;
  description: string;
}

export const TIERS: Record<Tier, TierConfig> = {
  fast:     { label: 'Fast',     model: 'gpt-5.4-nano', description: 'Quick responses' },
  balanced: { label: 'Balanced', model: 'gpt-5.4-mini', description: 'Good balance of speed and depth' },
  deep:     { label: 'Deep',     model: 'gpt-5.4',      description: 'Maximum capability' },
};

export const DEFAULT_TIER: Tier = 'balanced';

export function getTierModel(tier: Tier): string {
  return TIERS[tier].model;
}
