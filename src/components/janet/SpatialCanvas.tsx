/**
 * Expanded spatial canvas (spec §3) — her world. The thread becomes a SPACE,
 * not a scroll: each entry is a draggable node positioned in the field,
 * connected by subtle lines in conversation order, with the orb scaled up as a
 * present being in the space.
 *
 * Response emanation: JANET's elements spawn AT the orb centre and fly outward
 * to their position — scale from 0.3 at the orb, blur→clear, ease to the final
 * spot (~600ms). As each lands, a trace beam draws from the orb to it (an
 * electric gradient fading to transparent), then dissolves — so the orb is
 * visibly the source of her voice. Only the latest turn's elements emanate
 * (gated by emergeFrom); Blue's messages and settled history do not.
 *
 * Positions are owned by the parent (Panel) so the layout survives collapse →
 * expand. Drag is manual pointer capture (controlled left/top) so lines stay
 * exact; the emerge transform (x/y) resolves to 0, leaving drag unaffected.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { motion } from 'motion/react';
import type { ThreadItem, PlanStatus, PlanOutcome } from './thread';
import Orb from './Orb';
import Markdown from './Markdown';
import Composer from './Composer';
import PlanCard from './PlanCard';
import AuditCard from './AuditCard';
import Briefing, { type BriefingContent } from './Briefing';

const CARD_W = 248;
const EXPANDED_W = 440; // widened card when a node is expanded
const ANCHOR_Y = 30; // line attaches near each card's top

type Pos = { x: number; y: number };

/** Flowing layout seed — shared by the layout effect and the beam spawn so
 *  both agree on where a node lands even before its position is committed. */
function seedPos(i: number): Pos {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const colX = Math.max(w * 0.52, w - 520); // right of the orb presence
  const zig = i % 2 === 0 ? 0 : 150;
  const y = 90 + ((i * 132) % Math.max(h - 320, 300));
  return { x: colX + zig, y };
}

export default function SpatialCanvas({
  items,
  busy,
  pos,
  onMove,
  onCollapse,
  input,
  setInput,
  onSend,
  composerRef,
  emergeFrom,
  pulseSignal,
  onResolvePlan,
  briefing,
  onDismissBriefing,
}: {
  items: ThreadItem[];
  busy: boolean;
  pos: Record<number, Pos>;
  onMove: (i: number, p: Pos) => void;
  onCollapse: () => void;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  emergeFrom: number;
  pulseSignal: number;
  onResolvePlan: (i: number, status: PlanStatus, outcomes?: PlanOutcome[]) => void;
  briefing?: { content: BriefingContent; date?: string } | null;
  onDismissBriefing?: () => void;
}) {
  const drag = useRef<{ i: number; sx: number; sy: number; bx: number; by: number } | null>(null);
  const [orbCenter, setOrbCenter] = useState<Pos>(() => ({ x: window.innerWidth * 0.3, y: window.innerHeight * 0.5 }));
  const [beams, setBeams] = useState<{ id: number; to: Pos }[]>([]);
  const emerged = useRef<Set<number>>(new Set());
  const beamId = useRef(0);
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
  const [briefingExpanded, setBriefingExpanded] = useState(false);

  const widthOf = (i: number) => (expandedNodes.has(i) ? EXPANDED_W : CARD_W);
  const toggleExpand = (i: number) =>
    setExpandedNodes((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  useEffect(() => {
    const onResize = () => setOrbCenter({ x: window.innerWidth * 0.3, y: window.innerHeight * 0.5 });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Seed a flowing layout for any node that doesn't have a position yet.
  useEffect(() => {
    for (let i = 0; i < items.length; i++) {
      if (!pos[i]) onMove(i, seedPos(i));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // Fire a trace beam as each of her elements emerges (once per node index).
  useEffect(() => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (i >= emergeFrom && it.kind !== 'user' && !emerged.current.has(i)) {
        emerged.current.add(i);
        const p = pos[i] ?? seedPos(i);
        const id = beamId.current++;
        setBeams((prev) => [...prev, { id, to: { x: p.x + CARD_W / 2, y: p.y + ANCHOR_Y } }]);
        // Deterministic cleanup — don't depend on onAnimationComplete firing.
        setTimeout(() => setBeams((prev) => prev.filter((x) => x.id !== id)), 1250);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, emergeFrom]);

  const onPointerDown = (e: ReactPointerEvent, i: number) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = pos[i] ?? { x: 0, y: 0 };
    drag.current = { i, sx: e.clientX, sy: e.clientY, bx: p.x, by: p.y };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    onMove(d.i, { x: d.bx + (e.clientX - d.sx), y: d.by + (e.clientY - d.sy) });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const center = (i: number): Pos | null => {
    const p = pos[i];
    return p ? { x: p.x + widthOf(i) / 2, y: p.y + ANCHOR_Y } : null;
  };

  const orbSize = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.4);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
      className="fixed inset-0 z-50 overflow-hidden"
      style={{ background: 'radial-gradient(120% 90% at 40% 45%, #0D1F3C 0%, #0A1628 60%, #070F1E 100%)' }}
    >
      {/* Dot grid */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(120% 100% at 40% 45%, #000 40%, transparent 90%)',
          WebkitMaskImage: 'radial-gradient(120% 100% at 40% 45%, #000 40%, transparent 90%)',
        }}
      />

      {/* Orb presence — behind the nodes, left-of-centre */}
      <div className="absolute pointer-events-none" style={{ left: '30%', top: '50%', transform: 'translate(-50%,-50%)', opacity: 0.92 }}>
        <Orb state={busy ? 'working' : 'idle'} size={orbSize} active halo pulseSignal={pulseSignal} />
      </div>

      {/* Connecting lines (conversation flow) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        {items.map((_, i) => {
          if (i === 0) return null;
          const a = center(i - 1);
          const b = center(i);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2;
          return (
            <path
              key={i}
              d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
              fill="none"
              stroke="#2563EB"
              strokeOpacity={0.18}
              strokeWidth={1}
            />
          );
        })}
      </svg>

      {/* Trace beams — orb → node as each emerges, then dissolve */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        <defs>
          {beams.map((b) => (
            <linearGradient
              key={b.id}
              id={`janet-beam-${b.id}`}
              gradientUnits="userSpaceOnUse"
              x1={orbCenter.x}
              y1={orbCenter.y}
              x2={b.to.x}
              y2={b.to.y}
            >
              <stop offset="0%" stopColor="#7DA8FF" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#2563EB" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {beams.map((b) => (
          <motion.path
            key={b.id}
            d={`M ${orbCenter.x} ${orbCenter.y} L ${b.to.x} ${b.to.y}`}
            fill="none"
            stroke={`url(#janet-beam-${b.id})`}
            strokeWidth={1.5}
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0.95 }}
            animate={{ pathLength: 1, opacity: [0.95, 0.95, 0] }}
            transition={{
              pathLength: { duration: 0.5, ease: [0.18, 0.7, 0.25, 1] },
              opacity: { duration: 1.1, times: [0, 0.5, 1], ease: 'easeIn' },
            }}
          />
        ))}
      </svg>

      {/* Nodes */}
      {items.map((it, i) => {
        const p = pos[i];
        if (!p) return null;
        const emerge = i >= emergeFrom && it.kind !== 'user';
        const isExpanded = expandedNodes.has(i);
        const expandable = it.kind !== 'tool' && it.kind !== 'error';
        return (
          <motion.div
            key={i}
            initial={
              emerge
                ? {
                    opacity: 0,
                    scale: 0.3,
                    filter: 'blur(8px)',
                    x: orbCenter.x - (p.x + CARD_W / 2),
                    y: orbCenter.y - (p.y + ANCHOR_Y),
                  }
                : { opacity: 0, scale: 0.9 }
            }
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', x: 0, y: 0 }}
            transition={emerge ? { duration: 0.6, ease: [0.18, 0.7, 0.25, 1] } : { duration: 0.28, ease: 'easeOut' }}
            onPointerDown={(e) => onPointerDown(e, i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="absolute select-none cursor-grab active:cursor-grabbing group"
            style={{ left: p.x, top: p.y, width: widthOf(i) }}
          >
            {expandable && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggleExpand(i)}
                aria-label={isExpanded ? 'Collapse card' : 'Expand card'}
                title={isExpanded ? 'Collapse' : 'Expand'}
                className="absolute -top-2 -right-2 z-10 grid place-items-center w-6 h-6 rounded-full bg-navy border border-white/15 text-slate hover:text-cream hover:border-electric/50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  {isExpanded ? (
                    <path d="M4.5 7.5L1.5 10.5M1.5 8v2.5H4M7.5 4.5l3-3M10.5 4V1.5H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <path d="M7.5 1.5h3v3M4.5 10.5h-3v-3M10.5 1.5l-4 4M1.5 10.5l4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                </svg>
              </button>
            )}
            {it.kind === 'plan' ? (
              <PlanCard
                proposals={it.proposals}
                status={it.status}
                outcomes={it.outcomes}
                approvalId={it.approval_id}
                onResolved={(s, o) => onResolvePlan(i, s, o)}
              />
            ) : it.kind === 'audit' ? (
              <AuditCard tool={it.tool} result={it.result} />
            ) : (
              <NodeCard it={it} expanded={isExpanded} />
            )}
          </motion.div>
        );
      })}

      {/* Header controls */}
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

      {/* Pinned briefing (spec §8) — prominent in her world, expandable */}
      {briefing && (
        <div className={`absolute top-16 left-1/2 -translate-x-1/2 z-20 w-full px-4 transition-[max-width] duration-300 ${briefingExpanded ? 'max-w-3xl' : 'max-w-md'}`}>
          <div className="relative rounded-xl bg-navy/90 backdrop-blur-xl shadow-2xl shadow-black/50 border border-white/10">
            <button
              onClick={() => setBriefingExpanded((e) => !e)}
              aria-label={briefingExpanded ? 'Collapse briefing' : 'Expand briefing'}
              title={briefingExpanded ? 'Collapse' : 'Expand'}
              className="absolute -top-2 -right-2 z-10 grid place-items-center w-6 h-6 rounded-full bg-navy border border-white/15 text-slate hover:text-cream hover:border-electric/50 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                {briefingExpanded ? (
                  <path d="M4.5 7.5L1.5 10.5M1.5 8v2.5H4M7.5 4.5l3-3M10.5 4V1.5H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M7.5 1.5h3v3M4.5 10.5h-3v-3M10.5 1.5l-4 4M1.5 10.5l4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>
            <Briefing content={briefing.content} date={briefing.date} onDismiss={onDismissBriefing ?? (() => {})} expanded={briefingExpanded} />
          </div>
        </div>
      )}

      {/* Floating composer */}
      <div className="absolute bottom-6 inset-x-0 flex justify-center px-4 z-10">
        <Composer ref={composerRef} value={input} onChange={setInput} onSend={onSend} busy={busy} variant="floating" />
      </div>
    </motion.div>
  );
}

function NodeCard({ it, expanded }: { it: Exclude<ThreadItem, { kind: 'plan' | 'audit' }>; expanded?: boolean }) {
  if (it.kind === 'tool') {
    return (
      <div className="rounded-lg bg-navy/80 backdrop-blur border border-white/10 px-3 py-2 shadow-lg shadow-black/40">
        <div className="flex items-center gap-2 font-mono text-[10px] text-slate/80">
          <span className="text-slate/50">→</span>
          <span className="uppercase tracking-wide">{it.name}</span>
          {it.status === 'running' ? (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-electric janet-pulse" />
          ) : (
            <span className={it.ok ? 'text-emerald-400' : 'text-red-400'}>{it.ok ? '✓' : '✕'}</span>
          )}
        </div>
        {it.status === 'done' && it.summary && (
          <p className="mt-1 font-mono text-[9px] text-slate/50 leading-snug line-clamp-3">{it.summary}</p>
        )}
      </div>
    );
  }
  if (it.kind === 'error') {
    return (
      <div className="rounded-lg bg-navy/80 backdrop-blur border border-red-500/30 px-3 py-2 shadow-lg shadow-black/40 font-mono text-[11px] text-red-400">
        ✕ {it.text}
      </div>
    );
  }
  const isUser = it.kind === 'user';
  return (
    <div className={`rounded-xl bg-navy/85 backdrop-blur border px-3.5 py-3 shadow-xl shadow-black/50 ${isUser ? 'border-electric/25' : 'border-white/10'}`}>
      <span className={`font-mono text-[9px] tracking-[0.25em] uppercase ${isUser ? 'text-electric/80' : 'text-cream/50'}`}>
        {isUser ? 'Blue' : 'Janet'}
      </span>
      <div className={`mt-1.5 text-cream/95 text-[13px] leading-relaxed ${expanded ? '' : 'max-h-56 overflow-y-auto'}`}>
        {isUser ? <p className="whitespace-pre-wrap">{it.text}</p> : it.text ? <Markdown text={it.text} /> : <span className="text-slate/40">…</span>}
      </div>
    </div>
  );
}
