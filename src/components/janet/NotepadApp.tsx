/**
 * JANET Discovery Notepad (JANET_ADMIN_NOTEPAD_SPEC Task 3 + coverage addition)
 * — the flagship capture surface. Two tabs: Notepad (capture → process → deal)
 * and Question Bank (edit the standard set + deal-type templates).
 *
 * Capture is a block editor: freeform text blocks interleaved with COVERAGE
 * chips. Ticking a prepped question drops a "✓ topic — covered" block into the
 * notes — visual (see at a glance what you've covered) AND functional: coverage
 * state travels to JANET so she distinguishes covered-but-no-detail (a gap she
 * flags) from a topic that simply wasn't discussed (a silent blank).
 *
 * JANET stays silent during the call; she structures quietly in the background
 * (pending draft, never the live record) and writes only on Blue's explicit
 * confirmation after the "here's what I heard" recap.
 *
 * Voice-to-text is a deliberate NEXT (not built) — text blocks are the capture
 * target it will feed, so it slots in without restructuring.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

type DealLite = { id: string; name: string; stage: string; contact_name?: string | null; site_id?: string | null };
type DealType = 'refresh' | 'new_build' | 'rescue' | null;
type QKind = 'prospect' | 'type' | 'standard';
type PreppedQ = { q: string; kind: QKind; topic: string };
type BankQ = { id: string; text: string; topic: string | null; deal_type: DealType; sort: number; active: boolean };
type Gap = { topic: string; note: string };
type PendingFields = {
  contact_name?: string | null;
  contact_email?: string | null;
  value_estimate?: number | null;
  timeline?: string | null;
  decision_maker?: string | null;
  scope?: string | null;
  pain_points?: string[] | null;
  next_action?: string | null;
  next_action_due?: string | null;
  stage?: string | null;
  summary?: string | null;
  gaps?: Gap[] | null;
};
type Session = {
  id: string;
  deal_id: string | null;
  title: string | null;
  context: string | null;
  deal_type: DealType;
  prepped_questions: PreppedQ[];
  notes: string;
  blocks: Block[] | null;
  coverage: CovItem[] | null;
  pending_fields: PendingFields | null;
  recap: string | null;
  status: string;
};

type CovItem = { topic: string; question: string; detail?: string | null };
// A session's notes are an ordered list of blocks: freeform text, and question
// blocks (a ticked prepped question shown as a prompt with an answer under it).
// A question block IS the coverage marker; its answer is the detail JANET reads.
type Block =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'question'; topic: string; question: string; answer: string };
type QuestionBlockT = Extract<Block, { type: 'question' }>;

const DEAL_TYPES: { key: Exclude<DealType, null>; label: string; hint: string }[] = [
  { key: 'refresh', label: 'Refresh', hint: 'existing site, make it better' },
  { key: 'new_build', label: 'New build', hint: 'greenfield, nothing yet' },
  { key: 'rescue', label: 'Rescue', hint: 'a broken build to salvage' },
];
const KIND_LABEL: Record<QKind, string> = { prospect: 'For this prospect', type: 'By engagement type', standard: 'Standard set' };

let _uid = 0;
const uid = () => `b${Date.now().toString(36)}_${_uid++}`;
const emptyText = (): Block => ({ id: uid(), type: 'text', text: '' });

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

const LBL = 'font-mono text-[9px] tracking-[0.18em] uppercase text-slate/70';
const btnPrimary =
  'bg-electric hover:bg-electric/90 text-navy font-mono text-[10px] tracking-[0.2em] uppercase px-4 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost = 'font-mono text-[10px] tracking-[0.2em] uppercase text-slate hover:text-cream px-3 py-2 transition-colors';
const fieldCls =
  'w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-cream text-[13px] focus:outline-none focus:border-electric/50';

export default function NotepadApp({
  initialDeals,
  initialDealId,
  initialBank,
}: {
  initialDeals: DealLite[];
  initialDealId: string | null;
  initialBank: BankQ[];
}) {
  const [tab, setTab] = useState<'notepad' | 'bank'>('notepad');
  const [session, setSession] = useState<Session | null>(null);
  // Guard lives here (survives StartScreen↔Capture swaps) so a deep-linked
  // ?deal=X auto-opens ONCE per page load — backing out never respawns it.
  const autoOpened = useRef(false);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-1 mb-6 border-b border-white/10">
        {(['notepad', 'bank'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`font-mono text-[10px] tracking-[0.22em] uppercase px-4 py-3 -mb-px border-b-2 transition-colors ${
              tab === t ? 'border-electric text-cream' : 'border-transparent text-slate hover:text-cream'
            }`}
          >
            {t === 'notepad' ? 'Notepad' : 'Question Bank'}
          </button>
        ))}
      </div>

      {tab === 'notepad' ? (
        session ? (
          <Capture session={session} setSession={setSession} deals={initialDeals} />
        ) : (
          <StartScreen deals={initialDeals} initialDealId={initialDealId} onOpen={setSession} autoOpenedRef={autoOpened} />
        )
      ) : (
        <QuestionBank initial={initialBank} />
      )}
    </div>
  );
}

// ─── Start screen: prospect-opened or standalone ───────────────────────

type RecentSession = { id: string; deal_id: string | null; title: string | null; deal_type: DealType; status: string; created_at: string };

function StartScreen({
  deals,
  initialDealId,
  onOpen,
  autoOpenedRef,
}: {
  deals: DealLite[];
  initialDealId: string | null;
  onOpen: (s: Session) => void;
  autoOpenedRef: React.MutableRefObject<boolean>;
}) {
  const [mode, setMode] = useState<'deal' | 'standalone'>(initialDealId ? 'deal' : 'standalone');
  const [dealId, setDealId] = useState(initialDealId ?? '');
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [dealType, setDealType] = useState<DealType>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [recent, setRecent] = useState<RecentSession[] | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);

  const open = useCallback(
    async (payload: any) => {
      setBusy(true);
      setErr('');
      try {
        const { session } = await api('/api/admin/janet/notepad', 'POST', payload);
        onOpen(session);
      } catch (e) {
        setErr((e as Error).message);
        setBusy(false);
      }
    },
    [onOpen]
  );

  const resume = useCallback(
    async (id: string) => {
      setResuming(id);
      try {
        const { session } = await api(`/api/admin/janet/notepad/${id}`, 'GET');
        onOpen(session);
      } catch (e) {
        setErr((e as Error).message);
        setResuming(null);
      }
    },
    [onOpen]
  );

  // Deep-linked from a deal (?deal=X) → open once per page load. The guard lives
  // in the parent, so returning here never re-triggers a duplicate session.
  useEffect(() => {
    if (initialDealId && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      open({ deal_id: initialDealId });
    }
  }, [initialDealId, open, autoOpenedRef]);

  // Recent notes so "All notes" leads somewhere and in-progress sessions resume.
  useEffect(() => {
    api('/api/admin/janet/notepad', 'GET')
      .then((d) => setRecent(d.sessions ?? []))
      .catch(() => setRecent([]));
  }, []);

  const submit = () => {
    if (busy) return;
    if (mode === 'deal') {
      if (!dealId) return setErr('Pick a deal, or switch to standalone.');
      open({ deal_id: dealId, deal_type: dealType });
    } else {
      open({ title: title.trim() || null, context: context.trim() || null, deal_type: dealType });
    }
  };

  if (busy)
    return (
      <div className="flex items-center gap-3 text-slate/70 font-mono text-[12px] py-20 justify-center">
        <span className="w-1.5 h-1.5 rounded-full bg-electric animate-pulse" />
        JANET is prepping your questions…
      </div>
    );

  return (
    <div className="max-w-2xl">
      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-electric mb-1">// Discovery notepad</p>
      <h2 className="text-2xl font-bold text-cream tracking-tight mb-1">Prep a call</h2>
      <p className="text-slate/60 text-[13px] mb-6">She'll prep questions from what she knows. Or just start typing — attach it to a deal later.</p>

      <div className="flex gap-1.5 mb-5">
        {(['deal', 'standalone'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`font-mono text-[9px] tracking-widest uppercase px-3 py-2 border transition-colors ${
              mode === m ? 'bg-electric text-navy border-electric' : 'border-white/10 text-slate hover:text-cream'
            }`}
          >
            {m === 'deal' ? 'From a deal' : 'Standalone / unexpected'}
          </button>
        ))}
      </div>

      <div className="border border-white/5 bg-navy p-5 flex flex-col gap-4">
        {mode === 'deal' ? (
          <label className="flex flex-col gap-1.5">
            <span className={LBL}>Prospect / deal</span>
            <select className={fieldCls} value={dealId} onChange={(e) => setDealId(e.target.value)}>
              <option value="">— pick a deal —</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id} className="bg-navy">
                  {d.name} · {d.stage.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className={LBL}>Who / what (optional)</span>
              <input className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Referral from Marcus · restaurant owner" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LBL}>What you know about them (optional — she'll tailor questions)</span>
              <textarea
                className={`${fieldCls} resize-none leading-relaxed`}
                rows={4}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Anything from your network: who they are, what they do, what prompted the call…"
              />
            </label>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <span className={LBL}>Engagement type (optional — adapts the questions)</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setDealType(null)}
              className={`font-mono text-[9px] tracking-widest uppercase px-3 py-2 border transition-colors ${
                dealType === null ? 'bg-electric text-navy border-electric' : 'border-white/10 text-slate hover:text-cream'
              }`}
            >
              Unsure
            </button>
            {DEAL_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setDealType(t.key)}
                title={t.hint}
                className={`font-mono text-[9px] tracking-widest uppercase px-3 py-2 border transition-colors ${
                  dealType === t.key ? 'bg-electric text-navy border-electric' : 'border-white/10 text-slate hover:text-cream'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {err && <p className="font-mono text-[10px] text-red-400">{err}</p>}
        <div className="flex justify-end pt-1">
          <button className={btnPrimary} onClick={submit}>
            Open notepad →
          </button>
        </div>
      </div>

      {recent && recent.length > 0 && (
        <div className="mt-8">
          <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-slate/50 mb-2">// Recent notes</p>
          <div className="flex flex-col gap-1.5">
            {recent.map((s) => {
              const active = s.status === 'active';
              return (
                <button
                  key={s.id}
                  onClick={() => active && resume(s.id)}
                  disabled={!active || resuming === s.id}
                  className={`flex items-center gap-3 text-left border border-white/5 bg-navy px-3 py-2.5 transition-colors ${
                    active ? 'hover:border-white/15 cursor-pointer' : 'opacity-60 cursor-default'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-electric' : 'bg-slate/40'}`} />
                  <span className="text-cream/90 text-[13px] truncate flex-1">{s.title ?? (s.deal_id ? 'Deal note' : 'Untitled note')}</span>
                  {s.deal_type && <span className="font-mono text-[8px] uppercase tracking-widest text-slate/40 shrink-0">{s.deal_type.replace('_', ' ')}</span>}
                  <span className="font-mono text-[9px] uppercase tracking-widest text-slate/40 shrink-0">
                    {resuming === s.id ? 'opening…' : active ? 'resume →' : 'processed'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Capture: block editor + prepped checklist + process flow ──────────

// Rehydrate the editor from the stored ordered block structure (no fragile text
// parsing). Falls back to one text block for a legacy notes-only session, or an
// empty block for a fresh one. Ids are regenerated so they're always unique.
function initBlocks(session: Session): Block[] {
  const stored = session.blocks;
  if (Array.isArray(stored) && stored.length) {
    return stored.map((b: any) =>
      b.type === 'question'
        ? { id: uid(), type: 'question', topic: b.topic, question: b.question, answer: b.answer ?? '' }
        : { id: uid(), type: 'text', text: b.text ?? '' }
    );
  }
  if (session.notes) return [{ id: uid(), type: 'text', text: session.notes }];
  return [emptyText()];
}

// Serialize to a readable transcript for JANET + the deal notes. A ticked
// question renders as a Q/A pair; an empty answer is left to the coverage array
// (and the gap logic) rather than padded here.
const serialize = (bs: Block[]) =>
  bs
    .map((b) => (b.type === 'text' ? b.text : b.answer.trim() ? `Q: ${b.question}\nA: ${b.answer.trim()}` : `Q: ${b.question}`))
    .filter((s) => s.trim())
    .join('\n\n');

const coverageOf = (bs: Block[]): CovItem[] =>
  bs.filter((b): b is QuestionBlockT => b.type === 'question').map((b) => ({ topic: b.topic, question: b.question, detail: b.answer.trim() || null }));

function Capture({ session, setSession, deals }: { session: Session; setSession: (s: Session | null) => void; deals: DealLite[] }) {
  const [blocks, setBlocks] = useState<Block[]>(() => initBlocks(session));
  const [pending, setPending] = useState<PendingFields | null>(session.pending_fields);
  const [structuring, setStructuring] = useState(false);
  const [phase, setPhase] = useState<'capture' | 'confirm' | 'done'>('capture');
  const [confirm, setConfirm] = useState<{ fields: PendingFields; recap: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ deal: any; created: boolean; recap: string } | null>(null);
  const [err, setErr] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const structTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesRef = useRef('');
  const coverageRef = useRef<CovItem[]>([]);
  const blocksRef = useRef<Block[]>([]);

  const deal = useMemo(() => deals.find((d) => d.id === session.deal_id) ?? null, [deals, session.deal_id]);
  const covered = useMemo(() => new Set(coverageOf(blocks).map((c) => c.question)), [blocks]);

  // Debounced autosave + quiet background structuring as the notes change.
  useEffect(() => {
    if (phase !== 'capture') return;
    const notes = serialize(blocks);
    const coverage = coverageOf(blocks);
    notesRef.current = notes;
    coverageRef.current = coverage;
    blocksRef.current = blocks;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api(`/api/admin/janet/notepad/${session.id}`, 'PUT', { notes, coverage, blocks }).catch(() => {});
    }, 900);
    if (notes.trim().length > 40) {
      if (structTimer.current) clearTimeout(structTimer.current);
      setStructuring(true);
      structTimer.current = setTimeout(async () => {
        try {
          const { pending_fields } = await api(`/api/admin/janet/notepad/${session.id}/structure`, 'POST', { notes, coverage });
          setPending(pending_fields);
        } catch {
          /* silent — structuring is best-effort */
        } finally {
          setStructuring(false);
        }
      }, 2500);
    } else {
      // Dropped back below the threshold before the timer fired — clear the
      // pending timer and the indicator so it can't stick on.
      if (structTimer.current) clearTimeout(structTimer.current);
      setStructuring(false);
    }
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (structTimer.current) clearTimeout(structTimer.current);
    };
  }, [blocks, phase, session.id]);

  // Tick a prepped question → drop it into the notes as a prompt-with-answer
  // block at the cursor, and focus the answer so you type right under it.
  // Tick again to remove it (unless you've already written an answer).
  const toggleCoverage = (pq: PreppedQ) => {
    let focusId: string | null = null;
    setBlocks((bs) => {
      const at = bs.findIndex((b) => b.type === 'question' && b.question === pq.q);
      if (at >= 0) {
        // Don't silently discard a typed answer on a checklist mis-click — if it
        // has content, keep it; removal is explicit via the block's ✕.
        const qb = bs[at] as QuestionBlockT;
        if (qb.answer.trim()) return bs;
        const c = bs.slice(0, at).concat(bs.slice(at + 1));
        return c.length ? c : [emptyText()];
      }
      const qb: Block = { id: uid(), type: 'question', topic: pq.topic, question: pq.q, answer: '' };
      focusId = qb.id;
      const activeIdx = activeId ? bs.findIndex((b) => b.id === activeId) : -1;
      const insertAt = activeIdx >= 0 ? activeIdx + 1 : bs.length;
      const c = bs.slice(0, insertAt).concat([qb], bs.slice(insertAt));
      if (c[c.length - 1].type === 'question') c.push(emptyText());
      return c;
    });
    if (focusId) setFocusBlockId(focusId);
  };

  const setAnswer = (id: string, answer: string) =>
    setBlocks((bs) => bs.map((b) => (b.id === id && b.type === 'question' ? { ...b, answer } : b)));
  const removeBlock = (id: string) => setBlocks((bs) => (bs.filter((b) => b.id !== id).length ? bs.filter((b) => b.id !== id) : [emptyText()]));

  const startProcess = async () => {
    setProcessing(true);
    setErr('');
    try {
      await api(`/api/admin/janet/notepad/${session.id}`, 'PUT', { notes: notesRef.current, coverage: coverageRef.current, blocks: blocksRef.current });
      const { pending_fields, recap } = await api(`/api/admin/janet/notepad/${session.id}/process`, 'POST', {});
      setConfirm({ fields: pending_fields ?? {}, recap: recap ?? '' });
      setPhase('confirm');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const commit = async () => {
    if (!confirm) return;
    setProcessing(true);
    setErr('');
    try {
      const res = await api(`/api/admin/janet/notepad/${session.id}/process`, 'POST', {
        commit: true,
        fields: confirm.fields,
        recap: confirm.recap,
      });
      setResult({ deal: res.deal, created: res.created, recap: res.recap });
      setPhase('done');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const grouped = useMemo(() => {
    const g: Record<QKind, PreppedQ[]> = { prospect: [], type: [], standard: [] };
    (session.prepped_questions ?? []).forEach((p) => g[p.kind].push(p));
    return g;
  }, [session.prepped_questions]);

  const wordCount = useMemo(
    () => blocks.map((b) => (b.type === 'text' ? b.text : b.answer)).join(' ').trim().split(/\s+/).filter(Boolean).length,
    [blocks]
  );
  const hasContent = blocks.some((b) => (b.type === 'text' && b.text.trim()) || b.type === 'question');

  if (phase === 'done' && result) return <DoneScreen result={result} deal={deal} onReset={() => setSession(null)} />;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-electric mb-1">
            // {deal ? 'Discovery · ' + deal.name : session.context ? 'Discovery · network contact' : 'Discovery · standalone'}
          </p>
          <h2 className="text-2xl font-bold text-cream tracking-tight truncate">{session.title ?? 'Untitled call'}</h2>
        </div>
        <button className={btnGhost} onClick={() => setSession(null)}>
          ← All notes
        </button>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5">
        <div className="flex flex-col gap-3">
          <div className="border border-white/5 bg-navy">
            <div className="flex items-center justify-between px-4 h-10 border-b border-white/10">
              <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-slate/60">// Notes — she stays silent, just capture</span>
              <span className="font-mono text-[9px] text-slate/40">
                {[covered.size ? `${covered.size} covered` : '', wordCount ? `${wordCount} words` : ''].filter(Boolean).join(' · ')}
              </span>
            </div>
            <BlockEditor
              blocks={blocks}
              setBlocks={setBlocks}
              disabled={phase !== 'capture'}
              onSetAnswer={setAnswer}
              onRemoveBlock={removeBlock}
              onActive={setActiveId}
              focusId={focusBlockId}
              onFocused={() => setFocusBlockId(null)}
            />
          </div>

          <PendingStrip pending={pending} structuring={structuring} />

          {phase === 'capture' && (
            <div className="flex items-center justify-between">
              {err && <p className="font-mono text-[10px] text-red-400">{err}</p>}
              <div className="flex-1" />
              <button className={btnPrimary} onClick={startProcess} disabled={processing || !hasContent}>
                {processing ? 'Reading your notes…' : 'Process notes →'}
              </button>
            </div>
          )}
        </div>

        <div className="border border-white/5 bg-navy p-4 h-fit lg:sticky lg:top-4">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-electric mb-3">
            // Prepped · {covered.size}/{(session.prepped_questions ?? []).length}
          </p>
          {(session.prepped_questions ?? []).length === 0 && <p className="text-slate/50 text-[12px]">No prepped questions — just capture freely.</p>}
          <div className="flex flex-col gap-4">
            {(['prospect', 'type', 'standard'] as QKind[]).map((k) =>
              grouped[k].length ? (
                <div key={k}>
                  <p className="font-mono text-[8px] tracking-[0.2em] uppercase text-slate/40 mb-1.5">{KIND_LABEL[k]}</p>
                  <div className="flex flex-col gap-1.5">
                    {grouped[k].map((p) => {
                      const isCov = covered.has(p.q);
                      return (
                        <button
                          key={p.q}
                          onClick={() => toggleCoverage(p)}
                          role="checkbox"
                          aria-checked={isCov}
                          aria-label={`${p.q} — mark "${p.topic}" covered`}
                          className="flex items-start gap-2 text-left group focus-visible:outline focus-visible:outline-1 focus-visible:outline-electric/60 rounded-sm"
                          title={`marks "${p.topic}" covered`}
                        >
                          <span
                            className={`mt-0.5 w-3.5 h-3.5 shrink-0 border rounded-sm grid place-items-center transition-colors ${
                              isCov ? 'bg-electric border-electric' : 'border-white/20 group-hover:border-white/40'
                            }`}
                          >
                            {isCov && (
                              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                                <path d="M1 5L4 8L9 2" stroke="#0A1628" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          <span className={`text-[12px] leading-snug transition-colors ${isCov ? 'text-slate/40 line-through' : 'text-cream/85'}`}>{p.q}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {phase === 'confirm' && confirm && (
          <ConfirmPanel
            confirm={confirm}
            setConfirm={setConfirm}
            deal={deal}
            standalone={!session.deal_id}
            processing={processing}
            err={err}
            onCancel={() => setPhase('capture')}
            onCommit={commit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Block editor ──────────────────────────────────────────────────────

function BlockEditor({
  blocks,
  setBlocks,
  disabled,
  onSetAnswer,
  onRemoveBlock,
  onActive,
  focusId,
  onFocused,
}: {
  blocks: Block[];
  setBlocks: React.Dispatch<React.SetStateAction<Block[]>>;
  disabled: boolean;
  onSetAnswer: (id: string, answer: string) => void;
  onRemoveBlock: (id: string) => void;
  onActive: (id: string) => void;
  focusId: string | null;
  onFocused: () => void;
}) {
  const refs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const [focusReq, setFocusReq] = useState<{ id: string; caret: number } | null>(null);

  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.max(24, el.scrollHeight) + 'px';
  };

  // Internal focus after a split/merge.
  useEffect(() => {
    if (!focusReq) return;
    const el = refs.current.get(focusReq.id);
    if (el) {
      el.focus();
      const c = Math.min(focusReq.caret, el.value.length);
      el.setSelectionRange(c, c);
      resize(el);
    }
    setFocusReq(null);
  }, [focusReq, blocks]);

  // External focus: a just-ticked question's answer field (blocks in deps so it
  // fires once the new block has mounted and registered its ref).
  useEffect(() => {
    if (!focusId) return;
    const el = refs.current.get(focusId);
    if (el) {
      el.focus();
      resize(el);
    }
    onFocused();
  }, [focusId, blocks, onFocused]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, idx: number) => {
    const b = blocks[idx];
    if (b.type !== 'text') return;
    const ta = e.currentTarget;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Split at the selection: text before selectionStart stays, text after
      // selectionEnd moves down — any selected range is deleted (standard).
      const before = b.text.slice(0, ta.selectionStart);
      const after = b.text.slice(ta.selectionEnd);
      const nb: Block = { id: uid(), type: 'text', text: after };
      setBlocks((bs) => {
        const c = [...bs];
        c[idx] = { ...b, text: before };
        c.splice(idx + 1, 0, nb);
        return c;
      });
      setFocusReq({ id: nb.id, caret: 0 });
    } else if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      const prev = blocks[idx - 1];
      if (prev && prev.type === 'text') {
        e.preventDefault();
        const caret = prev.text.length;
        setBlocks((bs) => {
          const c = [...bs];
          c[idx - 1] = { ...prev, text: prev.text + b.text };
          c.splice(idx, 1);
          return c;
        });
        setFocusReq({ id: prev.id, caret });
      }
    }
  };

  const onlyEmpty = blocks.length === 1 && blocks[0].type === 'text' && !blocks[0].text;
  const registerRef = (id: string) => (el: HTMLTextAreaElement | null) => {
    if (el) {
      refs.current.set(id, el);
      resize(el);
    } else refs.current.delete(id);
  };

  return (
    <div className="px-4 py-4 min-h-[52vh] flex flex-col gap-1">
      {blocks.map((b, idx) =>
        b.type === 'text' ? (
          <textarea
            key={b.id}
            ref={registerRef(b.id)}
            value={b.text}
            disabled={disabled}
            rows={1}
            placeholder={onlyEmpty ? 'Type freely. Or tick a question on the right — it drops in here and you answer under it.' : ''}
            onFocus={() => onActive(b.id)}
            onChange={(e) => {
              const v = e.target.value;
              setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, text: v } : x)));
              resize(e.target);
            }}
            onKeyDown={(e) => onKey(e, idx)}
            className="w-full bg-transparent text-cream/95 text-[14px] leading-relaxed resize-none focus:outline-none placeholder:text-slate/40 disabled:opacity-60 overflow-hidden"
          />
        ) : (
          <QuestionBlock
            key={b.id}
            block={b}
            disabled={disabled}
            registerRef={registerRef(b.id)}
            onFocus={() => onActive(b.id)}
            onSetAnswer={onSetAnswer}
            onRemove={onRemoveBlock}
            resize={resize}
          />
        )
      )}
    </div>
  );
}

// A ticked prepped question, inline in the notes: the question as a prompt with
// an answer area under it. The block IS the coverage marker; the answer is the
// detail JANET reads (empty answer + ticked = the covered-but-thin gap).
function QuestionBlock({
  block,
  disabled,
  registerRef,
  onFocus,
  onSetAnswer,
  onRemove,
  resize,
}: {
  block: QuestionBlockT;
  disabled: boolean;
  registerRef: (el: HTMLTextAreaElement | null) => void;
  onFocus: () => void;
  onSetAnswer: (id: string, answer: string) => void;
  onRemove: (id: string) => void;
  resize: (el: HTMLTextAreaElement) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="group/q my-1.5 border-l-2 border-electric/40 pl-3"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-widest text-electric/70 shrink-0">{block.topic}</span>
        <span className="text-cream/70 text-[12px] leading-snug flex-1">{block.question}</span>
        {!disabled && (
          <button
            onClick={() => onRemove(block.id)}
            aria-label={`Remove question ${block.topic}`}
            className="font-mono text-[11px] text-slate/40 hover:text-red-400 focus-visible:text-red-400 focus-visible:outline-none transition-colors shrink-0"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
      <textarea
        ref={registerRef}
        value={block.answer}
        disabled={disabled}
        rows={1}
        placeholder="Answer…"
        onFocus={onFocus}
        onChange={(e) => {
          onSetAnswer(block.id, e.target.value);
          resize(e.target);
        }}
        className="w-full bg-transparent text-cream/95 text-[14px] leading-relaxed resize-none focus:outline-none placeholder:text-slate/30 disabled:opacity-60 overflow-hidden mt-1"
      />
    </motion.div>
  );
}

function PendingStrip({ pending, structuring }: { pending: PendingFields | null; structuring: boolean }) {
  const chips: [string, string][] = [];
  if (pending) {
    if (pending.value_estimate) chips.push(['budget', `$${Number(pending.value_estimate).toLocaleString()}`]);
    if (pending.timeline) chips.push(['timeline', pending.timeline]);
    if (pending.decision_maker) chips.push(['decides', pending.decision_maker]);
    if (pending.contact_name) chips.push(['contact', pending.contact_name]);
    (pending.pain_points ?? []).slice(0, 2).forEach((p) => chips.push(['pain', p]));
  }
  const gaps = pending?.gaps ?? [];
  if (!chips.length && !gaps.length && !structuring) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap min-h-[26px]">
      <span className="font-mono text-[8px] tracking-[0.2em] uppercase text-slate/40 mr-1">{structuring ? 'structuring…' : 'she picked up'}</span>
      {chips.map(([k, v], i) => (
        <motion.span
          key={k + i}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-mono text-[10px] px-2 py-1 rounded border border-electric/20 bg-electric/[0.06] text-cream/80"
        >
          <span className="text-electric/70">{k}</span> {v.length > 40 ? v.slice(0, 40) + '…' : v}
        </motion.span>
      ))}
      {gaps.map((g, i) => (
        <motion.span
          key={'gap' + i}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-mono text-[10px] px-2 py-1 rounded border border-amber-400/30 bg-amber-400/[0.07] text-amber-200/90"
          title={g.note}
        >
          <span className="text-amber-400">⚠ {g.topic}</span> — no detail
        </motion.span>
      ))}
    </div>
  );
}

function ConfirmPanel({
  confirm,
  setConfirm,
  deal,
  standalone,
  processing,
  err,
  onCancel,
  onCommit,
}: {
  confirm: { fields: PendingFields; recap: string };
  setConfirm: (c: { fields: PendingFields; recap: string }) => void;
  deal: DealLite | null;
  standalone: boolean;
  processing: boolean;
  err: string;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const f = confirm.fields;
  const set = (patch: Partial<PendingFields>) => setConfirm({ ...confirm, fields: { ...f, ...patch } });
  const STAGES = ['inquiry', 'discovery_scheduled', 'discovery_done', 'proposal_sent', 'negotiating', 'won'];
  const gaps = f.gaps ?? [];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
        className="w-full max-w-xl bg-navy border border-white/10 shadow-2xl shadow-black/60 max-h-[90vh] overflow-y-auto"
        style={{ colorScheme: 'dark' }}
      >
        <div className="px-5 h-12 flex items-center border-b border-white/10">
          <span className="font-mono text-[11px] tracking-[0.25em] uppercase text-cream">
            {standalone ? 'Confirm → new deal' : 'Confirm → ' + (deal?.name ?? 'deal')}
          </span>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div>
            <p className={LBL + ' mb-1.5'}>Here's what she heard — correct it</p>
            <textarea
              className={`${fieldCls} resize-none leading-relaxed`}
              rows={4}
              value={confirm.recap}
              onChange={(e) => setConfirm({ ...confirm, recap: e.target.value })}
            />
          </div>

          {gaps.length > 0 && (
            <div className="border border-amber-400/30 bg-amber-400/[0.06] p-3">
              <p className="font-mono text-[9px] uppercase tracking-widest text-amber-400 mb-1.5">⚠ Covered on the call — but no detail landed</p>
              <div className="flex flex-col gap-1">
                {gaps.map((g, i) => (
                  <p key={i} className="text-[12px] text-amber-200/90">
                    <span className="font-semibold">{g.topic}</span> — {g.note}
                  </p>
                ))}
              </div>
              <p className="text-[11px] text-slate/50 mt-1.5">Fill these below, or leave them — they won't be silently blank.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className={LBL}>Contact</span><input className={fieldCls} value={f.contact_name ?? ''} onChange={(e) => set({ contact_name: e.target.value })} /></label>
            <label className="flex flex-col gap-1"><span className={LBL}>Email</span><input className={fieldCls} value={f.contact_email ?? ''} onChange={(e) => set({ contact_email: e.target.value })} /></label>
            <label className="flex flex-col gap-1"><span className={LBL}>Budget ($)</span><input type="number" className={fieldCls} value={f.value_estimate ?? ''} onChange={(e) => set({ value_estimate: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label className="flex flex-col gap-1"><span className={LBL}>Stage</span>
              <select className={fieldCls} value={f.stage ?? 'discovery_done'} onChange={(e) => set({ stage: e.target.value })}>
                {STAGES.map((s) => <option key={s} value={s} className="bg-navy">{s.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1"><span className={LBL}>Next action</span><input className={fieldCls} value={f.next_action ?? ''} onChange={(e) => set({ next_action: e.target.value })} /></label>
            <label className="flex flex-col gap-1"><span className={LBL}>Due</span><input type="date" className={fieldCls} value={f.next_action_due ?? ''} onChange={(e) => set({ next_action_due: e.target.value || null })} /></label>
          </div>

          {(f.pain_points?.length || f.scope) && (
            <div className="border-t border-white/5 pt-3 flex flex-col gap-1.5">
              {f.scope && <p className="text-[12px] text-slate/70"><span className="text-slate/40 font-mono text-[9px] uppercase tracking-widest mr-1">scope</span>{f.scope}</p>}
              {(f.pain_points ?? []).map((p, i) => (
                <p key={i} className="text-[12px] text-slate/70"><span className="text-slate/40 font-mono text-[9px] uppercase tracking-widest mr-1">pain</span>{p}</p>
              ))}
            </div>
          )}

          {err && <p className="font-mono text-[10px] text-red-400">{err}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button className={btnGhost} onClick={onCancel}>Back to notes</button>
            <button className={btnPrimary} onClick={onCommit} disabled={processing}>
              {processing ? 'Writing…' : standalone ? 'Create deal →' : 'Update deal →'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DoneScreen({ result, deal, onReset }: { result: { deal: any; created: boolean; recap: string }; deal: DealLite | null; onReset: () => void }) {
  const actions = [
    { label: 'Draft proposal', instr: `Draft a proposal for the deal "${result.deal.name}" (id ${result.deal.id}) based on the discovery call I just logged in its notes.` },
    { label: 'Draft follow-up', instr: `Draft a follow-up email to ${result.deal.contact_name ?? 'the contact'} after our discovery call on the deal "${result.deal.name}" (id ${result.deal.id}).` },
    ...(deal?.site_id ? [{ label: 'Run audit', instr: `Run an audit on the site linked to deal "${result.deal.name}".` }] : []),
  ];
  const [fired, setFired] = useState<string | null>(null);
  const [out, setOut] = useState('');
  const [running, setRunning] = useState(false);

  const fire = async (a: { label: string; instr: string }) => {
    setFired(a.label);
    setRunning(true);
    setOut('');
    try {
      const resp = await fetch('/api/janet/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: a.instr, page_context: { path: '/admin/notepad' } }),
      });
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (!frame.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(frame.slice(6));
            if (ev.type === 'text_delta') {
              text += ev.text;
              setOut(text);
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      setOut('Failed: ' + (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-emerald-400">{result.created ? 'Deal created' : 'Deal updated'}</p>
      </div>
      <h2 className="text-2xl font-bold text-cream tracking-tight mb-4">{result.deal.name}</h2>

      <div className="border border-white/5 bg-navy p-5 mb-4">
        <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-slate/50 mb-2">// Recap written to the deal</p>
        <p className="text-cream/90 text-[13px] leading-relaxed whitespace-pre-wrap">{result.recap || '—'}</p>
        {result.deal.next_action && (
          <p className="font-mono text-[11px] text-electric mt-3">
            → {result.deal.next_action}
            {result.deal.next_action_due ? ` (${result.deal.next_action_due})` : ''}
          </p>
        )}
      </div>

      <p className={LBL + ' mb-2'}>Post-call — hand it to JANET</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => fire(a)}
            disabled={running}
            className={`font-mono text-[10px] tracking-widest uppercase px-3 py-2 border transition-colors ${
              fired === a.label ? 'border-electric text-electric' : 'border-white/10 text-slate hover:text-cream hover:border-white/30'
            } disabled:opacity-40`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {fired && (
        <div className="border border-electric/20 bg-electric/[0.04] p-4 mb-4">
          <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-electric mb-2">// {fired}{running ? ' · working…' : ''}</p>
          <p className="text-cream/90 text-[13px] leading-relaxed whitespace-pre-wrap">{out || (running ? '' : '—')}</p>
        </div>
      )}

      <div className="flex gap-2">
        <a href={`/admin/deals`} className={btnPrimary}>Go to deals →</a>
        <button className={btnGhost} onClick={onReset}>New note</button>
      </div>
    </motion.div>
  );
}

// ─── Question Bank tab ─────────────────────────────────────────────────

function QuestionBank({ initial }: { initial: BankQ[] }) {
  const [qs, setQs] = useState<BankQ[]>(initial);
  const sections: { key: DealType; label: string; hint: string }[] = [
    { key: null, label: 'Standard set', hint: 'asked on every discovery call' },
    { key: 'refresh', label: 'Refresh', hint: 'layered on when the deal is a refresh' },
    { key: 'new_build', label: 'New build', hint: 'layered on for greenfield builds' },
    { key: 'rescue', label: 'Rescue', hint: 'layered on for salvage jobs' },
  ];

  const add = async (dealType: DealType, text: string, topic: string) => {
    const maxSort = Math.max(0, ...qs.filter((q) => q.deal_type === dealType).map((q) => q.sort));
    const { question } = await api('/api/admin/janet/question-bank', 'POST', { text, topic, deal_type: dealType, sort: maxSort + 1 });
    setQs((p) => [...p, question]);
  };
  const update = async (id: string, patch: Partial<BankQ>) => {
    const { question } = await api(`/api/admin/janet/question-bank/${id}`, 'PUT', patch);
    setQs((p) => p.map((q) => (q.id === id ? question : q)));
  };
  const remove = async (id: string) => {
    await api(`/api/admin/janet/question-bank/${id}`, 'DELETE');
    setQs((p) => p.filter((q) => q.id !== id));
  };

  return (
    <div className="max-w-3xl">
      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-electric mb-1">// Question bank</p>
      <h2 className="text-2xl font-bold text-cream tracking-tight mb-1">What she asks</h2>
      <p className="text-slate/60 text-[13px] mb-6">
        Edit the baseline and the per-type templates. Each has a short <span className="text-electric/80">topic</span> — the tag that shows as a coverage marker when you tick it on a call.
      </p>

      <div className="flex flex-col gap-5">
        {sections.map((s) => (
          <BankSection
            key={s.label}
            label={s.label}
            hint={s.hint}
            items={qs.filter((q) => q.deal_type === s.key).sort((a, b) => a.sort - b.sort)}
            onAdd={(text, topic) => add(s.key, text, topic)}
            onUpdate={update}
            onRemove={remove}
          />
        ))}
      </div>
    </div>
  );
}

function BankSection({
  label,
  hint,
  items,
  onAdd,
  onUpdate,
  onRemove,
}: {
  label: string;
  hint: string;
  items: BankQ[];
  onAdd: (text: string, topic: string) => Promise<void>;
  onUpdate: (id: string, patch: Partial<BankQ>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onAdd(t, topic.trim());
      setDraft('');
      setTopic('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border border-white/5 bg-navy p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-cream">{label}</p>
        <span className="text-slate/40 text-[11px]">{hint}</span>
        <span className="ml-auto font-mono text-[9px] text-slate/40">{items.filter((i) => i.active).length}/{items.length} active</span>
      </div>
      <div className="flex flex-col gap-1.5 mb-3">
        {items.length === 0 && <p className="text-slate/40 text-[12px]">None yet.</p>}
        {items.map((q) => (
          <BankRow key={q.id} q={q} onUpdate={onUpdate} onRemove={onRemove} />
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={fieldCls + ' w-28 shrink-0'}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="topic"
        />
        <input
          className={fieldCls}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={`Add a ${label.toLowerCase()} question…`}
        />
        <button className={btnGhost + ' border border-white/10 shrink-0'} onClick={submit} disabled={busy}>
          Add
        </button>
      </div>
    </div>
  );
}

function BankRow({ q, onUpdate, onRemove }: { q: BankQ; onUpdate: (id: string, patch: Partial<BankQ>) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(q.text);
  const [topic, setTopic] = useState(q.topic ?? '');
  const commit = () => {
    setEditing(false);
    const patch: Partial<BankQ> = {};
    if (text.trim() && text !== q.text) patch.text = text.trim();
    if (topic.trim() !== (q.topic ?? '')) patch.topic = topic.trim();
    if (Object.keys(patch).length) onUpdate(q.id, patch);
    else {
      setText(q.text);
      setTopic(q.topic ?? '');
    }
  };
  return (
    <div className="flex items-start gap-2 group">
      <button
        onClick={() => onUpdate(q.id, { active: !q.active })}
        role="checkbox"
        aria-checked={q.active}
        aria-label={q.active ? 'Active — mute this question' : 'Muted — activate this question'}
        title={q.active ? 'Active — click to mute' : 'Muted — click to activate'}
        className={`mt-0.5 w-3.5 h-3.5 shrink-0 rounded-sm border transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-electric/60 ${q.active ? 'bg-electric border-electric' : 'border-white/20'}`}
      />
      {editing ? (
        <div className="flex-1 flex gap-2">
          <input
            className={fieldCls + ' py-1 w-28 shrink-0'}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="topic"
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <input
            className={fieldCls + ' py-1'}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="text-left flex-1 flex items-baseline gap-2">
          {q.topic && <span className="font-mono text-[9px] text-electric/70 shrink-0">{q.topic}</span>}
          <span className={`text-[12px] leading-snug ${q.active ? 'text-cream/85' : 'text-slate/40 line-through'}`}>{q.text}</span>
        </button>
      )}
      <button
        onClick={() => onRemove(q.id)}
        aria-label={`Delete question: ${q.text}`}
        className="font-mono text-[9px] uppercase tracking-widest text-slate/30 hover:text-red-400 focus-visible:text-red-400 focus-visible:outline-none transition-colors sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 shrink-0 mt-0.5"
      >
        del
      </button>
    </div>
  );
}
