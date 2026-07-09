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

type Pos = { x: number; y: number };

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

  const streamRef = useRef<HTMLDivElement>(null);
  const dockedInputRef = useRef<HTMLTextAreaElement>(null);
  const spatialInputRef = useRef<HTMLTextAreaElement>(null);
  const itemsRef = useRef<ThreadItem[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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

  // Load the continuous thread the first time the panel opens.
  useEffect(() => {
    if (!open || loadedHistory) return;
    setLoadedHistory(true);
    fetch('/api/janet/history', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages?: { role: 'user' | 'assistant'; text: string }[] }) => {
        const hist: ThreadItem[] = (data.messages ?? []).map((m) =>
          m.role === 'user' ? { kind: 'user', text: m.text } : { kind: 'assistant', text: m.text }
        );
        setItems((prev) => {
          const next = [...hist, ...prev];
          setEmergeBaseline(next.length); // settle history; nothing emerges until the first live turn
          return next;
        });
      })
      .catch(() => {});
  }, [open, loadedHistory]);

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

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    setEmergeBaseline(itemsRef.current.length); // her elements this turn emerge; the user line does not
    setItems((prev) => [...prev, { kind: 'user', text: message }]);

    try {
      const resp = await fetch('/api/janet/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, page_context: readPageContext() }),
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
            setItems((prev) => [...prev, { kind: 'plan', proposals: ev.proposals, status: 'pending' }]);
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
      setItems((prev) => [...prev, { kind: 'error', text: e?.message ?? 'Stream error' }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy]);

  const orbState = busy ? 'working' : 'idle';

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

            <CommandStream ref={streamRef} items={items} busy={busy} emergeFrom={emergeBaseline} onResolvePlan={resolvePlan} />

            <div className="border-t border-white/10 p-3 shrink-0">
              <Composer ref={dockedInputRef} value={input} onChange={setInput} onSend={send} busy={busy} variant="docked" />
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
            composerRef={spatialInputRef}
            emergeFrom={emergeBaseline}
            pulseSignal={pulse}
            onResolvePlan={resolvePlan}
          />
        )}
      </AnimatePresence>
    </>
  );
}
