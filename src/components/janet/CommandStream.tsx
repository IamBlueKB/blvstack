/**
 * Docked command stream (spec §2). Not a chatbox — left-aligned entries with
 * monospace speaker labels, live tool-call status lines, markdown-rendered
 * replies, cockpit density. The rich blocks (audit cards, plan-approve-execute)
 * land in later phases and slot in as new item kinds.
 */
import { forwardRef } from 'react';
import type { ThreadItem } from './thread';
import Markdown from './Markdown';

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
      {it.status === 'done' && it.summary && (
        <span className="text-slate/45 truncate">{it.summary}</span>
      )}
    </div>
  );
}

const CommandStream = forwardRef<HTMLDivElement, { items: ThreadItem[]; busy: boolean }>(
  function CommandStream({ items, busy }, ref) {
    return (
      <div ref={ref} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3.5">
        {items.length === 0 && (
          <p className="text-slate/50 text-sm leading-relaxed">
            Ask about deals, sites, prospects, or replies. She reads live data before answering.
          </p>
        )}

        {items.map((it, i) => {
          if (it.kind === 'tool') return <ToolLine key={i} it={it} />;
          if (it.kind === 'error')
            return (
              <div key={i} className="font-mono text-[11px] text-red-400">
                ✕ {it.text}
              </div>
            );

          const isUser = it.kind === 'user';
          return (
            <div key={i} className="flex flex-col gap-1">
              <span
                className={`font-mono text-[9px] tracking-[0.25em] uppercase ${
                  isUser ? 'text-electric/80' : 'text-cream/50'
                }`}
              >
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
        })}

        {busy && items.length > 0 && items[items.length - 1].kind !== 'assistant' && (
          <div className="font-mono text-[9px] tracking-[0.25em] uppercase text-cream/40">Janet · working</div>
        )}
      </div>
    );
  }
);

export default CommandStream;
