import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { requireActor, requireRole } from '../../../../../lib/booker/access';

export const prerender = false;

/**
 * POST /api/admin/booker/gigs/clear
 * Bulk soft-delete scraped gigs. Manager+ only.
 *
 * Body: { mode: 'unmatched' | 'dead' | 'all' }
 *   - 'unmatched' (safest): only deletes gigs with NO match record. Preserves history.
 *   - 'dead':              only deletes gigs marked dead/expired/spam.
 *   - 'all':               deletes every non-deleted gig. Matches survive (FK ON DELETE CASCADE
 *                          would normally drop them — we soft-delete the gig instead so matches
 *                          keep their reference intact).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'manager');
  if (denied) return denied;

  let body: { mode?: string };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const mode = body.mode;
  if (!['unmatched', 'dead', 'all'].includes(mode ?? '')) {
    return j({ error: 'mode must be unmatched | dead | all' }, 400);
  }

  const nowIso = new Date().toISOString();

  if (mode === 'dead') {
    const { count, error } = await supabaseAdmin
      .from('booker_gigs')
      .update({ deleted_at: nowIso }, { count: 'exact' })
      .in('status', ['dead', 'expired'])
      .is('deleted_at', null);
    if (error) return j({ error: error.message }, 500);
    return j({ ok: true, deleted: count ?? 0, mode });
  }

  if (mode === 'unmatched') {
    // Find gigs with NO match
    const { data: matchedRows } = await supabaseAdmin
      .from('booker_matches')
      .select('gig_id')
      .not('gig_id', 'is', null);
    const matchedIds = new Set((matchedRows ?? []).map((r: any) => r.gig_id));

    const { data: candidates } = await supabaseAdmin
      .from('booker_gigs')
      .select('id')
      .is('deleted_at', null);
    const toDelete = (candidates ?? [])
      .map((g: any) => g.id)
      .filter((id: string) => !matchedIds.has(id));

    if (toDelete.length === 0) {
      return j({ ok: true, deleted: 0, mode });
    }
    const { error } = await supabaseAdmin
      .from('booker_gigs')
      .update({ deleted_at: nowIso })
      .in('id', toDelete);
    if (error) return j({ error: error.message }, 500);
    return j({ ok: true, deleted: toDelete.length, mode });
  }

  // mode === 'all'
  const { count, error } = await supabaseAdmin
    .from('booker_gigs')
    .update({ deleted_at: nowIso }, { count: 'exact' })
    .is('deleted_at', null);
  if (error) return j({ error: error.message }, 500);
  return j({ ok: true, deleted: count ?? 0, mode });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
