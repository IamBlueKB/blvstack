/**
 * JANET launcher — the closed-state identity element. Not corner-locked:
 * draggable anywhere, position persisted across pages/reloads, with a gentle
 * idle drift so she reads as a living presence floating in place rather than a
 * pinned button. Click to open; drag to move. (Motion with purpose — bounded
 * drift, not free-roaming across your content.)
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'motion/react';
import Orb, { type OrbState } from './Orb';

const KEY = 'janet_launcher_pos';
const SIZE = 64;
const MARGIN = 20;
const CLICK_SLOP = 4; // px of movement below which a pointer-up counts as a click

type Pos = { x: number; y: number };

export default function Launcher({ state, onOpen }: { state: OrbState; onOpen: () => void }) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ sx: number; sy: number; bx: number; by: number; moved: boolean } | null>(null);
  // Mirror of pos that's always current within the same tick — pointerup can
  // fire before React recommits a pointermove state update, so persistence
  // reads from here, not the (possibly stale) pos closure.
  const posRef = useRef<Pos | null>(null);

  const applyPos = (p: Pos) => {
    posRef.current = p;
    setPos(p);
  };

  // Load persisted position, else default to the bottom-right.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        applyPos(clampToViewport(JSON.parse(saved)));
        return;
      }
    } catch {}
    applyPos({ x: window.innerWidth - SIZE - MARGIN, y: window.innerHeight - SIZE - MARGIN });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clampToViewport(p: Pos): Pos {
    return {
      x: Math.min(Math.max(8, p.x), window.innerWidth - SIZE - 8),
      y: Math.min(Math.max(8, p.y), window.innerHeight - SIZE - 8),
    };
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = pos ?? { x: 0, y: 0 };
    drag.current = { sx: e.clientX, sy: e.clientY, bx: p.x, by: p.y, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > CLICK_SLOP) {
      d.moved = true;
      setDragging(true);
    }
    if (d.moved) applyPos(clampToViewport({ x: d.bx + dx, y: d.by + dy }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (!d.moved) {
      onOpen(); // a click, not a drag
      return;
    }
    if (posRef.current) {
      try {
        localStorage.setItem(KEY, JSON.stringify(posRef.current));
      } catch {}
    }
  };

  if (!pos) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="button"
      aria-label="Open JANET (Cmd+J) — drag to move"
      title="JANET — click to open · drag to move · Cmd/Ctrl+J"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 40,
        touchAction: 'none',
        cursor: dragging ? 'grabbing' : 'grab',
      }}
    >
      {/* Inner layer carries the idle drift so it composes cleanly with the
          outer enter/exit scale and the drag-controlled left/top. */}
      <div className={dragging ? '' : 'janet-float'}>
        <Orb state={state} size={SIZE} active halo />
      </div>
    </motion.div>
  );
}
