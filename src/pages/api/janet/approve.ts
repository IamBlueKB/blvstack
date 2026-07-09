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
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);

  let body: { proposals?: { tool: string; input: unknown }[]; decision?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const proposals = Array.isArray(body.proposals) ? body.proposals : [];
  const decision = body.decision === 'reject' ? 'reject' : 'approve';
  if (proposals.length === 0) return json({ error: 'No proposals to act on' }, 400);

  const ctx: JanetContext = { pageContext: null };

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
    await note(`Rejected: ${proposals.map((p) => p.tool).join(', ')}.`);
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

  const okCount = outcomes.filter((o) => o.ok).length;
  await note(
    okCount === outcomes.length
      ? `Executed: ${outcomes.map((o) => o.summary).join('; ')}.`
      : `Executed ${okCount}/${outcomes.length}. ${outcomes.map((o) => `${o.tool}: ${o.ok ? 'ok' : o.summary}`).join('; ')}`
  );

  return json({ ok: true, decision, outcomes });
};

/** Write a short assistant note to the thread so history reflects the decision. */
async function note(text: string): Promise<void> {
  await supabaseAdmin.from('janet_messages').insert({
    role: 'assistant',
    content: [{ type: 'text', text }],
    page_context: null,
  });
}

function summarize(result: unknown): string {
  if (result == null) return 'done';
  if (typeof result === 'object' && result !== null) {
    const r = result as any;
    if (r.sent) return `Sent to ${r.to}`;
  }
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
