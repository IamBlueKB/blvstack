import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

/**
 * POST /api/admin/outbound/check-replies
 * Manual check — shows recent reply activity from webhook-detected replies.
 * Reply detection is now automatic via webhooks, but this provides a manual view.
 */
export const POST: APIRoute = async () => {
  // Count recent replies (last 24h)
  const since = new Date();
  since.setHours(since.getHours() - 24);

  const { data: recentReplies, count } = await supabaseAdmin
    .from('prospects')
    .select('id, company_name, contact_name, contact_email, replied_at, status', { count: 'exact' })
    .in('status', ['replied', 'suppressed'])
    .gte('replied_at', since.toISOString())
    .order('replied_at', { ascending: false });

  return j({
    ok: true,
    checked: 'webhook-based (automatic)',
    matched: count ?? 0,
    recent: recentReplies ?? [],
    message: count ? `${count} replies in last 24h` : 'No new replies in last 24h',
  });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
