import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { buildPreppedQuestions, type DealType } from '../../../../../lib/janet/notepad';

export const prerender = false;

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const DEAL_TYPES = ['refresh', 'new_build', 'rescue'];

/** GET /api/admin/janet/notepad — recent notepad sessions (for the "recent" rail). */
export const GET: APIRoute = async () => {
  const { data, error } = await supabaseAdmin
    .from('janet_notepad_sessions')
    .select('id, deal_id, title, deal_type, status, created_at, processed_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return j({ error: error.message }, 500);
  return j({ sessions: data ?? [] });
};

/** POST /api/admin/janet/notepad — open a capture session.
 *  Prospect-opened (deal_id) OR standalone (context, or nothing). Generates the
 *  layered prepped-question set (prospect-specific + deal-type + standard). */
export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try {
    b = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const dealId: string | null = typeof b?.deal_id === 'string' && b.deal_id ? b.deal_id : null;
  const context: string | null = typeof b?.context === 'string' && b.context.trim() ? b.context.trim() : null;
  const dealType: DealType = DEAL_TYPES.includes(b?.deal_type) ? b.deal_type : null;

  let deal: any = null;
  let latestFindings: any[] = [];
  if (dealId) {
    const { data } = await supabaseAdmin.from('janet_deals').select('*').eq('id', dealId).maybeSingle();
    deal = data;
    if (deal?.site_id) {
      const { data: scan } = await supabaseAdmin
        .from('janet_site_scans')
        .select('results')
        .eq('site_id', deal.site_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      latestFindings = scan?.results?.audit?.findings ?? [];
    }
  }

  const title: string | null =
    (typeof b?.title === 'string' && b.title.trim() ? b.title.trim() : null) ?? deal?.name ?? null;

  const prepped = await buildPreppedQuestions({ deal, context, dealType, latestFindings });

  const { data, error } = await supabaseAdmin
    .from('janet_notepad_sessions')
    .insert({
      deal_id: dealId,
      title,
      context,
      deal_type: dealType,
      prepped_questions: prepped,
    })
    .select()
    .single();
  if (error) return j({ error: error.message }, 500);
  return j({ session: data });
};
