import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

/**
 * JANET's model of Blue — inspect/correct surface (spec §3.5). Blue is her
 * guardrail: this endpoint is his own hand editing the model, so it writes the
 * tables directly rather than through Ring 2 tools.
 *   POST /api/janet/mind  { entity: 'pattern'|'graveyard', op, id, ... }
 * Auth: founder session (middleware).
 */

const clamp = (n: number) => Math.min(Math.max(n, 0.05), 0.99);
const PATTERN_DOMAINS = ['pricing', 'clients', 'product', 'risk', 'style', 'strategy', 'general'];
const GRAVE_CATS = ['business_model', 'product', 'channel', 'feature', 'pricing', 'client', 'other'];

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const id = typeof body?.id === 'string' ? body.id : null;
  if (!id) return json({ error: 'id is required' }, 400);
  const op = body?.op;

  if (body?.entity === 'pattern') {
    // Reinforce: confirm/contradict adjusts confidence + counters.
    if (op === 'reinforce') {
      const dir = body?.direction;
      if (dir !== 'confirmed' && dir !== 'contradicted') return json({ error: 'direction must be confirmed|contradicted' }, 400);
      const { data: cur, error: e0 } = await supabaseAdmin.from('janet_reasoning_patterns').select('*').eq('id', id).single();
      if (e0) return json({ error: e0.message }, 500);
      const c = typeof cur.confidence === 'number' ? cur.confidence : 0.5;
      const patch =
        dir === 'confirmed'
          ? { confidence: clamp(c + (1 - c) * 0.2), times_confirmed: (cur.times_confirmed ?? 0) + 1, updated_at: new Date().toISOString() }
          : { confidence: clamp(c * 0.6), times_contradicted: (cur.times_contradicted ?? 0) + 1, updated_at: new Date().toISOString() };
      const { data, error } = await supabaseAdmin.from('janet_reasoning_patterns').update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, pattern: data });
    }
    // Update / deactivate.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.pattern === 'string' && body.pattern.trim()) patch.pattern = body.pattern.trim();
    if (typeof body.evidence === 'string') patch.evidence = body.evidence;
    if (typeof body.domain === 'string' && PATTERN_DOMAINS.includes(body.domain)) patch.domain = body.domain;
    if (typeof body.confidence === 'number' && isFinite(body.confidence)) patch.confidence = clamp(body.confidence);
    if (typeof body.active === 'boolean') patch.active = body.active;
    if (Object.keys(patch).length === 1) return json({ error: 'Nothing to update' }, 400);
    const { data, error } = await supabaseAdmin.from('janet_reasoning_patterns').update(patch).eq('id', id).select().single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, pattern: data });
  }

  if (body?.entity === 'graveyard') {
    const patch: Record<string, unknown> = {};
    if (typeof body.idea === 'string' && body.idea.trim()) patch.idea = body.idea.trim();
    if (typeof body.why_killed === 'string') patch.why_killed = body.why_killed;
    if (typeof body.revisit_conditions === 'string') patch.revisit_conditions = body.revisit_conditions;
    if (typeof body.category === 'string' && GRAVE_CATS.includes(body.category)) patch.category = body.category;
    if (typeof body.active === 'boolean') patch.active = body.active;
    if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400);
    const { data, error } = await supabaseAdmin.from('janet_graveyard').update(patch).eq('id', id).select().single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, entry: data });
  }

  return json({ error: "entity must be 'pattern' or 'graveyard'" }, 400);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
