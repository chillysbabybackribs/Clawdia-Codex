import { contextBridge, ipcRenderer } from 'electron';
import { IPC, IPC_EVENTS } from './ipc-channels';

ipcRenderer.setMaxListeners(50);

function onEvent<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function subscribe<T>(channel: string, mapPayload: (p: T) => unknown = (p) => p) {
  return (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: T) => cb(mapPayload(payload));
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

function mapBrowserTab(tab: any) {
  return { ...tab, isActive: Boolean(tab?.active) };
}

try {
  contextBridge.exposeInMainWorld('clawdia', {
    chat: {
      send: (message: string, attachments?: any[], conversationId?: string | null, tier?: string) =>
        ipcRenderer.invoke(IPC.CHAT_SEND, { text: message, attachments, conversationId, tier }),
      stop: (conversationId?: string) => ipcRenderer.invoke(IPC.CHAT_STOP, conversationId),
      new: () => ipcRenderer.invoke(IPC.CHAT_NEW),
      create: () => ipcRenderer.invoke(IPC.CHAT_CREATE),
      list: () => ipcRenderer.invoke(IPC.CHAT_LIST),
      load: (id: string) => ipcRenderer.invoke(IPC.CHAT_LOAD, id),
      delete: (id: string) => ipcRenderer.invoke(IPC.CHAT_DELETE, id),
      onStreamText: (cb: (payload: { delta: string; conversationId: string }) => void) =>
        onEvent(IPC_EVENTS.CHAT_STREAM_TEXT, cb),
      onStreamEnd: (cb: (data: any) => void) =>
        onEvent(IPC_EVENTS.CHAT_STREAM_END, cb),
      onTitleUpdated: (cb: (payload: { conversationId: string; title: string }) => void) =>
        onEvent(IPC_EVENTS.CHAT_TITLE_UPDATED, cb),
      onToolActivity: (cb: (payload: any) => void) =>
        onEvent(IPC_EVENTS.CHAT_TOOL_ACTIVITY, cb),
    },
    browser: {
      navigate: (url: string) => ipcRenderer.invoke(IPC.BROWSER_NAVIGATE, url),
      back: () => ipcRenderer.invoke(IPC.BROWSER_BACK),
      forward: () => ipcRenderer.invoke(IPC.BROWSER_FORWARD),
      refresh: () => ipcRenderer.invoke(IPC.BROWSER_REFRESH),
      setBounds: (bounds: unknown) => ipcRenderer.invoke(IPC.BROWSER_SET_BOUNDS, bounds),
      newTab: (url?: string) => ipcRenderer.invoke(IPC.BROWSER_TAB_NEW, url).then(mapBrowserTab),
      listTabs: () => ipcRenderer.invoke(IPC.BROWSER_TAB_LIST).then((tabs: unknown) =>
        (Array.isArray(tabs) ? tabs : []).map(mapBrowserTab)),
      switchTab: (id: string) => ipcRenderer.invoke(IPC.BROWSER_TAB_SWITCH, id),
      closeTab: (id: string) => ipcRenderer.invoke(IPC.BROWSER_TAB_CLOSE, id),
      matchHistory: (prefix: string) => ipcRenderer.invoke(IPC.BROWSER_HISTORY_MATCH, prefix),
      hide: () => ipcRenderer.invoke(IPC.BROWSER_HIDE),
      show: () => ipcRenderer.invoke(IPC.BROWSER_SHOW),
      onUrlChanged: subscribe<string>(IPC_EVENTS.BROWSER_URL_CHANGED),
      onTitleChanged: subscribe<string>(IPC_EVENTS.BROWSER_TITLE_CHANGED),
      onLoading: subscribe<boolean>(IPC_EVENTS.BROWSER_LOADING),
      onTabsChanged: subscribe<unknown[]>(IPC_EVENTS.BROWSER_TABS_CHANGED, (tabs) =>
        (Array.isArray(tabs) ? tabs : []).map(mapBrowserTab)),
      onAutoShow: (cb: () => void) => onEvent(IPC_EVENTS.BROWSER_AUTO_SHOW, cb),
      onMirrorNavigate: subscribe(IPC_EVENTS.BROWSER_MIRROR_NAVIGATE),
      onMirrorDone: subscribe(IPC_EVENTS.BROWSER_MIRROR_DONE),
    },
    settings: {
      get: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_GET, key),
      set: (key: string, value: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SET, key, value),
      getTier: () => ipcRenderer.invoke(IPC.TIER_GET),
      setTier: (tier: string) => ipcRenderer.invoke(IPC.TIER_SET, tier),
    },
    window: {
      minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
      maximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
      close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
    },
  });
  console.log('[preload] bridge exposed');
} catch (error) {
  console.error('[preload] failed:', error);
}
