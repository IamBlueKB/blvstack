/**
 * JANET — The Doc (Feature 2). A full-page AI writing workspace, NOT a panel.
 * Block editor (reuses the notepad's block foundation, richer block types),
 * autosave, inline AI assist (select → rewrite/expand/tighten; restructure the
 * whole doc), version history (restore any prior state), export (md/pdf/docx),
 * and a doc-aware chat that runs through the shared brain (so plan-approve-execute,
 * memory, and structure-and-file all work). janet_memory is shared across every
 * doc and thread.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { blockId, markdownToBlocks, docToMarkdown, type DocBlock } from '../../lib/janet/doc-blocks';

type DocMeta = {
  id: string;
  title: string;
  client_id: string | null;
  client_name?: string | null;
  deal_id: string | null;
  doc_type: string | null;
  content: DocBlock[];
};
type Version = { id: string; label: string | null; created_by: string | null; created_at: string };
type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; status: 'running' | 'done'; ok?: boolean; summary?: string }
  | { kind: 'plan'; proposals: any[]; approval_id: string | null; status: 'pending' | 'approved' | 'rejected' }
  | { kind: 'error'; text: string };

const emptyText = (): DocBlock => ({ id: blockId(), type: 'text', text: '' });

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
  return data;
}

export default function DocEditor({ doc: initial }: { doc: DocMeta }) {
  const [title, setTitle] = useState(initial.title);
  const [blocks, setBlocks] = useState<DocBlock[]>(() => (initial.content?.length ? initial.content : [emptyText()]));
  const [saved, setSaved] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [panel, setPanel] = useState<'none' | 'versions' | 'chat'>('chat');
  const [assist, setAssist] = useState<{ top: number; op?: string } | null>(null);
  const [assisting, setAssisting] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selRef = useRef<{ id: string; start: number; end: number } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // ── Autosave (debounced) ──
  const persist = useCallback((nextBlocks: DocBlock[], nextTitle: string) => {
    setSaved('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api(`/api/janet/docs/${initial.id}`, 'PUT', { content: nextBlocks, title: nextTitle });
        setSaved('saved');
      } catch {
        setSaved('dirty');
      }
    }, 700);
  }, [initial.id]);

  useEffect(() => {
    persist(blocks, title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, title]);

  const setBlockText = (id: string, text: string) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, text } : b)));
  const toggleCheck = (id: string) => setBlocks((bs) => bs.map((b) => (b.id === id && b.type === 'checklist' ? { ...b, checked: !b.checked } : b)));

  // ── Markdown shortcuts + Enter/Backspace block behavior ──
  const onBlockKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, idx: number) => {
    const b = blocks[idx];
    const ta = e.currentTarget;
    // Space triggers markdown transforms at the start of a text block.
    if (e.key === ' ' && b.type === 'text' && ta.selectionStart === ta.selectionEnd) {
      const prefix = b.text.slice(0, ta.selectionStart);
      const m = transformPrefix(prefix);
      if (m) {
        e.preventDefault();
        const rest = b.text.slice(ta.selectionStart);
        setBlocks((bs) => bs.map((x, i) => (i === idx ? { ...m.make(rest) } : x)));
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const before = ('text' in b ? b.text : '').slice(0, ta.selectionStart);
      const after = ('text' in b ? b.text : '').slice(ta.selectionEnd);
      // Continue lists; otherwise a new text block.
      const nb: DocBlock =
        b.type === 'bullet' ? { id: blockId(), type: 'bullet', text: after }
        : b.type === 'checklist' ? { id: blockId(), type: 'checklist', text: after, checked: false }
        : { id: blockId(), type: 'text', text: after };
      setBlocks((bs) => {
        const c = [...bs];
        c[idx] = { ...(b as any), text: before };
        c.splice(idx + 1, 0, nb);
        return c;
      });
      queueFocus(nb.id, 0);
    } else if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      if (b.type !== 'text' && 'text' in b) {
        // First backspace demotes a styled block back to plain text.
        e.preventDefault();
        setBlocks((bs) => bs.map((x, i) => (i === idx ? { id: x.id, type: 'text', text: (x as any).text } : x)));
        return;
      }
      const prev = blocks[idx - 1];
      if (prev && 'text' in prev) {
        e.preventDefault();
        const caret = prev.text.length;
        setBlocks((bs) => {
          const c = [...bs];
          c[idx - 1] = { ...(prev as any), text: prev.text + (b as any).text };
          c.splice(idx, 1);
          return c;
        });
        queueFocus(prev.id, caret);
      }
    }
  };

  const focusReq = useRef<{ id: string; caret: number } | null>(null);
  const queueFocus = (id: string, caret: number) => { focusReq.current = { id, caret }; };
  useEffect(() => {
    const fr = focusReq.current;
    if (!fr) return;
    const el = editorRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-bid="${fr.id}"]`);
    if (el) { el.focus(); const c = Math.min(fr.caret, el.value.length); el.setSelectionRange(c, c); }
    focusReq.current = null;
  }, [blocks]);

  // ── Selection tracking for inline assist ──
  const onSelect = (id: string, e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (ta.selectionStart !== ta.selectionEnd) {
      selRef.current = { id, start: ta.selectionStart, end: ta.selectionEnd };
      const rect = ta.getBoundingClientRect();
      const wrap = editorRef.current?.getBoundingClientRect();
      setAssist({ top: rect.top - (wrap?.top ?? 0) - 8 });
    } else {
      selRef.current = null;
      setAssist(null);
    }
  };

  const runAssist = async (op: 'rewrite' | 'expand' | 'tighten') => {
    const sel = selRef.current;
    if (!sel) return;
    const b = blocks.find((x) => x.id === sel.id);
    if (!b || !('text' in b)) return;
    const text = b.text.slice(sel.start, sel.end);
    if (!text.trim()) return;
    setAssisting(true);
    try {
      const { text: out } = await api(`/api/janet/docs/${initial.id}/assist`, 'POST', { op, text });
      setBlocks((bs) => bs.map((x) => (x.id === sel.id && 'text' in x ? { ...x, text: x.text.slice(0, sel.start) + out + x.text.slice(sel.end) } : x)));
    } catch (e) {
      alert('Assist failed: ' + (e as Error).message);
    } finally {
      setAssisting(false);
      setAssist(null);
      selRef.current = null;
    }
  };

  const restructure = async () => {
    setAssisting(true);
    try {
      const { text: out } = await api(`/api/janet/docs/${initial.id}/assist`, 'POST', { op: 'restructure', text: docToMarkdown({ title, content: blocks }) });
      setBlocks(markdownToBlocks(out));
    } catch (e) {
      alert('Restructure failed: ' + (e as Error).message);
    } finally {
      setAssisting(false);
    }
  };

  // Send the current selection into the doc chat as a question.
  const askAboutSelection = () => {
    const sel = selRef.current;
    if (!sel) return;
    const b = blocks.find((x) => x.id === sel.id);
    if (!b || !('text' in b)) return;
    const text = b.text.slice(sel.start, sel.end).trim();
    if (!text) return;
    setPanel('chat');
    chatSendRef.current?.(`About this part of the doc:\n\n"${text}"\n\nWhat do you think?`);
    setAssist(null);
  };
  const chatSendRef = useRef<((msg: string) => void) | null>(null);

  return (
    <div className="flex gap-0 -mx-6 md:-mx-10 -my-10 min-h-screen">
      {/* ── Document surface ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="sticky top-0 z-20 bg-navy/95 backdrop-blur border-b border-white/10 px-6 md:px-10 py-3 flex items-center gap-3">
          <a href="/admin/docs" className="font-mono text-[10px] tracking-widest uppercase text-slate hover:text-electric transition-colors shrink-0">← Docs</a>
          <span className="font-mono text-[9px] uppercase tracking-widest text-slate/40 shrink-0">{saved === 'saving' ? 'saving…' : saved === 'dirty' ? 'unsaved' : 'saved'}</span>
          {initial.client_name && <span className="font-mono text-[9px] uppercase tracking-widest text-gold/60 shrink-0">{initial.client_name}</span>}
          <div className="flex-1" />
          <button onClick={restructure} disabled={assisting} title="Restructure the whole doc" className="font-mono text-[9px] tracking-widest uppercase text-slate hover:text-electric px-2 py-1.5 border border-white/10 disabled:opacity-40">↺ Restructure</button>
          <div className="relative group shrink-0">
            <button className="font-mono text-[9px] tracking-widest uppercase text-slate hover:text-cream px-2 py-1.5 border border-white/10">Export ▾</button>
            <div className="absolute right-0 top-full hidden group-hover:flex flex-col bg-navy border border-white/10 shadow-xl z-30 min-w-[110px]">
              {(['md', 'docx', 'pdf'] as const).map((f) => (
                <a key={f} href={`/api/janet/docs/${initial.id}/export?format=${f}`} className="font-mono text-[10px] uppercase tracking-widest text-slate hover:text-cream hover:bg-white/5 px-3 py-2">{f}</a>
              ))}
            </div>
          </div>
          <button onClick={() => setPanel((p) => (p === 'versions' ? 'none' : 'versions'))} className={`font-mono text-[9px] tracking-widest uppercase px-2 py-1.5 border border-white/10 ${panel === 'versions' ? 'text-electric border-electric/40' : 'text-slate hover:text-cream'}`}>History</button>
          <button onClick={() => setPanel((p) => (p === 'chat' ? 'none' : 'chat'))} className={`font-mono text-[9px] tracking-widest uppercase px-2 py-1.5 border border-white/10 ${panel === 'chat' ? 'text-electric border-electric/40' : 'text-slate hover:text-cream'}`}>JANET</button>
        </div>

        <div ref={editorRef} className="relative px-6 md:px-16 py-10 max-w-3xl mx-auto w-full">
          {/* Inline assist toolbar */}
          {assist && (
            <div className="sticky top-16 z-10 flex justify-center pointer-events-none">
              <div className="pointer-events-auto flex items-center gap-1 bg-navy border border-electric/30 shadow-xl shadow-black/50 rounded px-1 py-1">
                {(['rewrite', 'expand', 'tighten'] as const).map((op) => (
                  <button key={op} onClick={() => runAssist(op)} disabled={assisting} className="font-mono text-[9px] uppercase tracking-widest text-slate hover:text-electric px-2 py-1 disabled:opacity-40">{op}</button>
                ))}
                <span className="w-px h-4 bg-white/10" />
                <button onClick={askAboutSelection} className="font-mono text-[9px] uppercase tracking-widest text-electric/80 hover:text-electric px-2 py-1">Ask JANET</button>
              </div>
            </div>
          )}

          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            rows={1}
            placeholder="Untitled"
            className="w-full bg-transparent text-cream text-3xl font-bold tracking-tight resize-none focus:outline-none placeholder:text-slate/30 mb-4 overflow-hidden"
            onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
          />

          <div className="flex flex-col gap-0.5">
            {blocks.map((b, idx) => (
              <DocBlockRow
                key={b.id}
                block={b}
                onText={(t) => setBlockText(b.id, t)}
                onToggle={() => toggleCheck(b.id)}
                onKey={(e) => onBlockKey(e, idx)}
                onSelect={(e) => onSelect(b.id, e)}
              />
            ))}
          </div>
          {assisting && <p className="font-mono text-[10px] text-electric/70 mt-4">JANET is working…</p>}
        </div>
      </div>

      {/* ── Side panel: versions or chat ── */}
      {panel === 'versions' && <VersionsPanel docId={initial.id} onClose={() => setPanel('none')} onRestored={(content) => setBlocks(content.length ? content : [emptyText()])} />}
      {panel === 'chat' && <DocChat docId={initial.id} onClose={() => setPanel('none')} registerSend={(fn) => (chatSendRef.current = fn)} />}
    </div>
  );
}

// ─── One editable block ──────────────────────────────────────────────────

function DocBlockRow({
  block,
  onText,
  onToggle,
  onKey,
  onSelect,
}: {
  block: DocBlock;
  onText: (t: string) => void;
  onToggle: () => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = Math.max(24, el.scrollHeight) + 'px'; } };
  useEffect(() => { resize(); }, [block]);

  const cls =
    block.type === 'heading'
      ? block.level === 1 ? 'text-2xl font-bold text-cream' : block.level === 2 ? 'text-xl font-semibold text-cream/95' : 'text-lg font-semibold text-cream/90'
      : block.type === 'code'
        ? 'font-mono text-[13px] text-emerald-200/90 bg-white/[0.03] rounded px-3 py-2'
        : 'text-[15px] text-cream/90';

  const ta = (
    <textarea
      ref={ref}
      data-bid={block.id}
      value={(block as any).text}
      rows={1}
      placeholder={block.type === 'heading' ? 'Heading' : block.type === 'code' ? 'code' : "Write, or type '# ', '- ', '[] '…"}
      onChange={(e) => { onText(e.target.value); resize(); }}
      onKeyDown={onKey}
      onSelect={onSelect}
      onMouseUp={onSelect}
      className={`w-full bg-transparent resize-none focus:outline-none placeholder:text-slate/25 overflow-hidden leading-relaxed ${cls}`}
    />
  );

  if (block.type === 'bullet') return <div className="flex gap-2 items-start"><span className="text-electric/60 mt-2 leading-none">•</span>{ta}</div>;
  if (block.type === 'checklist')
    return (
      <div className="flex gap-2 items-start">
        <button onClick={onToggle} className={`mt-2 w-3.5 h-3.5 shrink-0 border rounded-sm grid place-items-center ${block.checked ? 'bg-electric border-electric' : 'border-white/25'}`}>
          {block.checked && <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1 5L4 8L9 2" stroke="#0A1628" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
        <div className={`flex-1 ${block.checked ? 'line-through opacity-50' : ''}`}>{ta}</div>
      </div>
    );
  return ta;
}

// prefix → block transform for markdown shortcuts
function transformPrefix(prefix: string): { make: (rest: string) => DocBlock } | null {
  if (prefix === '#') return { make: (rest) => ({ id: blockId(), type: 'heading', level: 1, text: rest }) };
  if (prefix === '##') return { make: (rest) => ({ id: blockId(), type: 'heading', level: 2, text: rest }) };
  if (prefix === '###') return { make: (rest) => ({ id: blockId(), type: 'heading', level: 3, text: rest }) };
  if (prefix === '-' || prefix === '*') return { make: (rest) => ({ id: blockId(), type: 'bullet', text: rest }) };
  if (prefix === '[]' || prefix === '-[]') return { make: (rest) => ({ id: blockId(), type: 'checklist', text: rest, checked: false }) };
  if (prefix === '```') return { make: (rest) => ({ id: blockId(), type: 'code', text: rest }) };
  return null;
}

// ─── Version history panel ───────────────────────────────────────────────

function VersionsPanel({ docId, onClose, onRestored }: { docId: string; onClose: () => void; onRestored: (content: DocBlock[]) => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api(`/api/janet/docs/${docId}/versions`, 'GET').then((d) => setVersions(d.versions)).catch(() => setVersions([])); }, [docId]);
  const restore = async (id: string) => {
    if (!confirm('Restore this version? Your current text is snapshotted first, so this is reversible.')) return;
    setBusy(id);
    try {
      const { doc } = await api(`/api/janet/docs/${docId}/versions`, 'POST', { version_id: id });
      onRestored(doc.content ?? []);
      api(`/api/janet/docs/${docId}/versions`, 'GET').then((d) => setVersions(d.versions)).catch(() => {});
    } finally {
      setBusy(null);
    }
  };
  return (
    <aside className="w-80 shrink-0 border-l border-white/10 bg-navy/60 flex flex-col h-screen sticky top-0">
      <div className="flex items-center justify-between px-4 h-12 border-b border-white/10">
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-cream">Version history</span>
        <button onClick={onClose} className="text-slate hover:text-cream font-mono text-xs">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
        {versions === null && <p className="font-mono text-[10px] text-slate/50">Loading…</p>}
        {versions?.length === 0 && <p className="font-mono text-[11px] text-slate/50">No versions yet. They're captured before every JANET edit and on manual saves.</p>}
        {versions?.map((v) => (
          <div key={v.id} className="border border-white/5 bg-navy p-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] text-cream/85 truncate">{v.label ?? 'save'}</p>
              <p className="font-mono text-[9px] text-slate/40">{v.created_by ?? '?'} · {new Date(v.created_at).toLocaleString()}</p>
            </div>
            <button onClick={() => restore(v.id)} disabled={busy === v.id} className="font-mono text-[9px] uppercase tracking-widest text-slate hover:text-electric shrink-0 disabled:opacity-40">{busy === v.id ? '…' : 'restore'}</button>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ─── Doc-aware chat ──────────────────────────────────────────────────────

function DocChat({ docId, onClose, registerSend }: { docId: string; onClose: () => void; registerSend: (fn: (msg: string) => void) => void }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useCallback(async (message: string) => {
    const msg = message.trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);
    setItems((p) => [...p, { kind: 'user', text: msg }]);
    try {
      const resp = await fetch(`/api/janet/docs/${docId}/chat`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }),
      });
      if (!resp.ok || !resp.body) { setItems((p) => [...p, { kind: 'error', text: `Request failed (${resp.status})` }]); setBusy(false); return; }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let open = false;
      const ensure = () => { if (!open) { open = true; setItems((p) => [...p, { kind: 'assistant', text: '' }]); } };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!frame.startsWith('data: ')) continue;
          let ev: any; try { ev = JSON.parse(frame.slice(6)); } catch { continue; }
          if (ev.type === 'text_delta') { ensure(); setItems((p) => { const n = [...p]; const l = n[n.length - 1]; if (l?.kind === 'assistant') n[n.length - 1] = { kind: 'assistant', text: l.text + ev.text }; return n; }); }
          else if (ev.type === 'tool_start') { open = false; setItems((p) => [...p, { kind: 'tool', name: ev.name, status: 'running' }]); }
          else if (ev.type === 'tool_done') { setItems((p) => { const n = [...p]; for (let k = n.length - 1; k >= 0; k--) { const t = n[k]; if (t.kind === 'tool' && t.name === ev.name && t.status === 'running') { n[k] = { kind: 'tool', name: ev.name, status: 'done', ok: ev.ok, summary: ev.summary }; break; } } return n; }); }
          else if (ev.type === 'plan') { open = false; setItems((p) => [...p, { kind: 'plan', proposals: ev.proposals, approval_id: ev.approval_id ?? null, status: 'pending' }]); }
          else if (ev.type === 'error') { setItems((p) => [...p, { kind: 'error', text: ev.message }]); }
        }
      }
    } catch (e: any) {
      setItems((p) => [...p, { kind: 'error', text: e?.message ?? 'Stream error' }]);
    } finally {
      setBusy(false);
    }
  }, [busy, docId]);

  useEffect(() => { registerSend(send); }, [send, registerSend]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [items]);

  const resolvePlan = async (idx: number, decision: 'approve' | 'reject') => {
    const it = items[idx];
    if (it.kind !== 'plan') return;
    setItems((p) => p.map((x, i) => (i === idx && x.kind === 'plan' ? { ...x, status: decision === 'approve' ? 'approved' : 'rejected' } : x)));
    try {
      await api('/api/janet/approve', 'POST', { approval_id: it.approval_id, proposals: it.proposals, decision });
    } catch { /* leave optimistic state */ }
  };

  return (
    <aside className="w-96 shrink-0 border-l border-white/10 bg-navy/70 flex flex-col h-screen sticky top-0">
      <div className="flex items-center justify-between px-4 h-12 border-b border-white/10">
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-cream">JANET · doc-aware</span>
        <button onClick={onClose} className="text-slate hover:text-cream font-mono text-xs">✕</button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
        {items.length === 0 && <p className="font-mono text-[11px] text-slate/50 leading-relaxed">Ask about this doc, tell me to draft into it, or paste raw notes and say "file this." I read the whole doc as context. Filing records needs your approval.</p>}
        {items.map((it, i) => (
          <div key={i}>
            {it.kind === 'user' && <p className="text-[13px] text-cream/95 bg-white/[0.04] rounded px-3 py-2 whitespace-pre-wrap">{it.text}</p>}
            {it.kind === 'assistant' && <p className="text-[13px] text-cream/85 leading-relaxed whitespace-pre-wrap">{it.text}</p>}
            {it.kind === 'tool' && <p className="font-mono text-[10px] text-slate/50">{it.status === 'running' ? '⋯' : it.ok ? '✓' : '✕'} {it.name}{it.summary ? ` — ${it.summary}` : ''}</p>}
            {it.kind === 'error' && <p className="font-mono text-[11px] text-red-400">{it.text}</p>}
            {it.kind === 'plan' && (
              <div className="border border-amber-400/30 bg-amber-400/[0.06] rounded p-2.5">
                <p className="font-mono text-[9px] uppercase tracking-widest text-amber-400 mb-1.5">Awaiting approval</p>
                {it.proposals.map((p, k) => <p key={k} className="text-[12px] text-amber-100/90">{p.summary}</p>)}
                {it.status === 'pending' ? (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => resolvePlan(i, 'approve')} className="font-mono text-[9px] uppercase tracking-widest bg-electric text-navy px-3 py-1.5">Approve</button>
                    <button onClick={() => resolvePlan(i, 'reject')} className="font-mono text-[9px] uppercase tracking-widest text-slate hover:text-cream px-3 py-1.5">Reject</button>
                  </div>
                ) : (
                  <p className="font-mono text-[9px] uppercase tracking-widest text-slate/50 mt-2">{it.status}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 p-2.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          rows={2}
          placeholder={busy ? 'Working…' : 'Ask, draft, or file…'}
          disabled={busy}
          className="w-full bg-white/[0.04] border border-white/10 rounded px-2.5 py-2 text-cream text-[13px] resize-none focus:outline-none focus:border-electric/40 disabled:opacity-50"
        />
      </div>
    </aside>
  );
}
