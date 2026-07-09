/**
 * Expanded spatial canvas (spec §3) — her world. The thread becomes a SPACE,
 * not a scroll: each entry is a draggable node positioned in the field,
 * connected by subtle lines in conversation order, with the orb scaled up as a
 * present being in the space. Soft dot-grid, depth, animated in/out.
 *
 * Positions are owned by the parent (Panel) so the layout survives collapse →
 * expand. Drag is manual pointer capture (controlled left/top) so the
 * connecting lines stay exact; motion handles only spawn + the overlay
 * transition, avoiding transform/position double-application.
 */
import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { motion } from 'motion/react';
import type { ThreadItem } from './thread';
import Orb from './Orb';
import Markdown from './Markdown';
import Composer from './Composer';

const CARD_W = 248;
const ANCHOR_Y = 30; // line attaches near each card's top

type Pos = { x: number; y: number };

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
}) {
  const drag = useRef<{ i: number; sx: number; sy: number; bx: number; by: number } | null>(null);

  // Seed a flowing layout for any node that doesn't have a position yet.
  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const colX = Math.max(w * 0.52, w - 520); // right of the orb presence
    for (let i = 0; i < items.length; i++) {
      if (pos[i]) continue;
      const zig = i % 2 === 0 ? 0 : 150;
      const y = 90 + ((i * 132) % Math.max(h - 320, 300));
      onMove(i, { x: colX + zig, y });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

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
    return p ? { x: p.x + CARD_W / 2, y: p.y + ANCHOR_Y } : null;
  };

  const orbSize = Math.round(Math.min(typeof window !== 'undefined' ? window.innerWidth : 900, typeof window !== 'undefined' ? window.innerHeight : 700) * 0.4);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
      className="fixed inset-0 z-50 overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 90% at 40% 45%, #0D1F3C 0%, #0A1628 60%, #070F1E 100%)',
      }}
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
      <div
        className="absolute pointer-events-none"
        style={{ left: '30%', top: '50%', transform: 'translate(-50%,-50%)', opacity: 0.92 }}
      >
        <Orb state={busy ? 'working' : 'idle'} size={orbSize} active halo />
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

      {/* Nodes */}
      {items.map((it, i) => {
        const p = pos[i];
        if (!p) return null;
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            onPointerDown={(e) => onPointerDown(e, i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="absolute select-none cursor-grab active:cursor-grabbing"
            style={{ left: p.x, top: p.y, width: CARD_W }}
          >
            <NodeCard it={it} />
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

      {/* Floating composer */}
      <div className="absolute bottom-6 inset-x-0 flex justify-center px-4 z-10">
        <Composer ref={composerRef} value={input} onChange={setInput} onSend={onSend} busy={busy} variant="floating" />
      </div>
    </motion.div>
  );
}

function NodeCard({ it }: { it: ThreadItem }) {
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
    <div
      className={`rounded-xl bg-navy/85 backdrop-blur border px-3.5 py-3 shadow-xl shadow-black/50 ${
        isUser ? 'border-electric/25' : 'border-white/10'
      }`}
    >
      <span className={`font-mono text-[9px] tracking-[0.25em] uppercase ${isUser ? 'text-electric/80' : 'text-cream/50'}`}>
        {isUser ? 'Blue' : 'Janet'}
      </span>
      <div className="mt-1.5 max-h-56 overflow-y-auto text-cream/95 text-[13px] leading-relaxed">
        {isUser ? <p className="whitespace-pre-wrap">{it.text}</p> : it.text ? <Markdown text={it.text} /> : <span className="text-slate/40">…</span>}
      </div>
    </div>
  );
}
