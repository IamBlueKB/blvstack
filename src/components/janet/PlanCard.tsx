/**
 * Plan-approve-execute card (spec §4.4). When JANET proposes a Ring 3 action,
 * this renders the drafted action inline — affected recipient, subject, body —
 * with Approve / Adjust / Reject. Nothing leaves the building until Blue clicks
 * Approve; Adjust makes the draft editable first; Reject discards it.
 *
 * The card owns the POST to /api/janet/approve and reports the resulting status
 * back to the thread so the outcome (✓ Sent) persists in place.
 */
import { useState } from 'react';
import type { JanetProposal, PlanOutcome, PlanStatus } from './thread';

export default function PlanCard({
  proposals,
  status,
  outcomes,
  approvalId,
  onResolved,
}: {
  proposals: JanetProposal[];
  status: PlanStatus;
  outcomes?: PlanOutcome[];
  approvalId?: string | null;
  onResolved: (status: PlanStatus, outcomes?: PlanOutcome[]) => void;
}) {
  // Editable working copy (Adjust). Keyed by proposal index → field patch.
  const [edited, setEdited] = useState<Record<number, any>>({});
  const [editing, setEditing] = useState(false);

  const effective = proposals.map((p, i) => ({ ...p, input: { ...p.input, ...(edited[i] ?? {}) } }));
  const resolved = status === 'approved' || status === 'rejected';
  const working = status === 'working';

  const patch = (i: number, field: string, value: string) =>
    setEdited((prev) => ({ ...prev, [i]: { ...(prev[i] ?? {}), [field]: value } }));

  async function resolve(decision: 'approve' | 'reject') {
    if (resolved || working) return;
    onResolved('working');
    if (decision === 'reject') {
      try {
        await fetch('/api/janet/approve', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'reject', proposals: effective, approval_id: approvalId ?? null }),
        });
      } catch {}
      onResolved('rejected');
      return;
    }
    try {
      const r = await fetch('/api/janet/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve', proposals: effective, approval_id: approvalId ?? null }),
      });
      const data = await r.json().catch(() => ({}));
      const outs: PlanOutcome[] = data.outcomes ?? [];
      onResolved(outs.every((o) => o.ok) ? 'approved' : 'rejected', outs);
    } catch {
      onResolved('rejected', [{ tool: 'send_email', ok: false, summary: 'request failed' }]);
    }
  }

  return (
    <div className="rounded-xl border border-electric/30 bg-electric/[0.06] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-electric/20">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7 1v12M1 7h12" stroke="#2563EB" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
        </svg>
        <span className="font-mono text-[9px] tracking-[0.25em] uppercase text-electric">Needs approval</span>
        {resolved && (
          <span className={`ml-auto font-mono text-[9px] tracking-widest uppercase ${status === 'approved' ? 'text-emerald-400' : 'text-slate/60'}`}>
            {status === 'approved' ? 'done' : 'rejected'}
          </span>
        )}
      </div>

      {/* Proposals */}
      <div className="px-3.5 py-3 flex flex-col gap-3">
        {effective.map((p, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            {proposals.length > 1 && (
              <span className="font-mono text-[9px] tracking-widest uppercase text-slate/50">
                {i + 1}. {p.tool}
              </span>
            )}
            <p className="font-mono text-[11px] text-cream/90">{p.summary}</p>

            {p.tool === 'send_email' && (
              <div className="mt-1 rounded-lg bg-navy/60 border border-white/10 p-2.5 flex flex-col gap-1.5">
                <Field label="To" value={p.input.to ?? ''} editing={editing && !resolved} onChange={(v) => patch(i, 'to', v)} />
                <Field label="Subject" value={p.input.subject ?? ''} editing={editing && !resolved} onChange={(v) => patch(i, 'subject', v)} />
                {editing && !resolved ? (
                  <textarea
                    value={p.input.body ?? ''}
                    onChange={(e) => patch(i, 'body', e.target.value)}
                    rows={6}
                    className="w-full resize-none bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-cream text-[12px] leading-relaxed focus:outline-none focus:border-electric/50"
                  />
                ) : (
                  <p className="text-cream/85 text-[12px] leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">{p.input.body}</p>
                )}
              </div>
            )}
          </div>
        ))}

        {outcomes && outcomes.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {outcomes.map((o, i) => (
              <span key={i} className={`font-mono text-[10px] ${o.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {o.ok ? '✓' : '✕'} {o.summary}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {!resolved && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-electric/20">
          <button
            onClick={() => resolve('approve')}
            disabled={working}
            className="font-mono text-[10px] tracking-widest uppercase px-3 py-1.5 rounded bg-electric text-navy disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {working ? 'Working' : 'Approve'}
          </button>
          <button
            onClick={() => setEditing((e) => !e)}
            disabled={working}
            className={`font-mono text-[10px] tracking-widest uppercase px-3 py-1.5 rounded border transition-colors disabled:opacity-40 ${
              editing ? 'border-electric/60 text-electric' : 'border-white/15 text-slate hover:text-cream hover:border-white/30'
            }`}
          >
            Adjust
          </button>
          <button
            onClick={() => resolve('reject')}
            disabled={working}
            className="ml-auto font-mono text-[10px] tracking-widest uppercase px-3 py-1.5 rounded text-slate hover:text-red-400 transition-colors disabled:opacity-40"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, editing, onChange }: { label: string; value: string; editing: boolean; onChange: (v: string) => void }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[9px] tracking-widest uppercase text-slate/50 w-12 shrink-0">{label}</span>
      {editing ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-cream text-[12px] focus:outline-none focus:border-electric/50"
        />
      ) : (
        <span className="text-cream/90 text-[12px] truncate">{value}</span>
      )}
    </div>
  );
}
