/**
 * Daily briefing (spec §8) — pinned at the top of the docked stream on the
 * first visit of the day. Calm, short, evidence-first: Needs attention /
 * Suggestions / FYI. A quiet day is just the summary line.
 */
type Item = { title: string; evidence: string; action?: string };
export type BriefingContent = {
  summary: string;
  needs_attention: Item[];
  suggestions: Item[];
  fyi: Item[];
};

function Section({ label, tone, items }: { label: string; tone: string; items: Item[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={`font-mono text-[9px] tracking-[0.25em] uppercase ${tone}`}>{label}</span>
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-0.5 pl-2 border-l border-white/10">
          <p className="text-cream/90 text-[12px] leading-snug">{it.title}</p>
          <p className="text-slate/55 text-[10px] leading-snug">{it.evidence}</p>
          {it.action && <p className="text-electric/80 text-[10px] leading-snug">→ {it.action}</p>}
        </div>
      ))}
    </div>
  );
}

export default function Briefing({ content, date, onDismiss, expanded }: { content: BriefingContent; date?: string; onDismiss: () => void; expanded?: boolean }) {
  const empty = !content.needs_attention?.length && !content.suggestions?.length && !content.fyi?.length;
  return (
    <div className="m-3 rounded-xl border border-electric/25 bg-electric/[0.05] overflow-hidden shrink-0">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-electric/20">
        <span className="inline-block w-2 h-2 rounded-full bg-electric janet-pulse" />
        <span className="font-mono text-[9px] tracking-[0.25em] uppercase text-electric">Briefing</span>
        {date && <span className="font-mono text-[9px] tracking-widest uppercase text-slate/50">{date}</span>}
        <button onClick={onDismiss} aria-label="Dismiss briefing" className="ml-auto text-slate hover:text-cream transition-colors font-mono text-[11px]">
          ✕
        </button>
      </div>
      <div className={`px-3.5 py-3 flex flex-col gap-3 ${expanded ? '' : 'max-h-[42vh] overflow-y-auto'}`}>
        <p className="text-cream text-[13px] leading-relaxed">{content.summary}</p>
        {!empty && (
          <>
            <Section label="Needs attention" tone="text-amber-400" items={content.needs_attention} />
            <Section label="Suggestions" tone="text-electric/80" items={content.suggestions} />
            <Section label="FYI" tone="text-slate/60" items={content.fyi} />
          </>
        )}
      </div>
    </div>
  );
}
