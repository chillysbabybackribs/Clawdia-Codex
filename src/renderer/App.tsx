import React, { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import AppChrome from './components/AppChrome';
import ChatPanel from './components/ChatPanel';
import BrowserPanel from './components/BrowserPanel';
import { makeTab, addTab, closeTab, type ConversationTab } from './tabLogic';

const ConversationsView = lazy(() => import('./components/ConversationsView'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const WelcomeScreen = lazy(() => import('./components/WelcomeScreen'));
const EditorPanel = lazy(() => import('./components/EditorPanel'));
const TerminalPanel = lazy(() => import('./components/TerminalPanel'));

export type View = 'chat' | 'conversations' | 'settings';
type RightPaneMode = 'none' | 'browser' | 'editor' | 'terminal';

interface UiSessionState {
  tabs?: ConversationTab[];
  activeTabId?: string;
  activeView: View;
  rightPaneMode?: RightPaneMode;
  browserVisible?: boolean;
  activeConversationId?: string | null;
}

export default function App() {
  const [activeView, setActiveView] = useState<View>('chat');
  const [displayedView, setDisplayedView] = useState<View>('chat');
  const [viewTransitionStage, setViewTransitionStage] = useState<'idle' | 'exit' | 'enter'>('idle');
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>('browser');
  const [tabPanelState, setTabPanelState] = useState<Record<string, { chatKey: number; loadConversationId: string | null }>>({});
  const [showWelcome, setShowWelcome] = useState<boolean | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [tabs, setTabs] = useState<ConversationTab[]>(() => [makeTab(null)]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);

  const browserVisible = rightPaneMode === 'browser';
  const editorOpen = rightPaneMode === 'editor';
  const terminalOpen = rightPaneMode === 'terminal';

  const patchTab = useCallback((tabId: string, patch: Partial<ConversationTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const patchTabByConversationId = useCallback((conversationId: string, updater: (tab: ConversationTab) => Partial<ConversationTab> | null) => {
    setTabs((current) => current.map((tab) => {
      if (tab.conversationId !== conversationId) return tab;
      const patch = updater(tab);
      return patch ? { ...tab, ...patch } : tab;
    }));
  }, []);

  const getTabPanel = useCallback((tabId: string) => {
    return tabPanelState[tabId] ?? { chatKey: 0, loadConversationId: null };
  }, [tabPanelState]);

  const setTabPanel = useCallback((tabId: string, updater: (prev: { chatKey: number; loadConversationId: string | null }) => { chatKey: number; loadConversationId: string | null }) => {
    setTabPanelState(prev => {
      const current = prev[tabId] ?? { chatKey: 0, loadConversationId: null };
      return { ...prev, [tabId]: updater(current) };
    });
  }, []);

  // View transition animation
  useEffect(() => {
    if (activeView === displayedView) return;
    let enterTimer: number | null = null;
    const swapTimer = window.setTimeout(() => {
      setDisplayedView(activeView);
      setViewTransitionStage('enter');
      enterTimer = window.setTimeout(() => {
        setViewTransitionStage('idle');
      }, 180);
    }, 120);
    setViewTransitionStage('exit');
    return () => {
      window.clearTimeout(swapTimer);
      if (enterTimer !== null) window.clearTimeout(enterTimer);
    };
  }, [activeView, displayedView]);

  // Check welcome state on mount
  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api?.settings) {
      setShowWelcome(true);
      return;
    }
    api.settings.get('hasSeenWelcome').then((seen: boolean) => {
      setShowWelcome(!seen);
    }).catch(() => setShowWelcome(true));
  }, []);

  // Hydrate session from settings
  useEffect(() => {
    if (showWelcome !== false) return;
    const api = (window as any).clawdia;
    if (!api?.settings) { setSessionHydrated(true); return; }

    const fallbackTimer = window.setTimeout(() => { setSessionHydrated(true); }, 500);

    api.settings.get('uiSession')
      .then((session: UiSessionState | null) => {
        if (session?.activeView && (session.activeView === 'chat' || session.activeView === 'conversations' || session.activeView === 'settings')) {
          setActiveView(session.activeView);
        }
        if (session?.rightPaneMode) {
          setRightPaneMode(session.rightPaneMode);
        } else if (typeof session?.browserVisible === 'boolean') {
          setRightPaneMode(session.browserVisible ? 'browser' : 'none');
        }
        if (session?.tabs && session.tabs.length > 0) {
          setTabs(session.tabs);
          const restoredActiveTabId = session.activeTabId ?? session.tabs[0].id;
          setActiveTabId(restoredActiveTabId);
          setTabPanelState(() => {
            const state: Record<string, { chatKey: number; loadConversationId: string | null }> = {};
            for (const t of session.tabs!) {
              state[t.id] = { chatKey: 0, loadConversationId: t.conversationId ?? null };
            }
            return state;
          });
        } else if (session?.activeConversationId) {
          setTabs(current => {
            const updated = current.map((t, i) => i === 0 ? { ...t, conversationId: session.activeConversationId ?? null } : t);
            setTabPanelState({ [updated[0].id]: { chatKey: 0, loadConversationId: session.activeConversationId ?? null } });
            return updated;
          });
        }
      })
      .finally(() => {
        window.clearTimeout(fallbackTimer);
        setSessionHydrated(true);
      });
  }, [showWelcome]);

  // Persist session state
  useEffect(() => {
    if (!sessionHydrated || showWelcome !== false) return;
    (window as any).clawdia?.settings?.set('uiSession', {
      tabs,
      activeTabId,
      activeView,
      rightPaneMode,
      browserVisible: rightPaneMode === 'browser',
    });
  }, [sessionHydrated, showWelcome, tabs, activeTabId, activeView, rightPaneMode]);

  // Hydrate tab titles from conversation list
  useEffect(() => {
    if (!sessionHydrated || showWelcome !== false) return;
    const api = (window as any).clawdia;
    if (!api?.chat?.list) return;

    let cancelled = false;
    api.chat.list()
      .then((conversations: Array<any>) => {
        if (cancelled) return;
        const conversationMap = new Map((conversations || []).map((c: any) => [c.id, c]));
        setTabs((current) => current.map((tab) => {
          if (!tab.conversationId) return tab;
          const conversation = conversationMap.get(tab.conversationId);
          return { ...tab, title: conversation?.title || tab.title };
        }));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [sessionHydrated, showWelcome]);

  // Show/hide browser native view
  useEffect(() => {
    const browser = (window as any).clawdia?.browser;
    if (!browser) return;
    if (rightPaneMode === 'browser') {
      browser.show();
    } else {
      browser.hide();
      browser.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }, [rightPaneMode]);

  // Auto-show browser when navigation is triggered by the router
  useEffect(() => {
    const api = (window as any).clawdia?.browser;
    if (!api?.onAutoShow) return;
    const unsub = api.onAutoShow(() => {
      setRightPaneMode('browser');
      setActiveView('chat');
    });
    return () => unsub?.();
  }, []);

  // Mirror event subscription
  useEffect(() => {
    const api = (window as any).clawdia?.browser;
    if (!api?.onMirrorNavigate) return;
    const unsub = api.onMirrorNavigate(() => {
      setRightPaneMode('browser');
      setActiveView('chat');
    });
    return () => unsub?.();
  }, []);

  // Subscribe to title updates
  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api?.chat) return;

    const unsubTitle = api.chat.onTitleUpdated?.((payload: { conversationId: string; title: string }) => {
      if (!payload?.conversationId || !payload?.title) return;
      patchTabByConversationId(payload.conversationId, () => ({ title: payload.title }));
    });

    return () => { unsubTitle?.(); };
  }, [patchTabByConversationId]);

  const handleWelcomeComplete = useCallback(() => {
    (window as any).clawdia?.settings?.set('hasSeenWelcome', true);
    setShowWelcome(false);
    setSessionHydrated(true);
  }, []);

  const handleNewChat = useCallback(async () => {
    const api = (window as any).clawdia;
    const created = api ? await api.chat.create() : null;
    setTabs(current =>
      current.map(t => t.id === activeTabId ? { ...t, conversationId: created?.id ?? null, title: undefined } : t)
    );
    setTabPanel(activeTabId, prev => ({ chatKey: prev.chatKey + 1, loadConversationId: created?.id ?? null }));
    setActiveView('chat');
  }, [activeTabId, setTabPanel]);

  const handleLoadConversation = useCallback((id: string) => {
    if (!id) return;
    setTabs(current =>
      current.map(t => t.id === activeTabId ? { ...t, conversationId: id } : t)
    );
    setTabPanel(activeTabId, prev => ({ chatKey: prev.chatKey + 1, loadConversationId: id }));
    setActiveView('chat');
  }, [activeTabId, setTabPanel]);

  const handleNewTab = useCallback(async () => {
    const api = (window as any).clawdia;
    const created = api ? await api.chat.create() : null;
    const newTab = makeTab(created?.id ?? null);
    setTabs(current => {
      const result = addTab(current, newTab);
      setActiveTabId(result.activeTabId);
      return result.tabs;
    });
    setTabPanel(newTab.id, () => ({ chatKey: 0, loadConversationId: created?.id ?? null }));
    setActiveView('chat');
  }, [setTabPanel]);

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs(currentTabs => {
      const result = closeTab(currentTabs, tabId, activeTabId);
      if (result.activeTabId !== activeTabId) {
        setActiveTabId(result.activeTabId);
      }
      return result.tabs;
    });
    setTabPanelState(prev => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, [activeTabId]);

  const handleSwitchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setActiveView('chat');
  }, []);

  const handleReorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs(current => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const handleConversationMetaResolved = useCallback((tabId: string, patch: Partial<ConversationTab>) => {
    patchTab(tabId, patch);
  }, [patchTab]);

  const handleOpenConversation = useCallback((id: string) => {
    const existing = tabs.find(t => t.conversationId === id);
    if (existing) {
      handleSwitchTab(existing.id);
    } else {
      const newTab = makeTab(id);
      setTabs(current => {
        const result = addTab(current, newTab);
        setActiveTabId(result.activeTabId);
        return result.tabs;
      });
      setTabPanel(newTab.id, () => ({ chatKey: 0, loadConversationId: id }));
      setActiveView('chat');
    }
  }, [tabs, handleSwitchTab, setTabPanel]);

  const handleToggleBrowser = useCallback(() => {
    setRightPaneMode((mode) => (mode === 'browser' ? 'none' : 'browser'));
  }, []);

  const handleToggleTerminal = useCallback(() => {
    setRightPaneMode((mode) => {
      if (mode === 'terminal') {
        (window as any).clawdia?.browser.show();
        return 'browser';
      }
      (window as any).clawdia?.browser.hide();
      return 'terminal';
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'n') { e.preventDefault(); handleNewChat(); }
      if (ctrl && e.key === 'l') { e.preventDefault(); handleNewChat(); }
      if (ctrl && e.key === ',') { e.preventDefault(); setActiveView(v => v === 'settings' ? 'chat' : 'settings'); }
      if (ctrl && e.key === 'h') { e.preventDefault(); setActiveView(v => v === 'conversations' ? 'chat' : 'conversations'); }
      if (ctrl && e.key === 'b') { e.preventDefault(); handleToggleBrowser(); }
      if (ctrl && e.key === 't') { e.preventDefault(); handleNewTab(); }
      if (ctrl && e.key === 'w') { e.preventDefault(); handleCloseTab(activeTabId); }
      if (e.key === 'Escape' && activeView !== 'chat') setActiveView('chat');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleNewChat, handleToggleBrowser, handleNewTab, handleCloseTab, activeTabId, activeView]);

  // Loading state
  if (showWelcome === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-0 text-text-secondary">
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, letterSpacing: '0.04em' }}>Reconnecting...</div>
      </div>
    );
  }

  // Welcome screen
  if (showWelcome) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden rounded-[10px] border-[2px] border-white/[0.10] bg-surface-0">
        <AppChrome />
        <div className="flex min-h-0 flex-1">
          <div
            className="relative flex h-full min-w-0 flex-col"
            style={{
              flex: browserVisible ? '35 0 0' : '1 0 0',
              background: '#000000',
              ...(browserVisible ? {
                borderRight: '2px solid rgba(255,255,255,0.09)',
                boxShadow: 'inset -2px 0 12px rgba(0,0,0,0.35), 2px 0 8px rgba(0,0,0,0.3)',
              } : {}),
            }}
          >
            <Suspense fallback={<div />}><WelcomeScreen onComplete={handleWelcomeComplete} /></Suspense>
          </div>
          {browserVisible && (
            <div
              className="flex h-full min-w-0 flex-col border-l-[0px] shadow-[inset_2px_0_8px_rgba(0,0,0,0.3),-2px_0_12px_rgba(0,0,0,0.4)]"
              style={{ flex: '65 0 0' }}
            >
              <BrowserPanel />
            </div>
          )}
        </div>
      </div>
    );
  }

  const lazyFallback = <div className="flex min-h-0 flex-1 items-center justify-center" style={{ color: '#555' }}>Loading...</div>;

  const renderPrimaryView = () => {
    if (displayedView === 'chat') {
      return (
        <>
          {(() => {
            const tab = tabs.find(t => t.id === activeTabId);
            if (!tab) return null;
            const panel = getTabPanel(tab.id);
            return (
              <div
                key={tab.id}
                className="flex min-h-0 w-full min-w-0 flex-1 self-stretch"
              >
                <ChatPanel
                  key={`${tab.id}-${panel.chatKey}`}
                  tabId={tab.id}
                  browserVisible={browserVisible}
                  onToggleBrowser={handleToggleBrowser}
                  onOpenSettings={() => setActiveView('settings')}
                  loadConversationId={panel.loadConversationId}
                  tabs={tabs}
                  activeTabId={activeTabId}
                  onNewTab={handleNewTab}
                  onCloseTab={handleCloseTab}
                  onSwitchTab={handleSwitchTab}
                  onReorderTabs={handleReorderTabs}
                  onOpenConversation={handleOpenConversation}
                  onConversationMetaResolved={handleConversationMetaResolved}
                  onToggleTerminal={handleToggleTerminal}
                  terminalOpen={terminalOpen}
                />
              </div>
            );
          })()}
        </>
      );
    }

    if (displayedView === 'conversations') {
      return (
        <Suspense fallback={lazyFallback}>
          <ConversationsView
            onBack={() => setActiveView('chat')}
            onLoadConversation={handleLoadConversation}
          />
        </Suspense>
      );
    }

    if (displayedView === 'settings') {
      return <Suspense fallback={lazyFallback}><SettingsView onBack={() => setActiveView('chat')} /></Suspense>;
    }

    return null;
  };

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-[10px] border-[2px] border-white/[0.10]"
      style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.9), 0 2px 8px rgba(0,0,0,0.7)' }}
    >
      <AppChrome />
      <div className="flex min-h-0 flex-1">
        <div
          className="relative flex h-full min-w-0 flex-col"
          style={{
            flex: rightPaneMode === 'none' ? '1 0 0' : '35 0 0',
            background: '#000000',
            ...(rightPaneMode !== 'none' ? {
              marginRight: 6,
              boxShadow: '2px 0 12px rgba(0,0,0,0.5)',
            } : {}),
          }}
        >
          <div className="chat-shell flex h-full min-w-0 flex-col">
            <div className="chat-shell-ambient" aria-hidden="true" />
            <div className="chat-shell-topline" aria-hidden="true" />
            <div
              className={`chat-shell-inner flex min-h-0 w-full min-w-0 flex-1 self-stretch transition-all duration-180 ease-out ${
                viewTransitionStage === 'exit'
                  ? 'translate-y-1 opacity-0'
                  : viewTransitionStage === 'enter'
                    ? 'translate-y-0 opacity-100'
                    : 'translate-y-0 opacity-100'
              }`}
            >
              {renderPrimaryView()}
            </div>
          </div>
        </div>

        {editorOpen && (
          <div className="flex h-full min-w-0 flex-col border-l-[0px]" style={{ flex: '65 0 0' }}>
            <Suspense fallback={<div />}><EditorPanel /></Suspense>
          </div>
        )}

        <div
          className={`${terminalOpen ? 'flex' : 'hidden'} h-full min-w-0 flex-col border-l-[0px]`}
          style={{ flex: '65 0 0' }}
        >
          <Suspense fallback={<div />}><TerminalPanel /></Suspense>
        </div>

        {browserVisible && !editorOpen && !terminalOpen && (
          <div className="flex h-full min-w-0 flex-col border-l-[0px]" style={{ flex: '65 0 0' }}>
            <BrowserPanel />
          </div>
        )}
      </div>
    </div>
  );
}
