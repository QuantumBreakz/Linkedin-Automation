'use client';

/**
 * The chat workspace: a conversation list, a strip of open tabs, and one
 * thread at a time.
 *
 * Everything it renders comes from `/api/chat/*`, which only ever returns the
 * signed-in user's rows. Which tabs are open — the one piece of state that
 * outlives a reload — is persisted server-side via `/api/chat/tabs` (keyed by
 * the session user), so the workspace follows the account across devices and a
 * shared browser cannot surface the previous person's threads. Saved state is
 * always filtered to the caller's own live conversations on load.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Conversation {
  id: string;
  title: string;
  pinned: boolean;
  lastMessageAt: string;
  messageCount: number;
  preview: string;
}

interface Message {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  draftId: string | null;
  createdAt: string;
}

const MAX_TABS = 6;

const STARTERS = [
  'Draft a post about my latest paper for a non-specialist audience.',
  'Rewrite this opening line so it earns the click without overselling.',
  'What angle would make this finding interesting to clinicians?',
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function ChatWorkspace({ userName }: { userName: string }) {
  const router = useRouter();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<Record<string, string>>({});

  const threadRef = useRef<HTMLDivElement>(null);
  /** Counter for optimistic message keys — no clock needed, and never collides. */
  const pendingSeq = useRef(0);
  /** Gate the tab-persistence effect until the server state has been restored,
   *  so the initial empty render never overwrites what was saved. */
  const hydrated = useRef(false);

  // ────────────────────────────  loading  ────────────────────────────

  const loadConversations = useCallback(async (): Promise<Conversation[]> => {
    const res = await fetch('/api/chat/conversations');
    if (!res.ok) return [];
    const data = (await res.json()) as { conversations: Conversation[] };
    setConversations(data.conversations);
    return data.conversations;
  }, []);

  const loadTabs = useCallback(async (): Promise<{ openIds: string[]; activeId: string | null }> => {
    try {
      const res = await fetch('/api/chat/tabs');
      if (!res.ok) return { openIds: [], activeId: null };
      return (await res.json()) as { openIds: string[]; activeId: string | null };
    } catch {
      return { openIds: [], activeId: null };
    }
  }, []);

  const openThread = useCallback(async (id: string) => {
    setActiveId(id);
    setLoadingThread(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${id}`);
      if (!res.ok) {
        setError('That conversation is no longer available.');
        setMessages([]);
        return;
      }
      const data = (await res.json()) as { messages: Message[] };
      setMessages(data.messages);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  const addTab = useCallback((id: string) => {
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id].slice(-MAX_TABS)));
  }, []);

  const selectConversation = useCallback(
    (id: string) => {
      addTab(id);
      void openThread(id);
    },
    [addTab, openThread],
  );

  const startConversation = useCallback(async () => {
    const res = await fetch('/api/chat/conversations', { method: 'POST' });
    if (!res.ok) {
      setError('Could not start a new chat.');
      return;
    }
    const data = (await res.json()) as { conversation: Conversation };
    setConversations((prev) => [{ ...data.conversation, messageCount: 0, preview: '' }, ...prev]);
    setMessages([]);
    addTab(data.conversation.id);
    setActiveId(data.conversation.id);
  }, [addTab]);

  // Restore the previous session's tabs from the server, then open the thread
  // that was focused last (falling back to the most recent).
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [list, saved] = await Promise.all([loadConversations(), loadTabs()]);
      if (cancelled) return;

      // Only keep ids that still belong to a live conversation — this both
      // drops deleted threads and guarantees a stale/foreign id is never shown.
      const alive = new Set(list.map((c) => c.id));
      const restored = saved.openIds.filter((id) => alive.has(id));
      const openList = restored.length > 0 ? restored : list[0] ? [list[0].id] : [];

      const savedActive =
        saved.activeId && openList.includes(saved.activeId) ? saved.activeId : null;
      const active = savedActive ?? openList[0] ?? null;

      setOpenTabs(openList);
      if (active) void openThread(active);

      // From here on, tab changes are the user's, so it is safe to persist.
      hydrated.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [loadConversations, loadTabs, openThread]);

  // Persist tab state server-side, debounced so rapid open/close/switch bursts
  // collapse into one write. Skipped until the initial restore has run.
  useEffect(() => {
    if (!hydrated.current) return;
    const handle = setTimeout(() => {
      void fetch('/api/chat/tabs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openIds: openTabs, activeId }),
      }).catch(() => {
        // A failed save is non-fatal — the tabs still work this session.
      });
    }, 500);
    return () => clearTimeout(handle);
  }, [openTabs, activeId]);

  // Pin to the newest message. The rAF matters: on a thread that has just been
  // swapped in, layout has not settled when the effect runs, so scrollHeight is
  // still the previous thread's and the jump lands short.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const node = threadRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, sending, activeId]);

  // ────────────────────────────  actions  ────────────────────────────

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;

    let conversationId = activeId;

    // Typing into an empty workspace should just work: make the thread first.
    if (!conversationId) {
      const res = await fetch('/api/chat/conversations', { method: 'POST' });
      if (!res.ok) {
        setError('Could not start a new chat.');
        return;
      }
      const data = (await res.json()) as { conversation: Conversation };
      conversationId = data.conversation.id;
      setConversations((prev) => [{ ...data.conversation, messageCount: 0, preview: '' }, ...prev]);
      setActiveId(conversationId);
      addTab(conversationId);
    }

    setSending(true);
    setError(null);
    setInput('');

    pendingSeq.current += 1;
    const optimistic: Message = {
      id: `pending-${pendingSeq.current}`,
      role: 'USER',
      content,
      draftId: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'The message could not be sent.');
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setInput(content);
        return;
      }

      const data = (await res.json()) as {
        userMessage: Message;
        assistantMessage: Message;
        conversationTitle: string;
      };

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        data.userMessage,
        data.assistantMessage,
      ]);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                title: data.conversationTitle,
                preview: data.assistantMessage.content.slice(0, 120),
                lastMessageAt: data.assistantMessage.createdAt,
                messageCount: c.messageCount + 2,
              }
            : c,
        ),
      );
    } catch {
      setError('The message could not be sent.');
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(content);
    } finally {
      setSending(false);
    }
  }

  async function saveAsDraft(messageId: string) {
    const res = await fetch(`/api/chat/messages/${messageId}/draft`, { method: 'POST' });
    if (!res.ok) {
      setError('Could not save that reply as a draft.');
      return;
    }
    const data = (await res.json()) as { draftId: string };
    setSavedDrafts((prev) => ({ ...prev, [messageId]: data.draftId }));
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, draftId: data.draftId } : m)),
    );
    router.refresh();
  }

  async function removeConversation(id: string) {
    const res = await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
    if (!res.ok) return;

    setConversations((prev) => prev.filter((c) => c.id !== id));
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== id);
      if (activeId === id) {
        const fallback = next[next.length - 1] ?? null;
        setActiveId(fallback);
        if (fallback) void openThread(fallback);
        else setMessages([]);
      }
      return next;
    });
  }

  function closeTab(id: string) {
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== id);
      if (activeId === id) {
        const fallback = next[next.length - 1] ?? null;
        setActiveId(fallback);
        if (fallback) void openThread(fallback);
        else setMessages([]);
      }
      return next;
    });
  }

  // ────────────────────────────  render  ─────────────────────────────

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(needle) || c.preview.toLowerCase().includes(needle),
    );
  }, [conversations, search]);

  const tabConversations = openTabs
    .map((id) => conversations.find((c) => c.id === id))
    .filter((c): c is Conversation => Boolean(c));

  return (
    <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
      {/* ── conversation list ── */}
      <aside className="card flex max-h-[32rem] flex-col p-5 lg:max-h-[calc(100vh-13rem)]">
        <div className="mb-4 flex items-center justify-between">
          <p className="label mb-0">Chats · {conversations.length}</p>
          <button
            type="button"
            onClick={() => void startConversation()}
            className="btn btn-primary btn-sm"
          >
            + New
          </button>
        </div>

        <input
          className="input mb-3 py-2.5 text-xs"
          placeholder="Search chats…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="-mr-2 flex-1 space-y-1.5 overflow-y-auto pr-2">
          {filtered.length === 0 && (
            <p className="px-1 py-6 text-center text-xs text-ink-500">
              {conversations.length === 0 ? 'No chats yet.' : 'Nothing matches that search.'}
            </p>
          )}

          {filtered.map((conversation) => {
            const active = conversation.id === activeId;
            return (
              <div
                key={conversation.id}
                className={`group flex items-start gap-2 rounded-2xl px-3 py-2.5 transition-colors ${
                  active ? 'bg-ink-900 text-cream-100' : 'hover:bg-cream-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectConversation(conversation.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[0.8rem] font-semibold">
                      {conversation.title}
                    </span>
                    <span
                      className={`shrink-0 text-[0.65rem] ${active ? 'text-cream-100/50' : 'text-ink-500'}`}
                    >
                      {relativeTime(conversation.lastMessageAt)}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 truncate text-[0.7rem] ${
                      active ? 'text-cream-100/55' : 'text-ink-500'
                    }`}
                  >
                    {conversation.preview || 'No messages yet'}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void removeConversation(conversation.id)}
                  aria-label={`Delete ${conversation.title}`}
                  className={`mt-0.5 rounded-full px-1.5 text-sm leading-none opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${
                    active ? 'text-cream-100/60' : 'text-ink-500 hover:text-rust-500'
                  }`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── thread ── */}
      <section className="card flex min-h-[32rem] flex-col p-0 lg:h-[calc(100vh-13rem)]">
        {tabConversations.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto border-b border-ink-900/8 px-4 pb-3 pt-4">
            {tabConversations.map((conversation) => {
              const active = conversation.id === activeId;
              return (
                <div
                  key={conversation.id}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pl-3.5 pr-2 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-clay-500 text-cream-50'
                      : 'bg-cream-50 text-ink-600 hover:text-ink-900'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void openThread(conversation.id)}
                    className="max-w-[10rem] truncate"
                  >
                    {conversation.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeTab(conversation.id)}
                    aria-label={`Close ${conversation.title} tab`}
                    className="rounded-full px-1 text-sm leading-none opacity-70 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div ref={threadRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-6 sm:px-7">
          {error && (
            <p role="alert" className="rounded-2xl bg-rust-100 px-4 py-3 text-xs text-rust-500">
              {error}
            </p>
          )}

          {loadingThread && <p className="text-xs text-ink-500">Loading…</p>}

          {!loadingThread && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-sm font-semibold text-ink-700">
                {activeId ? 'Say something to get started' : `Hello, ${userName}`}
              </p>
              <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-500">
                Ask for a post, a rewrite, or a different angle. Any reply can be saved as a draft
                and sent through your approval flow.
              </p>
              <div className="mt-6 flex w-full max-w-md flex-col gap-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void send(starter)}
                    className="rounded-2xl bg-cream-50 px-4 py-3 text-left text-xs text-ink-700 transition-colors hover:bg-white"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => {
            const mine = message.role === 'USER';
            const draftId = message.draftId ?? savedDrafts[message.id];
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${mine ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`whitespace-pre-wrap rounded-3xl px-5 py-3.5 text-sm leading-relaxed ${
                      mine
                        ? 'rounded-br-lg bg-ink-900 text-cream-100'
                        : 'rounded-bl-lg bg-cream-50 text-ink-800'
                    }`}
                  >
                    {message.content}
                  </div>

                  {!mine && (
                    <div className="mt-2 flex items-center gap-2 pl-1">
                      {draftId ? (
                        <a href={`/drafts/${draftId}`} className="btn btn-quiet btn-sm">
                          Review draft →
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void saveAsDraft(message.id)}
                          className="btn btn-quiet btn-sm"
                        >
                          Save as post draft
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard?.writeText(message.content)}
                        className="text-[0.7rem] font-medium text-ink-500 hover:text-clay-600"
                      >
                        Copy
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-3xl rounded-bl-lg bg-cream-50 px-5 py-3.5 text-sm text-ink-500">
                Thinking…
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
          className="border-t border-ink-900/8 px-5 py-4 sm:px-7"
        >
          <div className="flex items-end gap-2.5">
            <textarea
              className="textarea max-h-40 min-h-[3rem] py-3"
              rows={1}
              value={input}
              placeholder="Ask for a draft, an angle, a rewrite…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
            />
            <button
              type="submit"
              disabled={sending || input.trim().length === 0}
              className="btn btn-primary shrink-0"
            >
              Send
            </button>
          </div>
          <p className="mt-2 text-[0.65rem] text-ink-500">
            Enter to send · Shift + Enter for a new line. Replies are drafts, never posted directly.
          </p>
        </form>
      </section>
    </div>
  );
}
