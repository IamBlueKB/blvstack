import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { extractFields } from '../../../../../../lib/janet/notepad';

export const prerender = false;

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** POST /api/admin/janet/notepad/:id/structure — quiet background structuring.
 *  Reads the current notes, extracts deal fields into a PENDING draft (never
 *  writes to the live deal). Called debounced as Blue types. */
export const POST: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return j({ error: 'id required' }, 400);

  // Allow the caller to pass the freshest notes + coverage (before autosave lands).
  let notesOverride: string | null = null;
  let coverageOverride: any[] | null = null;
  try {
    const b = await request.json();
    if (typeof b?.notes === 'string') notesOverride = b.notes;
    if (Array.isArray(b?.coverage)) coverageOverride = b.coverage;
  } catch {
    /* body optional */
  }

  const { data: session, error } = await supabaseAdmin
    .from('janet_notepad_sessions')
    .select('id, notes, deal_id, coverage')
    .eq('id', id)
    .maybeSingle();
  if (error) return j({ error: error.message }, 500);
  if (!session) return j({ error: 'not found' }, 404);

  const notes = notesOverride ?? session.notes ?? '';
  const coverage = coverageOverride ?? session.coverage ?? [];
  if (!notes.trim()) return j({ pending_fields: {} });

  let deal: any = null;
  if (session.deal_id) {
    const { data } = await supabaseAdmin.from('janet_deals').select('id, name, stage').eq('id', session.deal_id).maybeSingle();
    deal = data;
  }

  let pending: any = {};
  try {
    pending = await extractFields(notes, deal, coverage);
  } catch (e) {
    return j({ error: 'extraction failed: ' + (e as Error).message }, 502);
  }

  await supabaseAdmin
    .from('janet_notepad_sessions')
    .update({ pending_fields: pending, updated_at: new Date().toISOString() })
    .eq('id', id);

  return j({ pending_fields: pending });
};
