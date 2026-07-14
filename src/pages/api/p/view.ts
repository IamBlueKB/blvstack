import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

/**
 * POST /api/p/view — public view-tracking ingest for published proposals.
 * Two shapes:
 *   { page_id }                              → record an open, returns { view_id }
 *   { view_id, page_id, duration, sections } → update that view on unload
 * Public (visitors hit it), so it only ever writes to janet_page_views for a
 * real published page, nothing else. 'p' is a reserved slug so this never
 * collides with a published page.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad body' }, 400);
  }
  const pageId = String(body.page_id ?? '');
  if (!pageId) return json({ error: 'missing page_id' }, 400);

  // Only accept views for a real, published page.
  const { data: page } = await supabaseAdmin.from('janet_published_pages').select('id, published').eq('id', pageId).maybeSingle();
  if (!page || !page.published) return json({ ok: false }, 200);

  const sections = body.sections && typeof body.sections === 'object' ? body.sections : null;
  const duration = Number.isFinite(body.duration) ? Math.max(0, Math.round(body.duration)) : null;

  if (body.view_id) {
    await supabaseAdmin
      .from('janet_page_views')
      .update({ duration_seconds: duration, section_engagement: sections })
      .eq('id', String(body.view_id))
      .eq('page_id', pageId);
    return json({ ok: true });
  }

  const { data, error } = await supabaseAdmin
    .from('janet_page_views')
    .insert({
      page_id: pageId,
      duration_seconds: duration,
      section_engagement: sections,
      referrer: (body.referrer ? String(body.referrer) : request.headers.get('referer')) || null,
      user_agent: request.headers.get('user-agent'),
    })
    .select('id')
    .single();
  if (error) return json({ ok: false }, 200);
  return json({ view_id: data.id });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
