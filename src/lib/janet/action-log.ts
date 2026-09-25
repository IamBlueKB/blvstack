// JANET — what she already did (continuity across turns).
//
// History replay is text-only (brain.ts): tool calls and results from past turns
// are dropped, so in a new turn she cannot see her own earlier ACTIONS. The ledger
// of real conversations shows exactly what that costs:
//   - "ok" after a search turn → she re-ran every search, then told Blue
//     "I haven't called any tools yet" (she had — she just couldn't see it).
//   - "ok" after closing a deal → she unpublished and closed it a second time.
//   - three same-titled docs, one published, the edits landing on another —
//     then "it's a stale cache" five times instead of noticing the mismatch.
// This digest re-surfaces, per recent turn, which tools ran and what they touched,
// so she builds on her own work instead of redoing or contradicting it.

type Row = { role: string; content: unknown; created_at?: string };

const MUTATING = /^(create|update|delete|set|log|record|add|publish|unpublish|send|draft|mark|void|archive|register|revoke|queue|file|reinforce|score|deactivate)_/;
const LABEL_KEYS = ['name', 'title', 'invoice_number', 'subject', 'vendor', 'email'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBody(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  const cut = content.indexOf('\n\n[');
  try {
    return JSON.parse(cut >= 0 ? content.slice(0, cut) : content);
  } catch {
    return null;
  }
}

/** The record a write touched: the first {id, label} in its result (shallow-first). */
function touched(result: unknown): string | null {
  const queue: unknown[] = [result];
  for (let n = 0; n < 40 && queue.length; n++) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { queue.push(...node.slice(0, 5)); continue; }
    const o = node as Record<string, unknown>;
    if (typeof o.id === 'string' && UUID.test(o.id)) {
      const label = LABEL_KEYS.map((k) => o[k]).find((v): v is string => typeof v === 'string' && v.trim() !== '');
      if (label) return `"${label.replace(/\s+/g, ' ').slice(0, 50)}" ${o.id}`;
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') queue.push(v);
  }
  return null;
}

type Call = { name: string; ok: boolean | null; error?: string; touched?: string | null };

/** One compact line per call group: reads collapse to name ×N; writes name what they touched. */
function summarize(calls: Call[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < calls.length) {
    const c = calls[i];
    if (!MUTATING.test(c.name)) {
      // Collapse a run of the same read.
      let j = i;
      while (j < calls.length && calls[j].name === c.name) j++;
      const run = calls.slice(i, j);
      const bad = run.filter((x) => x.ok === false).length;
      parts.push(`${c.name}${run.length > 1 ? ` ×${run.length}` : ''}${bad ? ` (${bad} failed)` : ''}`);
      i = j;
      continue;
    }
    const state = c.ok === null ? 'PROPOSED — awaiting Blue' : c.ok ? 'done' : `FAILED: ${(c.error ?? '').replace(/\s+/g, ' ').slice(0, 70)}`;
    parts.push(`${c.name} → ${state}${c.ok && c.touched ? ` ${c.touched}` : ''}`);
    i++;
  }
  return parts.join('; ');
}

/**
 * Digest of the tool activity in the given history rows (oldest first), one line per
 * turn that used tools, keyed by the message Blue sent. Only the last `maxTurns`.
 */
export function extractActionLog(rows: Row[], maxTurns = 8): string[] {
  const turns: { ask: string; at: string; calls: Call[]; byId: Map<string, Call> }[] = [];
  let cur: (typeof turns)[number] | null = null;
  for (const row of rows) {
    const blocks = Array.isArray(row.content) ? (row.content as any[]) : [];
    if (row.role === 'user') {
      const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
      cur = { ask: text.slice(0, 70), at: row.created_at ?? '', calls: [], byId: new Map() };
      turns.push(cur);
      continue;
    }
    if (!cur) continue;
    for (const b of blocks) {
      if (row.role === 'assistant' && b?.type === 'tool_use') {
        const call: Call = { name: String(b.name), ok: null }; // null until a result lands (Ring 3 → proposed)
        cur.calls.push(call);
        if (typeof b.id === 'string') cur.byId.set(b.id, call);
      } else if (row.role === 'tool' && b?.type === 'tool_result') {
        const call = cur.byId.get(b.tool_use_id);
        if (!call) continue;
        call.ok = !b.is_error;
        if (b.is_error) call.error = String(b.content ?? '');
        else call.touched = touched(parseBody(b.content));
      }
    }
  }
  return turns
    .filter((t) => t.calls.length > 0)
    .slice(-maxTurns)
    .map((t) => {
      const when = t.at ? new Date(t.at).toISOString().slice(5, 16).replace('T', ' ') + ' UTC' : '';
      return `- ${when} after Blue said "${t.ask}${t.ask.length >= 70 ? '…' : ''}": ${summarize(t.calls)}`.slice(0, 700);
    });
}

export function formatActionLog(lines: string[]): string {
  if (lines.length === 0) return '';
  return (
    `\n\n## What you already did in earlier turns of this thread\n` +
    `Tool calls from past turns are NOT replayed to you — this is the record of what actually ran (most recent last). ` +
    `Build on it: don't redo a step that's already done, don't claim you haven't acted when you have, and when a result "didn't take", ` +
    `check WHICH record your change landed on (below) before offering any other explanation. "PROPOSED — awaiting Blue" means it did not run unless a later "Executed:" message says so.\n` +
    lines.join('\n')
  );
}
