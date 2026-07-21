import type { APIRoute } from 'astro';
import { acceptProposal, rejectProposal } from '../../../lib/janet/dream/proposals';

export const prerender = false;

/**
 * POST /api/janet/dream-proposal — accept or reject one dream proposal.
 * Body: { proposal_id, decision: 'accept' | 'reject' }.
 * Accept runs the proposal's durable change through the single apply path
 * (executeProposalChange) — reversible internal state only. Founder-gated.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);

  let body: { proposal_id?: string; decision?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const id = typeof body.proposal_id === 'string' ? body.proposal_id : '';
  const decision = body.decision === 'reject' ? 'reject' : body.decision === 'accept' ? 'accept' : null;
  if (!id) return json({ error: 'proposal_id is required' }, 400);
  if (!decision) return json({ error: "decision must be 'accept' or 'reject'" }, 400);

  try {
    const result = decision === 'accept' ? await acceptProposal(id, locals.adminEmail) : await rejectProposal(id, locals.adminEmail);
    return json({ decision, ...result });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
