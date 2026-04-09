import React, { useState, useEffect, useCallback } from 'react';

interface ConversationsViewProps {
  onBack: () => void;
  onLoadConversation: (id: string) => void;
}

interface ConvItem {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

export default function ConversationsView({ onBack, onLoadConversation }: ConversationsViewProps) {
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadConversations = useCallback(async () => {
    const api = (window as any).clawdia;
    if (!api) return;
    try {
      const list = await api.chat.list();
      setConversations(list || []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const api = (window as any).clawdia;
    if (!api) return;
    await api.chat.delete(id);
    setConversations(prev => prev.filter(c => c.id !== id));
  }, []);

  const handleLoad = useCallback((id: string) => {
    onLoadConversation(id);
  }, [onLoadConversation]);

  const filtered = conversations.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-surface-0">
      <header className="drag-region flex items-center gap-3 px-4 h-[44px] flex-shrink-0 border-b border-border-subtle">
        <button
          onClick={onBack}
          className="no-drag flex items-center justify-center w-7 h-7 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2 className="text-sm font-medium text-text-primary">Conversations</h2>
        <div className="flex-1" />
        <span className="text-2xs text-text-muted no-drag">{conversations.length} chats</span>
      </header>

      <div className="px-3 pt-3 pb-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search conversations..."
          className="w-full h-[34px] bg-surface-2 text-text-primary text-sm px-3 rounded-lg border border-border-subtle placeholder:text-text-muted outline-none focus:border-accent/30 transition-colors"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading && (
          <div className="flex items-center justify-center py-12 text-sm text-text-muted">
            Loading...
          </div>
        )}

        {!loading && filtered.map(conv => (
          <div
            key={conv.id}
            onClick={() => handleLoad(conv.id)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left hover:bg-white/[0.03] transition-colors cursor-pointer group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-primary truncate">{conv.title}</span>
                <span className="text-2xs text-text-muted flex-shrink-0">{timeAgo(conv.updatedAt)}</span>
              </div>
              <span className="text-2xs text-text-tertiary">
                {conv.messageCount} message{conv.messageCount !== 1 ? 's' : ''}
              </span>
            </div>

            <button
              onClick={(e) => handleDelete(conv.id, e)}
              className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-status-error/20 hover:text-status-error transition-all cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-text-muted">
            {search ? 'No conversations match your search' : 'No conversations yet'}
          </div>
        )}
      </div>
    </div>
  );
}
