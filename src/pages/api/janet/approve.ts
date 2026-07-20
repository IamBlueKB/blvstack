import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { executeJanetTool } from '../../../lib/janet/tools/registry';
import { logJanetAction } from '../../../lib/janet/actions';
import type { JanetContext } from '../../../lib/janet/types';

export const prerender = false;
export const maxDuration = 60;

/**
 * POST /api/janet/approve — the plan-approve-execute endpoint (spec §4.4).
 * Body: { proposals: [{ tool, input }], decision: 'approve' | 'reject' }
 *
 * This is the ONLY path that runs a Ring 3 action, and it runs it with
 * approvedByUser=true so the registry permits + logs it. On reject, each
 * proposal is logged as rejected. A short note is written to the thread so
 * history reflects the decision. Auth: founder session (middleware) + the
 * belt-and-suspenders check below.
 */
/** GET /api/janet/approve — pending approvals still waiting on Blue. The panel
 *  fetches these on open and re-renders them as plan cards, so an approval is
 *  never lost to a closed panel or dropped session. */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const { data, error } = await supabaseAdmin
    .from('janet_pending_approvals')
    .select('id, proposals, summary, created_at, kind, priority, value_estimate, evidence')
    .eq('status', 'pending')
    .order('priority', { ascending: false }) // ranked worklist (Phase 6.2)
    .order('created_at', { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json({ pending: data ?? [] });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);

  let body: { edits?: Record<string, any>; decision?: string; approval_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const decision = body.decision === 'reject' ? 'reject' : 'approve';
  const approvalId = typeof body.approval_id === 'string' && body.approval_id ? body.approval_id : null;

  // M-FIX (Finding M): approval_id is MANDATORY, and the endpoint executes ONLY
  // the STORED proposal — never a proposal reconstructed from the request body.
  // What the plan card shows IS what runs; the action/tool can't be swapped by a
  // request. The raw-proposals path is removed.
  if (!approvalId) return json({ error: 'approval_id is required.' }, 400);
  const { data: row } = await supabaseAdmin.from('janet_pending_approvals').select('*').eq('id', approvalId).maybeSingle();
  if (!row) return json({ error: 'Approval not found' }, 404);
  if (row.status !== 'pending') return json({ ok: true, decision: row.status, already_resolved: true, outcomes: [] }); // idempotent
  const threadId: string | null = row.thread_id ?? null;

  let proposals = (row.proposals ?? []) as { tool: string; input: any; summary?: string }[];
  if (proposals.length === 0) return json({ error: 'No proposals to act on' }, 400);

  // Adjust: apply ONLY whitelisted content edits (to/subject/body) onto the
  // MATCHING stored proposal (by index), persist them, THEN execute the stored
  // copy. The tool/target can never be swapped from the body — only content fields
  // of the already-proposed action, and the persisted payload is what executes.
  const edits = body.edits && typeof body.edits === 'object' ? body.edits : null;
  if (edits && decision === 'approve') {
    const ALLOWED = new Set(['to', 'subject', 'body']);
    proposals = proposals.map((p, i) => {
      const e = (edits as any)[String(i)] ?? (edits as any)[i];
      if (!e || typeof e !== 'object') return p;
      const patch: Record<string, string> = {};
      for (const k of Object.keys(e)) if (ALLOWED.has(k) && typeof e[k] === 'string') patch[k] = e[k];
      return Object.keys(patch).length ? { ...p, input: { ...p.input, ...patch } } : p;
    });
    await supabaseAdmin.from('janet_pending_approvals').update({ proposals }).eq('id', approvalId);
  }

  const resolvePending = async () => {
    await supabaseAdmin
      .from('janet_pending_approvals')
      .update({ status: decision === 'reject' ? 'rejected' : 'approved', resolved_at: new Date().toISOString(), resolved_by: locals.adminEmail })
      .eq('id', approvalId);
  };

  // Thread the approval id so the send executor can bind execution to it.
  const ctx: JanetContext = { pageContext: null, approvalRef: approvalId };

  if (decision === 'reject') {
    for (const p of proposals) {
      await logJanetAction({
        tool_name: p.tool,
        ring: 3,
        input: p.input,
        approved_by_user: false,
        status: 'rejected',
        output_summary: 'Blue rejected the proposed action.',
      });
    }
    await resolvePending();
    await note(`Rejected: ${proposals.map((p) => p.tool).join(', ')}.`, threadId);
    return json({ ok: true, decision, outcomes: proposals.map((p) => ({ tool: p.tool, ok: false, summary: 'rejected' })) });
  }

  // Approve — execute each proposal with explicit approval.
  const outcomes: { tool: string; ok: boolean; summary: string }[] = [];
  for (const p of proposals) {
    const result = await executeJanetTool(p.tool, p.input, ctx, { approvedByUser: true });
    outcomes.push({
      tool: p.tool,
      ok: result.ok,
      summary: result.ok ? summarize(result.result) : result.error,
    });
  }

  await resolvePending();
  const okCount = outcomes.filter((o) => o.ok).length;
  await note(
    okCount === outcomes.length
      ? `Executed: ${outcomes.map((o) => o.summary).join('; ')}.`
      : `Executed ${okCount}/${outcomes.length}. ${outcomes.map((o) => `${o.tool}: ${o.ok ? 'ok' : o.summary}`).join('; ')}`,
    threadId
  );

  return json({ ok: true, decision, outcomes });
};

/** Write a short assistant note to the originating thread so history reflects
 *  the decision (thread-scoped since Feature 1 — a null thread_id would vanish). */
async function note(text: string, threadId: string | null): Promise<void> {
  await supabaseAdmin.from('janet_messages').insert({
    role: 'assistant',
    content: [{ type: 'text', text }],
    page_context: null,
    thread_id: threadId,
  });
}

function summarize(result: unknown): string {
  if (result == null) return 'done';
  if (typeof result === 'object' && result !== null) {
    const r = result as any;
    if (r.sent) return `Sent to ${r.to}`;
    if (r.published && r.url) return `Published — the page is now LIVE at ${r.url} (already done; do not publish it again)`;
    if (r.url && r.id) return `Done — ${r.url}`;
  }
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
