interface ClawdiaAPI {
  chat: {
    send(message: string, attachments?: any[], conversationId?: string | null, tier?: string): Promise<any>;
    stop(conversationId?: string): Promise<void>;
    new(): Promise<{ id: string; title: string }>;
    create(): Promise<{ id: string; title: string }>;
    list(): Promise<Array<{ id: string; title: string; updatedAt: string }>>;
    load(id: string): Promise<any[]>;
    delete(id: string): Promise<void>;
    onStreamText(cb: (payload: { delta: string; conversationId: string }) => void): () => void;
    onStreamEnd(cb: (data: any) => void): () => void;
    onTitleUpdated(cb: (payload: { conversationId: string; title: string }) => void): () => void;
    onToolActivity?(cb: (payload: any) => void): () => void;
  };
  browser: {
    navigate(url: string): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    refresh(): Promise<void>;
    setBounds(bounds: unknown): Promise<void>;
    newTab(url?: string): Promise<any>;
    listTabs(): Promise<any[]>;
    switchTab(id: string): Promise<void>;
    closeTab(id: string): Promise<void>;
    matchHistory(prefix: string): Promise<string[]>;
    hide(): Promise<void>;
    show(): Promise<void>;
    onUrlChanged(cb: (url: unknown) => void): () => void;
    onTitleChanged(cb: (title: unknown) => void): () => void;
    onLoading(cb: (loading: unknown) => void): () => void;
    onTabsChanged(cb: (tabs: unknown) => void): () => void;
    onAutoShow(cb: () => void): () => void;
    onMirrorNavigate(cb: (payload: { url: string; conversationId: string }) => void): () => void;
    onMirrorDone(cb: (payload: { conversationId: string }) => void): () => void;
  };
  settings: {
    get(key: string): Promise<any>;
    set(key: string, value: unknown): Promise<void>;
    getTier(): Promise<string>;
    setTier(tier: string): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
  };
}

declare global {
  interface Window {
    clawdia: ClawdiaAPI;
  }
}

export {};
