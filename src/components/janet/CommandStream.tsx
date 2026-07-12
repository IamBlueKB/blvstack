/**
 * Docked command stream (spec §2). Not a chatbox — left-aligned entries with
 * monospace speaker labels, live tool-call status lines, markdown-rendered
 * replies, cockpit density.
 *
 * Response emergence: each of JANET's elements (tool lines, then text) emerges
 * from the orb's direction — scale up from 0.82, fade, blur→clear, settling
 * top-left toward the header orb (~340ms). Blue's own messages and loaded
 * history do not emerge (gated by emergeBaseline) — the effect is reserved for
 * her live voice, and it never delays reading.
 */
import { forwardRef } from 'react';
import { motion } from 'motion/react';
import type { ThreadItem, PlanStatus, PlanOutcome } from './thread';
import Markdown from './Markdown';
import PlanCard from './PlanCard';
import AuditCard from './AuditCard';

const EMERGE_INITIAL = { opacity: 0, scale: 0.82, filter: 'blur(6px)', x: -6, y: -4 };
const EMERGE_ANIMATE = { opacity: 1, scale: 1, filter: 'blur(0px)', x: 0, y: 0 };
const EMERGE_TRANSITION = { duration: 0.34, ease: [0.2, 0.7, 0.3, 1] as const };

function ToolLine({ it }: { it: Extract<ThreadItem, { kind: 'tool' }> }) {
  const running = it.status === 'running';
  return (
    <div className="flex items-baseline gap-2 font-mono text-[11px] leading-tight text-slate/80">
      <span className="text-slate/50">→</span>
      <span className="uppercase tracking-wide text-slate">{it.name}</span>
      {running ? (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-electric janet-pulse translate-y-[-1px]" />
      ) : (
        <span className={it.ok ? 'text-emerald-400' : 'text-red-400'}>{it.ok ? '✓' : '✕'}</span>
      )}
      {it.status === 'done' && it.summary && <span className="text-slate/45 truncate">{it.summary}</span>}
    </div>
  );
}

function Entry({ it }: { it: Exclude<ThreadItem, { kind: 'plan' | 'audit' }> }) {
  if (it.kind === 'tool') return <ToolLine it={it} />;
  if (it.kind === 'error') return <div className="font-mono text-[11px] text-red-400">✕ {it.text}</div>;

  const isUser = it.kind === 'user';
  return (
    <div className="flex flex-col gap-1">
      <span className={`font-mono text-[9px] tracking-[0.25em] uppercase ${isUser ? 'text-electric/80' : 'text-cream/50'}`}>
        {isUser ? 'Blue' : 'Janet'}
      </span>
      {isUser ? (
        <p className="text-cream text-sm whitespace-pre-wrap leading-relaxed">{it.text}</p>
      ) : it.text ? (
        <div className="text-cream/95 text-sm">
          <Markdown text={it.text} />
        </div>
      ) : (
        <span className="text-slate/40 text-sm">…</span>
      )}
    </div>
  );
}

const CommandStream = forwardRef<
  HTMLDivElement,
  {
    items: ThreadItem[];
    busy: boolean;
    emergeFrom: number;
    onResolvePlan: (i: number, status: PlanStatus, outcomes?: PlanOutcome[]) => void;
  }
>(function CommandStream({ items, busy, emergeFrom, onResolvePlan }, ref) {
    return (
      <div ref={ref} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3.5">
        {items.length === 0 && (
          <p className="text-slate/50 text-sm leading-relaxed">
            Ask about deals, sites, prospects, or replies. She reads live data before answering.
          </p>
        )}

        {items.map((it, i) => {
          const emerge = i >= emergeFrom && it.kind !== 'user';
          return (
            <motion.div
              key={i}
              initial={emerge ? EMERGE_INITIAL : false}
              animate={EMERGE_ANIMATE}
              transition={EMERGE_TRANSITION}
              style={{ transformOrigin: 'top left' }}
            >
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
                <Entry it={it} />
              )}
            </motion.div>
          );
        })}

        {busy && items.length > 0 && items[items.length - 1].kind !== 'assistant' && (
          <div className="font-mono text-[9px] tracking-[0.25em] uppercase text-cream/40">Janet · working</div>
        )}
      </div>
    );
  }
);

export default CommandStream;
