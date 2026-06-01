import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { rateLimit } from '../../../../lib/rate-limit';

export const prerender = false;

/**
 * POST /api/booker/intake/[token]
 * Public — validates token, updates artist row, sets intake_completed_at.
 * Rate-limited per IP.
 */
export const POST: APIRoute = async ({ params, request, clientAddress }) => {
  const { token } = params;
  if (!token) return j({ error: 'Missing token' }, 400);

  // Rate limit: 5 submissions per hour per IP
  const ip = clientAddress ?? 'unknown';
  const limit = rateLimit(`booker-intake:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) {
    return j({ error: 'Too many attempts. Try again later.' }, 429);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  // Verify token resolves to an artist
  const { data: artist } = await supabaseAdmin
    .from('booker_artists')
    .select('id, deleted_at')
    .eq('intake_token', token)
    .single();

  if (!artist || artist.deleted_at) {
    return j({ error: 'Invalid token' }, 404);
  }

  // Allowed fields from intake form
  const allowed = [
    'name', 'stage_name', 'email', 'phone', 'performer_type', 'genres',
    'city', 'region', 'travel_radius_mi', 'rate_floor', 'rate_notes',
    'gig_types', 'availability_notes', 'bio', 'press_kit_url', 'demo_url',
    'social_links', 'hard_nos',
  ];

  const update: Record<string, unknown> = {
    intake_completed_at: new Date().toISOString(),
    // Bump to onboarding once completed (unless already further along)
  };
  for (const k of allowed) {
    if (k in body) update[k] = body[k];
  }

  // Bump status if still prospect
  const { data: current } = await supabaseAdmin
    .from('booker_artists')
    .select('status')
    .eq('id', artist.id)
    .single();
  if (current?.status === 'prospect') {
    update.status = 'onboarding';
  }

  const { error } = await supabaseAdmin
    .from('booker_artists')
    .update(update)
    .eq('id', artist.id);

  if (error) return j({ error: error.message }, 500);

  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
