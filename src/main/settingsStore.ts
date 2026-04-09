import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Tier, DEFAULT_TIER } from '../shared/models';

export interface AppSettings {
  tier: Tier;
  uiSession: unknown;
}

function defaultSettings(): AppSettings {
  return {
    tier: DEFAULT_TIER,
    uiSession: null,
  };
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'clawdia-settings.json');
}

let cache: AppSettings | null = null;

export function loadSettings(): AppSettings {
  if (cache) return cache;
  try {
    const p = settingsPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<AppSettings>;
      cache = {
        ...defaultSettings(),
        ...parsed,
      };
      return cache;
    }
  } catch { /* fall through */ }
  cache = defaultSettings();
  return cache;
}

export function saveSettings(next: AppSettings): void {
  cache = next;
  try {
    const p = settingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  } catch { /* ignore */ }
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key];
}

export function patchSettings(patch: Partial<AppSettings>): AppSettings {
  const cur = loadSettings();
  const next: AppSettings = {
    ...cur,
    ...patch,
  };
  saveSettings(next);
  return next;
}
