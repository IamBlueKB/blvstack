import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { anthropic, MODEL } from '../../../../../lib/anthropic';

export const prerender = false;

const DRAFT_SYSTEM = `You are drafting a first-touch email reply from Blue, the founder of BLVSTACK, to an inbound lead who submitted a project inquiry.

BLVSTACK builds AI systems for businesses ready to operate at a higher standard. Direct, founder-to-founder voice. No corporate fluff. No emojis. No "I hope this finds you well." No fake urgency. Sign as "Blue".

Goal of the email: acknowledge the inquiry, demonstrate you read it, and propose a concrete next step (a short discovery call if the fit looks strong, or one clarifying question if borderline).

Constraints:
- 80-150 words max
- Reference at least one specific detail from their problem (shows you actually read it)
- One clear ask (call, clarifying question, or "send me X")
- Plain text — no HTML

Output ONLY the email body. No subject line, no preamble like "Here's a draft:". Just the email itself starting with the greeting.`;

export const POST: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', id).single();
  if (!lead) return j({ error: 'Lead not found' }, 404);

  const firstName = (lead.name ?? '').split(' ')[0] || 'there';
  const userPrompt = `Lead details:

Name: ${lead.name ?? '—'} (use first name: ${firstName})
Business: ${lead.business_name ?? '—'}
Revenue: ${lead.revenue_range ?? '—'}
Timeline: ${lead.timeline ?? '—'}
Budget: ${lead.budget_tier ?? '—'}

Their problem (their own words):
${lead.problem ?? '—'}

${lead.ai_analysis ? `\nPrior triage analysis:\n${JSON.stringify(lead.ai_analysis, null, 2)}\n` : ''}

Draft the reply email.`;

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: DRAFT_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const draft = resp.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    return j({ ok: true, draft });
  } catch (err: any) {
    console.error('[draft-reply] anthropic error', err);
    return j({ error: 'Draft failed', detail: err?.message ?? 'unknown' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
