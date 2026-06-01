import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, stripMoney } from '../../../../../lib/booker/access';

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireActor(locals);
  const status = url.searchParams.get('status');
  const vertical = url.searchParams.get('vertical');
  let query = supabaseAdmin
    .from('booker_gigs')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (status && status !== 'all') query = query.eq('status', status);
  if (vertical && vertical !== 'all') query = query.eq('vertical', vertical);
  const { data, error } = await query;
  if (error) return j({ error: error.message }, 500);
  return j({ gigs: stripMoney(actor, data ?? []) });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
