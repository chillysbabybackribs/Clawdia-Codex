import { BrowserView, BrowserWindow } from 'electron';
import type { BrowserTab, BrowserService } from './BrowserService';
import { IPC_EVENTS } from '../ipc-channels';
import { clearRefsForTab } from '../browserBridge';
import { getSavedBrowserTabs, saveBrowserTabs } from '../db';

interface InternalTab {
  id: string;
  view: BrowserView;
  title: string;
  url: string;
  active: boolean;
}

const PARTITION = 'persist:clawdia-browser';
const NAVIGATION_TIMEOUT_MS = 8000;

export class ElectronBrowserService implements BrowserService {
  private readonly tabs = new Map<string, InternalTab>();
  private readonly history = new Set<string>();
  private activeTabId: string | null = null;
  private bounds = { x: 0, y: 0, width: 0, height: 0 };
  private visible = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly _userDataPath: string,
  ) {}

  async init(): Promise<void> {
    // Restore persisted tabs, or create a default tab
    const saved = getSavedBrowserTabs();
    if (saved.length > 0) {
      let activeId: string | null = null;
      for (const row of saved) {
        // Skip about:blank tabs that aren't the only tab
        const url = row.url && row.url !== 'about:blank' ? row.url : undefined;
        const tab = await this.newTab(url, false);
        // Restore the persisted ID so tab references stay stable
        // (newTab already created with a new ID — remap)
        if (row.active) activeId = tab.id;
      }
      // Activate the previously active tab, or the first one
      const target = activeId || this.listTabs()[0]?.id;
      if (target) await this.switchTab(target);
    } else {
      await this.newTab('about:blank');
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  async navigate(url: string): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab) return;
    await this.loadUrlReady(tab.view.webContents, url);
    this.history.add(url);
  }

  async back(): Promise<void> {
    const tab = this.getActiveTab();
    if (tab?.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
  }

  async forward(): Promise<void> {
    const tab = this.getActiveTab();
    if (tab?.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
  }

  async refresh(): Promise<void> {
    this.getActiveTab()?.view.webContents.reload();
  }

  // ── Bounds / Visibility ───────────────────────────────────────────────────

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = bounds;
    const tab = this.getActiveTab();
    if (tab && this.visible) {
      tab.view.setBounds(bounds);
    }
  }

  hide(): void {
    this.visible = false;
    this.window.setBrowserView(null);
  }

  show(): void {
    this.visible = true;
    const tab = this.getActiveTab();
    if (!tab) return;
    this.window.setBrowserView(tab.view);
    tab.view.setBounds(this.bounds);
  }

  // ── Tab CRUD ──────────────────────────────────────────────────────────────

  async newTab(url?: string, activate = true): Promise<BrowserTab> {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const view = new BrowserView({
      webPreferences: {
        partition: PARTITION,
        sandbox: false,
      },
    });

    const tab: InternalTab = {
      id,
      view,
      title: 'New Tab',
      url: url || 'about:blank',
      active: false,
    };

    this.tabs.set(id, tab);
    this.bindTabEvents(tab);

    if (activate) {
      this.activateTab(tab);
    } else {
      this.emitTabsChanged();
    }

    if (url) {
      await this.loadUrlReady(view.webContents, url);
      this.history.add(url);
    }

    return this.toPublicTab(tab);
  }

  listTabs(): BrowserTab[] {
    return [...this.tabs.values()].map((t) => this.toPublicTab(t));
  }

  async switchTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.activateTab(tab);
  }

  async closeTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;

    // Clean up ref storage for this tab
    clearRefsForTab(id);

    // Detach if currently shown
    if (this.window.getBrowserView() === tab.view) {
      this.window.setBrowserView(null);
    }
    tab.view.webContents.close();
    this.tabs.delete(id);

    // Activate next tab if we closed the active one
    if (this.activeTabId === id) {
      this.activeTabId = null;
      const next = [...this.tabs.values()][0];
      if (next) this.activateTab(next);
    }

    this.emitTabsChanged();
  }

  async matchHistory(prefix: string): Promise<string[]> {
    if (!prefix) return [];
    const lower = prefix.toLowerCase();
    return [...this.history].filter(
      (url) => url.toLowerCase().includes(lower),
    );
  }

  getActiveWebContents(): Electron.WebContents | null {
    return this.getActiveTab()?.view.webContents ?? null;
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  getWebContentsByTabId(tabId: string): Electron.WebContents | null {
    return this.tabs.get(tabId)?.view.webContents ?? null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getActiveTab(): InternalTab | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
  }

  private activateTab(tab: InternalTab): void {
    const current = this.getActiveTab();
    if (current && current.id !== tab.id) {
      current.active = false;
    }

    this.activeTabId = tab.id;
    tab.active = true;

    if (this.visible) {
      this.window.setBrowserView(tab.view);
      tab.view.setBounds(this.bounds);
    }

    this.emitTabsChanged();
  }

  private bindTabEvents(tab: InternalTab): void {
    const wc = tab.view.webContents;

    const update = () => {
      tab.url = wc.getURL() || tab.url;
      tab.title = wc.getTitle() || tab.title;

      if (tab.id === this.activeTabId) {
        this.sendToRenderer(IPC_EVENTS.BROWSER_URL_CHANGED, tab.url);
        this.sendToRenderer(IPC_EVENTS.BROWSER_TITLE_CHANGED, tab.title);
        this.sendToRenderer(IPC_EVENTS.BROWSER_LOADING, wc.isLoading());
      }
      this.emitTabsChanged();
    };

    wc.on('page-title-updated', () => update());
    wc.on('did-start-loading', () => update());
    wc.on('did-stop-loading', () => update());
    wc.on('did-navigate', (_event, url) => {
      tab.url = url;
      this.history.add(url);
      update();
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      tab.url = url;
      this.history.add(url);
      update();
    });
  }

  private loadUrlReady(webContents: Electron.WebContents, url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        webContents.removeListener('did-navigate', onNav);
        webContents.removeListener('did-navigate-in-page', onNav);
        webContents.removeListener('dom-ready', onNav);
        webContents.removeListener('did-fail-load', onFail);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const onNav = () => finish();

      const onFail = (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        validatedURL: string,
        isMainFrame: boolean,
      ) => {
        if (!isMainFrame) return;
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Failed to load ${validatedURL || url}: ${errorDescription} (${errorCode})`));
      };

      const timeout = setTimeout(finish, NAVIGATION_TIMEOUT_MS);

      webContents.once('did-navigate', onNav);
      webContents.once('did-navigate-in-page', onNav);
      webContents.once('dom-ready', onNav);
      webContents.once('did-fail-load', onFail);

      void webContents.loadURL(url).catch((error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(`Failed to load ${url}`));
      });
    });
  }

  private toPublicTab(tab: InternalTab): BrowserTab {
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      active: tab.active,
    };
  }

  private emitTabsChanged(): void {
    const tabs = this.listTabs();
    this.sendToRenderer(IPC_EVENTS.BROWSER_TABS_CHANGED, tabs);
    // Persist tab state to DB for restore on restart
    try {
      saveBrowserTabs(tabs, this.activeTabId);
    } catch {
      // Best-effort — don't crash on DB failure
    }
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }
}
