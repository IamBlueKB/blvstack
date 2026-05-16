import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { anthropic, MODEL, BLVSTACK_SYSTEM } from '../../../../../lib/anthropic';

export const prerender = false;

type LeadAnalysis = {
  fit: 'strong' | 'borderline' | 'pass';
  fit_reason: string;
  tier: 'L1' | 'L2' | 'L3' | 'unclear';
  tier_reason: string;
  scope_estimate: string;
  discovery_questions: string[];
  red_flags: string[];
  summary: string;
};

export const POST: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);

  const { data: lead, error: fetchErr } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !lead) return j({ error: 'Lead not found' }, 404);

  const userPrompt = `Lead to evaluate:

Name: ${lead.name ?? '—'}
Business: ${lead.business_name ?? '—'}
Website: ${lead.website_url ?? '—'}
Revenue range: ${lead.revenue_range ?? '—'}
Timeline: ${lead.timeline ?? '—'}
Budget: ${lead.budget_tier ?? '—'}
Source: ${lead.source ?? '—'}

Problem (in their own words):
${lead.problem ?? '—'}

Evaluate and respond with JSON only.`;

  let analysis: LeadAnalysis;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: BLVSTACK_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = resp.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    // Strip markdown fences if model wrapped them
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
    analysis = JSON.parse(cleaned);
  } catch (err: any) {
    console.error('[analyze] anthropic error', err);
    return j({ error: 'Analysis failed', detail: err?.message ?? 'unknown' }, 500);
  }

  const { error: saveErr } = await supabaseAdmin
    .from('leads')
    .update({
      ai_analysis: analysis,
      ai_analyzed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (saveErr) return j({ error: saveErr.message }, 500);

  return j({ ok: true, analysis });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
