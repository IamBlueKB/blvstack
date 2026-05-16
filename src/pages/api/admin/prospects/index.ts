import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

/** GET — list all prospects */
export const GET: APIRoute = async ({ url }) => {
  const status = url.searchParams.get('status');

  let query = supabaseAdmin
    .from('prospects')
    .select('*')
    .order('created_at', { ascending: false });

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) return j({ error: error.message }, 500);
  return j({ prospects: data ?? [] });
};

/** POST — add prospects (from scraped URLs or manual entry) */
export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  // Accept single prospect or array
  const prospects: any[] = Array.isArray(body) ? body : [body];

  const rows = prospects.map((p) => ({
    source_url: p.source_url ?? null,
    company_name: p.company_name ?? null,
    company_url: p.company_url ?? null,
    contact_name: p.contact_name ?? null,
    contact_email: p.contact_email ?? null,
    pain_points: p.pain_points ?? null,
    notes: p.context ?? p.notes ?? null,
    status: 'new',
  }));

  // Check suppression list
  const emails = rows.map((r) => r.contact_email).filter(Boolean);
  let suppressed = new Set<string>();
  if (emails.length > 0) {
    const { data: suppressedRows } = await supabaseAdmin
      .from('suppression_list')
      .select('email')
      .in('email', emails);
    suppressed = new Set((suppressedRows ?? []).map((r: any) => r.email));
  }

  const validRows = rows.filter((r) => !r.contact_email || !suppressed.has(r.contact_email));
  const skipped = rows.length - validRows.length;

  if (validRows.length === 0) {
    return j({ ok: true, inserted: 0, skipped, message: 'All prospects were suppressed' });
  }

  const { data, error } = await supabaseAdmin
    .from('prospects')
    .insert(validRows)
    .select();

  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, inserted: data?.length ?? 0, skipped, prospects: data });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
