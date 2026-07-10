import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

/**
 * GET  /api/janet/briefing — latest briefing + unread flag (spec §8).
 * POST /api/janet/briefing — mark the latest briefing read.
 * Auth: founder session (middleware) + belt-and-suspenders check.
 */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.adminEmail) return j({ error: 'Unauthorized' }, 401);
  const { data, error } = await supabaseAdmin
    .from('janet_briefings')
    .select('id, briefing_date, content, read_at, created_at')
    .order('briefing_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return j({ error: error.message }, 500);
  if (!data) return j({ briefing: null, unread: false });
  return j({ briefing: { id: data.id, date: data.briefing_date, content: data.content }, unread: data.read_at == null });
};

export const POST: APIRoute = async ({ locals }) => {
  if (!locals.adminEmail) return j({ error: 'Unauthorized' }, 401);
  const { data: latest } = await supabaseAdmin
    .from('janet_briefings')
    .select('id')
    .order('briefing_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) await supabaseAdmin.from('janet_briefings').update({ read_at: new Date().toISOString() }).eq('id', latest.id);
  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
