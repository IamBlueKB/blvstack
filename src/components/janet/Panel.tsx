/**
 * JANET Panel — mounted once in AdminLayout, available on every admin page
 * (spec §4). Owns the one continuous thread and the streaming client; renders
 * it two ways that share the same state (spec §2 docked command stream, §3
 * expanded spatial canvas) with an animated toggle between them (§4).
 *
 * The circuit-glass orb is the identity element across all states — a static-
 * feel launcher when closed, small in the docked header, scaled up as a
 * presence in the expanded world. Only one orb Canvas is mounted at a time, so
 * no WebGL runs beyond the small launcher when the panel is closed.
 *
 * Streaming: POSTs to /api/janet/chat, parses SSE frames
 * (text_delta | tool_start | tool_done | error | done) live. No backend or tool
 * logic here — pure presentation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { PageContext } from '../../lib/janet/types';
import type { ThreadItem, PlanStatus, PlanOutcome } from './thread';
import Orb from './Orb';
import Launcher from './Launcher';
import CommandStream from './CommandStream';
import Composer from './Composer';
import SpatialCanvas from './SpatialCanvas';
import Briefing, { type BriefingContent } from './Briefing';

type Pos = { x: number; y: number };

export type ThreadSummary = {
  id: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  status: string;
  last_message_at: string | null;
};

function readPageContext(): PageContext {
  const injected = (globalThis as any).__JANET_PAGE_CONTEXT__ as Partial<PageContext> | undefined;
  return { path: window.location.pathname, ...(injected ?? {}) };
}

export default function Panel() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadedHistory, setLoadedHistory] = useState(false);
  const [nodePos, setNodePos] = useState<Record<number, Pos>>({});
  // Pulse: increments on every element she emits, driving the orb's surge.
  // emergeBaseline: index from which items belong to the current turn — only
  // those (and not Blue's messages) get the emergence/emanation treatment.
  const [pulse, setPulse] = useState(0);
  const [emergeBaseline, setEmergeBaseline] = useState(0);
  const [briefing, setBriefing] = useState<{ content: BriefingContent; date?: string } | null>(null);
  const [briefingUnread, setBriefingUnread] = useState(false);
  const [showBriefing, setShowBriefing] = useState(false);
  // Feature 1 — threads. The active thread scopes the visible conversation;
  // janet_memory is shared across all of them.
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);
  // New-thread form (name it + optionally attach a client) — spec Feature 1.
  const [newThreadForm, setNewThreadForm] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadClient, setNewThreadClient] = useState('');
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  // Highlight-to-doc (Feature 2): a floating "Send to doc" over a selection.
  const [clipSel, setClipSel] = useState<{ text: string; top: number } | null>(null);
  const [clipToast, setClipToast] = useState<string | null>(null);

  const streamRef = useRef<HTMLDivElement>(null);
  const dockedInputRef = useRef<HTMLTextAreaElement>(null);
  const spatialInputRef = useRef<HTMLTextAreaElement>(null);
  const switchThreadRef = useRef<((id: string) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null); // Stop control for the live turn
  const itemsRef = useRef<ThreadItem[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Briefing: fetch on mount. An unread one glows the orb (briefing-waiting)
  // and pins in the docked view; opening the panel marks it read.
  useEffect(() => {
    fetch('/api/janet/briefing', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { briefing?: { content: BriefingContent; date?: string } | null; unread?: boolean } | null) => {
        if (data?.briefing) {
          setBriefing({ content: data.briefing.content, date: data.briefing.date });
          if (data.unread) {
            setBriefingUnread(true);
            setShowBriefing(true);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Opening the panel with an unread briefing marks it read (orb stops glowing);
  // the card stays pinned until dismissed.
  useEffect(() => {
    if (open && briefingUnread) {
      setBriefingUnread(false);
      fetch('/api/janet/briefing', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }
  }, [open, briefingUnread]);

  // Cmd/Ctrl+J toggles the panel; Esc steps back (expanded → docked → closed).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        if (expanded) setExpanded(false);
        else setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Load threads + the right thread's history the first time the panel opens.
  // On a client-scoped page (client_id in page context) she lands on THAT
  // client's thread — never General or another client's (Feature 1).
  useEffect(() => {
    if (!open || loadedHistory) return;
    setLoadedHistory(true);
    (async () => {
      const pc = readPageContext();
      let list: ThreadSummary[] = [];
      try {
        const data = await (await fetch('/api/janet/threads', { credentials: 'same-origin' })).json();
        list = data.threads ?? [];
      } catch {
        /* leave list empty */
      }

      // Pick the thread to open. Client page → most recent thread for that
      // client, creating one if none exists. Otherwise → most recent overall.
      let targetId: string | null = null;
      if (pc.client_id) {
        const mine = list.filter((t) => t.client_id === pc.client_id); // list is sorted most-recent-first
        if (mine.length) {
          targetId = mine[0].id;
        } else {
          try {
            const created = await (
              await fetch('/api/janet/threads', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: pc.client_name ?? 'General', client_id: pc.client_id }),
              })
            ).json();
            if (created.thread) {
              list = [created.thread as ThreadSummary, ...list];
              targetId = created.thread.id;
            }
          } catch {
            /* fall through to default history */
          }
        }
      }
      setThreads(list);

      const url = targetId ? `/api/janet/history?thread_id=${encodeURIComponent(targetId)}` : '/api/janet/history';
      try {
        const data: { messages?: { role: 'user' | 'assistant'; text: string }[]; thread_id?: string | null } = await (
          await fetch(url, { credentials: 'same-origin' })
        ).json();
        setActiveThreadId(data.thread_id ?? targetId);
        const hist: ThreadItem[] = (data.messages ?? []).map((m) =>
          m.role === 'user' ? { kind: 'user', text: m.text } : { kind: 'assistant', text: m.text }
        );
        setItems((prev) => {
          const next = [...hist, ...prev];
          setEmergeBaseline(next.length); // settle history; nothing emerges until the first live turn
          return next;
        });
      } catch {
        /* leave view empty on failure */
      }
    })();
  }, [open, loadedHistory]);

  // Bridge: other admin pages (e.g. the client hub) can open the panel to a
  // specific thread via a window event.
  useEffect(() => {
    const onOpenThread = (e: Event) => {
      const threadId = (e as CustomEvent).detail?.threadId as string | undefined;
      if (!threadId) return;
      setOpen(true);
      setLoadedHistory(true); // suppress the default-thread history load; we load this one
      // refresh the thread list so a just-created thread appears, then switch.
      fetch('/api/janet/threads', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : { threads: [] }))
        .then((data: { threads?: ThreadSummary[] }) => setThreads(data.threads ?? []))
        .catch(() => {});
      switchThreadRef.current?.(threadId);
    };
    window.addEventListener('janet:open-thread', onOpenThread);
    return () => window.removeEventListener('janet:open-thread', onOpenThread);
  }, []);

  // Switch to a thread: load its history into the view. Memory is unaffected.
  const switchThread = useCallback(
    async (id: string) => {
      if (busy || id === activeThreadId) {
        setThreadMenuOpen(false);
        return;
      }
      setThreadMenuOpen(false);
      setActiveThreadId(id);
      try {
        const r = await fetch(`/api/janet/history?thread_id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
        const data: { messages?: { role: 'user' | 'assistant'; text: string }[] } = r.ok ? await r.json() : { messages: [] };
        const hist: ThreadItem[] = (data.messages ?? []).map((m) =>
          m.role === 'user' ? { kind: 'user', text: m.text } : { kind: 'assistant', text: m.text }
        );
        setItems(hist);
        setEmergeBaseline(hist.length);
        setPulse(0);
      } catch {
        /* leave view as-is on failure */
      }
    },
    [busy, activeThreadId]
  );
  useEffect(() => {
    switchThreadRef.current = switchThread;
  }, [switchThread]);

  // Resume pending Ring 3 approvals whenever the panel opens — an approval
  // survives a closed panel / dropped session and reappears as a plan card.
  useEffect(() => {
    if (!open) return;
    fetch('/api/janet/approve', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { pending: [] }))
      .then((data: { pending?: { id: string; proposals: any[] }[] }) => {
        const pend = data.pending ?? [];
        if (pend.length === 0) return;
        setItems((prev) => {
          const have = new Set(prev.filter((it): it is Extract<ThreadItem, { kind: 'plan' }> => it.kind === 'plan').map((it) => it.approval_id).filter(Boolean));
          const add = pend
            .filter((p) => !have.has(p.id))
            .map((p) => ({ kind: 'plan' as const, proposals: p.proposals, status: 'pending' as const, approval_id: p.id }));
          return add.length ? [...prev, ...add] : prev;
        });
      })
      .catch(() => {});
  }, [open]);

  // Autoscroll the docked stream.
  useEffect(() => {
    if (open && !expanded && streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [items, open, expanded]);

  // Focus the relevant composer.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => (expanded ? spatialInputRef : dockedInputRef).current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open, expanded]);

  const moveNode = useCallback((i: number, p: Pos) => setNodePos((prev) => ({ ...prev, [i]: p })), []);

  const resolvePlan = useCallback(
    (i: number, status: PlanStatus, outcomes?: PlanOutcome[]) =>
      setItems((prev) =>
        prev.map((it, idx) =>
          idx === i && it.kind === 'plan' ? { ...it, status, outcomes: outcomes ?? it.outcomes } : it
        )
      ),
    []
  );

  // New chat: create a fresh thread and switch to it. Her memory persists across
  // every thread — this only opens a clean conversation (Feature 1).
  const newChat = useCallback(async () => {
    if (busy) return;
    const pc = readPageContext();
    try {
      const r = await fetch('/api/janet/threads', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          pc.client_id
            ? { title: `${pc.client_name ?? 'Client'} — new chat`, client_id: pc.client_id }
            : { title: 'New chat' }
        ),
      });
      const data: { thread?: ThreadSummary } = r.ok ? await r.json() : {};
      if (data.thread) {
        setThreads((prev) => [data.thread as ThreadSummary, ...prev]);
        setActiveThreadId(data.thread.id);
      }
    } catch {
      /* still clear the view even if create failed */
    }
    setItems([]);
    setEmergeBaseline(0);
    setPulse(0);
  }, [busy]);

  // Open the explicit new-thread form (name it + optionally attach a client).
  // Lazy-loads the client list the first time.
  const openNewThreadForm = useCallback(() => {
    const pc = readPageContext();
    setNewThreadTitle('');
    setNewThreadClient(pc.client_id ?? ''); // default to the page's client if any
    setNewThreadForm(true);
    if (clients.length === 0) {
      fetch('/api/admin/janet/clients', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : { clients: [] }))
        .then((d: { clients?: { id: string; name: string }[] }) => setClients(d.clients ?? []))
        .catch(() => {});
    }
  }, [clients.length]);

  // Create a named thread (optionally client-attached) and switch to it.
  const createNamedThread = useCallback(async () => {
    const title = newThreadTitle.trim();
    if (!title) return;
    try {
      const r = await fetch('/api/janet/threads', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, client_id: newThreadClient || null }),
      });
      const data: { thread?: ThreadSummary } = r.ok ? await r.json() : {};
      if (data.thread) {
        setThreads((prev) => [data.thread as ThreadSummary, ...prev]);
        setActiveThreadId(data.thread.id);
        setItems([]);
        setEmergeBaseline(0);
        setPulse(0);
      }
    } catch {
      /* leave form; nothing created */
    }
    setNewThreadForm(false);
    setThreadMenuOpen(false);
  }, [newThreadTitle, newThreadClient]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    setEmergeBaseline(itemsRef.current.length); // her elements this turn emerge; the user line does not
    setItems((prev) => [...prev, { kind: 'user', text: message }]);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const resp = await fetch('/api/janet/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, page_context: readPageContext(), thread_id: activeThreadId }),
        signal: ac.signal,
      });
      if (!resp.ok || !resp.body) {
        setItems((prev) => [...prev, { kind: 'error', text: `Request failed (${resp.status})` }]);
        setBusy(false);
        return;
      }

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let assistantOpen = false;

      const ensureAssistant = () => {
        if (assistantOpen) return;
        assistantOpen = true;
        setItems((prev) => [...prev, { kind: 'assistant', text: '' }]);
        setPulse((p) => p + 1); // a new text element emerges
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!frame.startsWith('data: ')) continue;
          let ev: any;
          try {
            ev = JSON.parse(frame.slice(6));
          } catch {
            continue;
          }
          if (ev.type === 'text_delta') {
            ensureAssistant();
            setItems((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.kind === 'assistant') next[next.length - 1] = { kind: 'assistant', text: last.text + ev.text };
              return next;
            });
          } else if (ev.type === 'tool_start') {
            assistantOpen = false;
            setItems((prev) => [...prev, { kind: 'tool', name: ev.name, status: 'running' }]);
            setPulse((p) => p + 1); // a tool line emerges
          } else if (ev.type === 'tool_done') {
            setItems((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                const t = next[i];
                if (t.kind === 'tool' && t.name === ev.name && t.status === 'running') {
                  next[i] = { kind: 'tool', name: ev.name, status: 'done', ok: ev.ok, summary: ev.summary };
                  break;
                }
              }
              return next;
            });
          } else if (ev.type === 'plan') {
            assistantOpen = false;
            setItems((prev) => [...prev, { kind: 'plan', proposals: ev.proposals, status: 'pending', approval_id: ev.approval_id ?? null }]);
            setPulse((p) => p + 1); // a plan emerges from the orb
          } else if (ev.type === 'audit') {
            assistantOpen = false;
            setItems((prev) => [...prev, { kind: 'audit', tool: ev.tool, result: ev.result }]);
            setPulse((p) => p + 1); // the audit card emerges from the orb
          } else if (ev.type === 'error') {
            setItems((prev) => [...prev, { kind: 'error', text: ev.message }]);
            setPulse((p) => p + 1);
          }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setItems((prev) => [...prev, { kind: 'tool', name: 'stopped', status: 'done', ok: true, summary: 'halted' }]);
      } else {
        setItems((prev) => [...prev, { kind: 'error', text: e?.message ?? 'Stream error' }]);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [input, busy, activeThreadId]);

  // Stop control — abort the in-flight fetch; the server cancels the turn and
  // stops calling the model.
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const orbState = busy ? 'working' : briefingUnread ? 'briefing' : 'idle';
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // Highlight-to-doc: capture a selection inside the stream → offer "Send to doc".
  const onStreamMouseUp = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (text.length > 2) {
      const container = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setClipSel({ text, top: e.clientY - container.top });
    } else {
      setClipSel(null);
    }
  }, []);

  const sendToDoc = useCallback(async () => {
    if (!clipSel) return;
    const pc = readPageContext();
    const source = activeThread ? `re: ${activeThread.title}` : undefined;
    try {
      const r = await fetch('/api/janet/docs/clip', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: clipSel.text,
          source,
          client_id: activeThread?.client_id ?? pc.client_id ?? null,
          client_name: activeThread?.client_name ?? pc.client_name ?? null,
        }),
      });
      const d: { title?: string; url?: string; clip_count?: number } = r.ok ? await r.json() : {};
      setClipToast(d.title ? `Sent to "${d.title}"${d.clip_count ? ` (${d.clip_count} clips)` : ''}` : 'Sent to doc');
      setTimeout(() => setClipToast(null), 3200);
    } catch {
      setClipToast('Send failed');
      setTimeout(() => setClipToast(null), 3200);
    }
    setClipSel(null);
    window.getSelection()?.removeAllRanges();
  }, [clipSel, activeThread]);

  // Switcher grouping (spec Feature 1): client groups first (recent activity
  // first), then standalone. `threads` is already sorted most-recent-first, so
  // insertion order into each bucket preserves recency.
  const threadGroups = (() => {
    const byClient = new Map<string, { name: string; threads: ThreadSummary[] }>();
    const standalone: ThreadSummary[] = [];
    for (const t of threads) {
      if (t.client_id) {
        const g = byClient.get(t.client_id) ?? { name: t.client_name ?? 'Client', threads: [] };
        g.threads.push(t);
        byClient.set(t.client_id, g);
      } else {
        standalone.push(t);
      }
    }
    return { clientGroups: [...byClient.values()], standalone };
  })();

  return (
    <>
      {/* ── Launcher orb (closed) — draggable, persisted, gentle drift ── */}
      <AnimatePresence>
        {!open && <Launcher key="launcher" state={orbState} onOpen={() => setOpen(true)} />}
      </AnimatePresence>

      {/* ── Docked command stream ── */}
      <AnimatePresence>
        {open && !expanded && (
          <motion.div
            key="docked"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
            className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] flex flex-col bg-navy/95 backdrop-blur-xl border-l border-white/10 shadow-2xl shadow-black/60"
            style={{ colorScheme: 'dark' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between pl-2 pr-3 h-14 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <Orb state={orbState} size={36} active halo={false} pulseSignal={pulse} />
                <span className="font-mono text-[11px] tracking-[0.28em] uppercase text-cream">JANET</span>
                <span className="font-mono text-[9px] tracking-widest uppercase text-slate/50">{busy ? 'working' : 'idle'}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={newChat}
                  aria-label="New chat (archives this thread; memory persists)"
                  title="New chat"
                  className="text-slate hover:text-cream transition-colors p-1.5"
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                    <path d="M8.5 2h-5A1.5 1.5 0 0 0 2 3.5v8A1.5 1.5 0 0 0 3.5 13h8A1.5 1.5 0 0 0 13 11.5v-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <path d="M10 2.2 12.8 5 8.5 9.3l-2.8.4.4-2.8L10 2.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                </button>
                <a
                  href="/admin/notepad"
                  aria-label="Open discovery notepad"
                  title="Discovery notepad"
                  className="text-slate hover:text-cream transition-colors p-1.5"
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                    <path d="M4 1.5h5.5L12.5 4.5V13.5H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M9.25 1.5V4.5H12.5M6 7.5h4.5M6 10h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
                <button
                  onClick={() => setExpanded(true)}
                  aria-label="Expand to spatial view"
                  title="Expand"
                  className="text-slate hover:text-cream transition-colors p-1.5"
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
                    <path d="M9 1H14V6M6 14H1V9M14 1L9 6M1 14L6 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-slate hover:text-cream transition-colors p-1.5 font-mono text-xs"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Thread switcher (Feature 1) — active thread + dropdown of the rest.
                Memory is shared across threads; switching only changes the view. */}
            <div className="relative border-b border-white/10 shrink-0">
              <button
                onClick={() => setThreadMenuOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 h-9 text-left hover:bg-white/5 transition-colors"
                title="Switch thread"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <svg width="12" height="12" viewBox="0 0 15 15" fill="none" aria-hidden className="text-slate/60 shrink-0">
                    <path d="M2 4h11M2 7.5h11M2 11h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  <span className="font-mono text-[10px] tracking-wider uppercase text-cream/80 truncate">
                    {activeThread ? activeThread.title : 'General'}
                    {activeThread?.client_name && <span className="text-gold/70"> · {activeThread.client_name}</span>}
                  </span>
                </span>
                <svg width="10" height="10" viewBox="0 0 15 15" fill="none" aria-hidden className={`text-slate/50 shrink-0 transition-transform ${threadMenuOpen ? 'rotate-180' : ''}`}>
                  <path d="M3.5 5.5 7.5 9.5 11.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {threadMenuOpen && (
                <div className="absolute left-0 right-0 top-full z-10 max-h-80 overflow-y-auto bg-navy/98 backdrop-blur-xl border-b border-white/10 shadow-2xl shadow-black/60">
                  {/* New thread — name it + optionally attach a client */}
                  {newThreadForm ? (
                    <div className="p-3 border-b border-white/10 flex flex-col gap-2">
                      <input
                        autoFocus
                        value={newThreadTitle}
                        onChange={(e) => setNewThreadTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') createNamedThread(); if (e.key === 'Escape') setNewThreadForm(false); }}
                        placeholder="Thread name…"
                        className="w-full bg-white/[0.04] border border-white/10 rounded px-2.5 py-1.5 text-cream text-[12px] focus:outline-none focus:border-electric/50"
                      />
                      <select
                        value={newThreadClient}
                        onChange={(e) => setNewThreadClient(e.target.value)}
                        className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-cream/90 text-[11px] focus:outline-none focus:border-electric/50"
                        style={{ colorScheme: 'dark' }}
                      >
                        <option value="">Standalone (no client)</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id} className="bg-navy">{c.name}</option>
                        ))}
                      </select>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setNewThreadForm(false)} className="font-mono text-[9px] tracking-widest uppercase text-slate hover:text-cream px-2 py-1.5">Cancel</button>
                        <button onClick={createNamedThread} disabled={!newThreadTitle.trim()} className="font-mono text-[9px] tracking-widest uppercase bg-electric text-navy px-3 py-1.5 disabled:opacity-40">Create</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={openNewThreadForm}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors border-b border-white/10"
                    >
                      <span className="font-mono text-[13px] text-electric leading-none">+</span>
                      <span className="font-mono text-[10px] tracking-wider uppercase text-electric/90">New thread</span>
                    </button>
                  )}

                  {threads.length === 0 && (
                    <div className="px-3 py-2 font-mono text-[10px] text-slate/50">No threads yet.</div>
                  )}

                  {/* Client groups first, then standalone (spec Feature 1) */}
                  {threadGroups.clientGroups.map((g) => (
                    <div key={g.name}>
                      <p className="px-3 pt-2 pb-1 font-mono text-[8px] tracking-[0.2em] uppercase text-gold/60">{g.name}</p>
                      {g.threads.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => switchThread(t.id)}
                          className={`w-full flex items-center px-3 py-1.5 pl-5 text-left hover:bg-white/5 transition-colors ${t.id === activeThreadId ? 'bg-white/5' : ''}`}
                        >
                          <span className="font-mono text-[11px] text-cream/90 truncate">{t.title}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {threadGroups.standalone.length > 0 && (
                    <div>
                      <p className="px-3 pt-2 pb-1 font-mono text-[8px] tracking-[0.2em] uppercase text-slate/40">Standalone</p>
                      {threadGroups.standalone.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => switchThread(t.id)}
                          className={`w-full flex items-center px-3 py-1.5 pl-5 text-left hover:bg-white/5 transition-colors ${t.id === activeThreadId ? 'bg-white/5' : ''}`}
                        >
                          <span className="font-mono text-[11px] text-cream/90 truncate">{t.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {showBriefing && briefing && (
              <Briefing content={briefing.content} date={briefing.date} onDismiss={() => setShowBriefing(false)} />
            )}
            <div className="relative flex-1 min-h-0 flex flex-col" onMouseUp={onStreamMouseUp}>
              <CommandStream ref={streamRef} items={items} busy={busy} emergeFrom={emergeBaseline} onResolvePlan={resolvePlan} />
              {clipSel && (
                <button
                  onClick={sendToDoc}
                  style={{ top: Math.max(4, clipSel.top - 34) }}
                  className="absolute right-3 z-20 font-mono text-[9px] tracking-widest uppercase bg-electric text-navy px-2.5 py-1.5 shadow-lg shadow-black/40 hover:bg-electric/90"
                >
                  ↗ Send to doc
                </button>
              )}
              {clipToast && (
                <div className="absolute bottom-3 left-3 right-3 z-20 font-mono text-[10px] text-cream/90 bg-navy border border-electric/30 px-3 py-2 shadow-lg shadow-black/40">
                  {clipToast}
                </div>
              )}
            </div>

            <div className="border-t border-white/10 p-3 shrink-0">
              <Composer ref={dockedInputRef} value={input} onChange={setInput} onSend={send} onStop={stop} busy={busy} variant="docked" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Expanded spatial canvas ── */}
      <AnimatePresence>
        {open && expanded && (
          <SpatialCanvas
            key="spatial"
            items={items}
            busy={busy}
            pos={nodePos}
            onMove={moveNode}
            onCollapse={() => setExpanded(false)}
            input={input}
            setInput={setInput}
            onSend={send}
            onStop={stop}
            composerRef={spatialInputRef}
            emergeFrom={emergeBaseline}
            pulseSignal={pulse}
            onResolvePlan={resolvePlan}
            briefing={showBriefing ? briefing : null}
            onDismissBriefing={() => setShowBriefing(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
