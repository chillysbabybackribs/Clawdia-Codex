import type { WebContents } from 'electron';

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

export interface BrowserService {
  init(): Promise<void>;
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  refresh(): Promise<void>;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  newTab(url?: string, activate?: boolean): Promise<BrowserTab>;
  listTabs(): BrowserTab[];
  switchTab(id: string): Promise<void>;
  closeTab(id: string): Promise<void>;
  matchHistory?(prefix: string): Promise<string[]>;
  hide(): void;
  show(): void;
  getActiveWebContents(): WebContents | null;
  /** Get the active tab's ID. Returns null if no active tab. */
  getActiveTabId(): string | null;
  /** Get WebContents for a specific tab by ID. Returns null if tab not found. */
  getWebContentsByTabId?(tabId: string): WebContents | null;
}
