import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';
import { readAdminSession } from '../../../lib/admin-session';
import { resolveRecipientToken } from '../../../lib/janet/publish';

export const prerender = false;

/**
 * POST /api/p/view — public view-tracking ingest for published pages.
 * Two shapes:
 *   { page_id, token? }                      → record an open, returns { view_id }
 *   { view_id, page_id, duration, sections } → update that view on unload
 *
 * Attribution (never false certainty):
 *  - Authenticated admin (you, proofing) → viewer_type 'owner', never reported.
 *  - ?v=token present + valid → viewer_type 'recipient', linked to that person.
 *  - session cookie (blv_sid) groups repeat opens from one browser into a session.
 *  - IP + user-agent stored for grouping/device only.
 * Public route (visitors hit it); only ever writes to janet_page_views.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
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

  // Update shape — just record engagement on the existing view.
  if (body.view_id) {
    await supabaseAdmin
      .from('janet_page_views')
      .update({ duration_seconds: duration, section_engagement: sections })
      .eq('id', String(body.view_id))
      .eq('page_id', pageId);
    return json({ ok: true });
  }

  // ── Open: attribute this view. ──
  // 1. Owner? A valid admin session means Blue is proofing — never a client view.
  const isOwner = !!readAdminSession(cookies);

  // 2. Session id — a first-party cookie so repeat opens from one browser group.
  let sessionId = cookies.get('blv_sid')?.value ?? '';
  if (!sessionId) {
    sessionId = randomUUID();
    cookies.set('blv_sid', sessionId, { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 365 });
  }

  // 3. Recipient token (?v=) → attribute to that person (unless it's the owner).
  const token = typeof body.token === 'string' && body.token.trim() ? body.token.trim().slice(0, 64) : null;
  let recipientLinkId: string | null = null;
  if (token && !isOwner) {
    const link = await resolveRecipientToken(pageId, token);
    recipientLinkId = link?.id ?? null;
  }

  const viewerType = isOwner ? 'owner' : recipientLinkId ? 'recipient' : 'anonymous';
  const fwd = request.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0].trim() : request.headers.get('x-real-ip')) || null;

  const { data, error } = await supabaseAdmin
    .from('janet_page_views')
    .insert({
      page_id: pageId,
      duration_seconds: duration,
      section_engagement: sections,
      referrer: (body.referrer ? String(body.referrer) : request.headers.get('referer')) || null,
      user_agent: request.headers.get('user-agent'),
      viewer_type: viewerType,
      recipient_link_id: recipientLinkId,
      token,
      session_id: sessionId,
      ip,
    })
    .select('id')
    .single();
  if (error) return json({ ok: false }, 200);
  return json({ view_id: data.id });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
