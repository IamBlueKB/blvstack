/**
 * Expanded spatial view — her world, rebuilt for clarity (2026-09-25).
 *
 * The first version made EVERY thread item a free-floating draggable card — each of
 * Blue's messages, each reply, and each individual tool call — seeded with a modulo
 * layout that wrapped after ~5 items, so new cards landed on top of old ones and one
 * ten-tool turn produced a dozen overlapping boxes. Now:
 *   - one card per EXCHANGE (Blue's message + her answer); her tool calls fold into a
 *     single expandable activity line inside it instead of a box each;
 *   - cards stack in normal flow in one column beside the orb — nothing can overlap;
 *   - only the most recent exchanges show; earlier ones are one click away;
 *   - the orb stays a present being on the left, and her newest answer arrives from it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { motion } from 'motion/react';
import type { ThreadItem, PlanStatus, PlanOutcome } from './thread';
import Orb from './Orb';
import Markdown from './Markdown';
import Composer from './Composer';
import PlanCard from './PlanCard';
import AuditCard from './AuditCard';
import Briefing, { type BriefingContent } from './Briefing';

/** Exchanges shown before "show earlier". */
const RECENT = 4;

type Part = { i: number; it: ThreadItem };
type Exchange = { key: number; user: string | null; parts: Part[] };

/** Group the flat thread into exchanges: each of Blue's messages opens one. */
function toExchanges(items: ThreadItem[]): Exchange[] {
  const out: Exchange[] = [];
  items.forEach((it, i) => {
    if (it.kind === 'user') out.push({ key: i, user: it.text, parts: [] });
    else {
      if (out.length === 0) out.push({ key: i, user: null, parts: [] });
      out[out.length - 1].parts.push({ i, it });
    }
  });
  return out;
}

const label = 'font-mono text-[9px] tracking-[0.25em] uppercase';

export default function SpatialCanvas({
  items,
  busy,
  onCollapse,
  input,
  setInput,
  onSend,
  onStop,
  composerRef,
  emergeFrom,
  pulseSignal,
  onResolvePlan,
  briefing,
  onDismissBriefing,
}: {
  items: ThreadItem[];
  busy: boolean;
  onCollapse: () => void;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  emergeFrom: number;
  pulseSignal: number;
  onResolvePlan: (i: number, status: PlanStatus, outcomes?: PlanOutcome[]) => void;
  briefing?: { content: BriefingContent; date?: string } | null;
  onDismissBriefing?: () => void;
}) {
  const exchanges = useMemo(() => toExchanges(items), [items]);
  const [showAll, setShowAll] = useState(false);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const hidden = showAll ? 0 : Math.max(0, exchanges.length - RECENT);
  const visible = exchanges.slice(hidden);

  // Follow the conversation as it streams — unless Blue has scrolled up to read.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const orbSize = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.36);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
      className="fixed inset-0 z-50 overflow-hidden"
      style={{ background: 'radial-gradient(120% 90% at 30% 45%, #0D1F3C 0%, #0A1628 60%, #070F1E 100%)' }}
    >
      {/* Dot grid */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(120% 100% at 30% 45%, #000 40%, transparent 90%)',
          WebkitMaskImage: 'radial-gradient(120% 100% at 30% 45%, #000 40%, transparent 90%)',
        }}
      />

      {/* Orb presence — left of the conversation (faint and behind it on phones) */}
      <div className="absolute pointer-events-none left-1/2 md:left-[24%] top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-25 md:opacity-90">
        <Orb state={busy ? 'working' : 'idle'} size={orbSize} active halo pulseSignal={pulseSignal} />
      </div>

      {/* Header */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 h-14 z-10">
        <div className="flex items-center gap-2.5">
          <span className={`inline-block w-2 h-2 rounded-full bg-electric ${busy ? 'janet-ping' : 'janet-pulse'}`} />
          <span className="font-mono text-[11px] tracking-[0.3em] uppercase text-cream">JANET</span>
          <span className="font-mono text-[9px] tracking-widest uppercase text-slate/50">spatial</span>
        </div>
        <button
          onClick={onCollapse}
          className="font-mono text-[10px] tracking-widest uppercase text-slate hover:text-cream transition-colors flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M8 1H11V4M4 11H1V8M11 1L7 5M1 11L5 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Collapse · Esc
        </button>
      </div>

      {/* The conversation — one column, normal flow, beside the orb */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        // bottom-40 clears the floating composer (~130px tall incl. its offset) with room to spare.
        className="absolute top-14 bottom-40 left-0 right-0 md:left-[46%] overflow-y-auto overscroll-contain px-4 md:pr-10"
      >
        <div className="max-w-[640px] flex flex-col gap-4 py-4">
          {briefing && (
            <div className="relative rounded-xl bg-navy/90 backdrop-blur-xl shadow-2xl shadow-black/50 border border-white/10">
              <button
                onClick={() => setBriefingExpanded((e) => !e)}
                aria-label={briefingExpanded ? 'Collapse briefing' : 'Expand briefing'}
                className="absolute top-2 right-2 z-10 font-mono text-[9px] uppercase tracking-widest text-slate hover:text-cream"
              >
                {briefingExpanded ? 'Less' : 'More'}
              </button>
              <Briefing content={briefing.content} date={briefing.date} onDismiss={onDismissBriefing ?? (() => {})} expanded={briefingExpanded} />
            </div>
          )}

          {hidden > 0 && (
            <button onClick={() => setShowAll(true)} className="self-start font-mono text-[10px] uppercase tracking-widest text-slate/60 hover:text-cream">
              ↑ Show {hidden} earlier
            </button>
          )}
          {showAll && exchanges.length > RECENT && (
            <button onClick={() => setShowAll(false)} className="self-start font-mono text-[10px] uppercase tracking-widest text-slate/60 hover:text-cream">
              Show recent only
            </button>
          )}

          {visible.map((ex, n) => (
            <ExchangeCard
              key={ex.key}
              ex={ex}
              latest={n === visible.length - 1}
              busy={busy}
              emergeFrom={emergeFrom}
              onResolvePlan={onResolvePlan}
            />
          ))}

          {exchanges.length === 0 && !briefing && (
            <p className="text-slate/50 text-[13px]">Ask me anything — the pipeline, the books, a client, a doc.</p>
          )}
        </div>
      </div>

      {/* Floating composer */}
      <div className="absolute bottom-6 inset-x-0 flex justify-center px-4 z-10">
        <Composer ref={composerRef} value={input} onChange={setInput} onSend={onSend} onStop={onStop} busy={busy} variant="floating" />
      </div>
    </motion.div>
  );
}

/** One exchange: Blue's message, then her answer — actions folded, text, cards. */
function ExchangeCard({
  ex,
  latest,
  busy,
  emergeFrom,
  onResolvePlan,
}: {
  ex: Exchange;
  latest: boolean;
  busy: boolean;
  emergeFrom: number;
  onResolvePlan: (i: number, status: PlanStatus, outcomes?: PlanOutcome[]) => void;
}) {
  const tools = ex.parts.filter((p) => p.it.kind === 'tool');
  const texts = ex.parts.filter((p) => p.it.kind === 'assistant');
  const cards = ex.parts.filter((p) => p.it.kind === 'plan' || p.it.kind === 'audit');
  const errors = ex.parts.filter((p) => p.it.kind === 'error');
  const hasHer = ex.parts.length > 0 || (latest && busy);

  return (
    <div
      className={`rounded-xl bg-navy/85 backdrop-blur border px-4 py-3.5 shadow-xl shadow-black/40 transition-opacity duration-300 ${
        latest ? 'border-electric/30' : 'border-white/10 opacity-60 hover:opacity-100'
      }`}
    >
      {ex.user !== null && (
        <div>
          <span className={`${label} text-electric/80`}>Blue</span>
          <p className="mt-1 text-cream/90 text-[13px] leading-relaxed whitespace-pre-wrap">{ex.user}</p>
        </div>
      )}

      {hasHer && (
        <div className={ex.user !== null ? 'mt-3 pt-3 border-t border-white/[0.06]' : ''}>
          <span className={`${label} text-cream/50`}>Janet</span>
          {tools.length > 0 && <Activity tools={tools} />}
          {texts.map((p) => {
            const text = (p.it as Extract<ThreadItem, { kind: 'assistant' }>).text;
            return (
              <motion.div
                key={p.i}
                // Her newest words arrive from the orb's side.
                initial={p.i >= emergeFrom ? { opacity: 0, x: -18, filter: 'blur(4px)' } : false}
                animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.45, ease: [0.18, 0.7, 0.25, 1] }}
                className="mt-1.5 text-cream/95 text-[13.5px] leading-relaxed"
              >
                {text ? <Markdown text={text} /> : <span className="text-slate/40">…</span>}
              </motion.div>
            );
          })}
          {cards.map((p) =>
            p.it.kind === 'plan' ? (
              <div key={p.i} className="mt-3">
                <PlanCard
                  proposals={p.it.proposals}
                  status={p.it.status}
                  outcomes={p.it.outcomes}
                  approvalId={p.it.approval_id}
                  onResolved={(s, o) => onResolvePlan(p.i, s, o)}
                />
              </div>
            ) : p.it.kind === 'audit' ? (
              <div key={p.i} className="mt-3">
                <AuditCard tool={p.it.tool} result={p.it.result} />
              </div>
            ) : null
          )}
          {errors.map((p) => (
            <p key={p.i} className="mt-2 font-mono text-[11px] text-red-400">
              ✕ {(p.it as Extract<ThreadItem, { kind: 'error' }>).text}
            </p>
          ))}
          {latest && busy && texts.length === 0 && tools.length === 0 && (
            <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-electric janet-pulse" aria-label="Thinking" />
          )}
        </div>
      )}
    </div>
  );
}

/** Her tool calls for one exchange, folded into a single expandable line. */
function Activity({ tools }: { tools: Part[] }) {
  const [open, setOpen] = useState(false);
  const list = tools.map((p) => p.it as Extract<ThreadItem, { kind: 'tool' }>);
  const running = list.filter((t) => t.status === 'running').length;
  const failed = list.filter((t) => t.status === 'done' && t.ok === false).length;
  const summary = running
    ? `working · ${list.length - running}/${list.length} done`
    : `${list.length} action${list.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`;
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-slate/70 hover:text-cream transition-colors"
      >
        {running ? (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-electric janet-pulse" />
        ) : (
          <span className={failed ? 'text-red-400' : 'text-emerald-400'}>{failed ? '!' : '✓'}</span>
        )}
        {summary}
        <span className="text-slate/40">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 border-l border-white/10 pl-3">
          {list.map((t, k) => (
            <li key={k} className="font-mono text-[10px] text-slate/70">
              <span className={t.status === 'running' ? 'text-electric' : t.ok ? 'text-emerald-400' : 'text-red-400'}>
                {t.status === 'running' ? '…' : t.ok ? '✓' : '✕'}
              </span>{' '}
              {t.name}
              {t.status === 'done' && t.summary ? <span className="block text-slate/45 line-clamp-2">{t.summary}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
