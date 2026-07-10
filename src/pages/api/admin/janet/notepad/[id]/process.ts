import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { extractFields, buildRecap, type PendingFields } from '../../../../../../lib/janet/notepad';

export const prerender = false;

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const STAGES = ['inquiry', 'discovery_scheduled', 'discovery_done', 'proposal_sent', 'negotiating', 'won', 'building', 'delivered', 'lost'];

function callBlock(recap: string, notes: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const body = [recap && `${recap}`, notes && `Raw notes:\n${notes}`].filter(Boolean).join('\n\n');
  return `--- Discovery call · ${date} ---\n${body}`;
}

/** POST /api/admin/janet/notepad/:id/process
 *  Two phases (spec: confirmation step BEFORE anything is written):
 *   - prepare (default): extract fields + generate the "here's what I heard"
 *     recap. Writes NOTHING to the deal — returns them for Blue to correct.
 *   - commit ({ commit: true, fields, recap }): write the confirmed fields to the
 *     deal (creating it if this was a standalone session), set the next action,
 *     persist the notes, mark the session processed. */
export const POST: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return j({ error: 'id required' }, 400);
  let b: any = {};
  try {
    b = await request.json();
  } catch {
    /* prepare with no body is fine */
  }

  const { data: session, error } = await supabaseAdmin
    .from('janet_notepad_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return j({ error: error.message }, 500);
  if (!session) return j({ error: 'not found' }, 404);

  let deal: any = null;
  if (session.deal_id) {
    const { data } = await supabaseAdmin.from('janet_deals').select('*').eq('id', session.deal_id).maybeSingle();
    deal = data;
  }

  const notes: string = session.notes ?? '';
  const coverage: any[] = Array.isArray(session.coverage) ? session.coverage : [];

  // ── PREPARE ──────────────────────────────────────────────────────────
  if (!b?.commit) {
    if (!notes.trim()) return j({ error: 'Nothing to process — the notes are empty.' }, 400);
    let fields: PendingFields = {};
    let recap = { recap: '', next_action: null as string | null, next_action_due: null as string | null };
    try {
      fields = await extractFields(notes, deal, coverage);
      recap = await buildRecap(notes, fields, deal, coverage);
    } catch (e) {
      return j({ error: 'processing failed: ' + (e as Error).message }, 502);
    }
    const merged: PendingFields = {
      ...fields,
      next_action: recap.next_action ?? fields.next_action ?? null,
      next_action_due: recap.next_action_due ?? fields.next_action_due ?? null,
    };
    await supabaseAdmin
      .from('janet_notepad_sessions')
      .update({ pending_fields: merged, recap: recap.recap, updated_at: new Date().toISOString() })
      .eq('id', id);
    return j({ phase: 'prepare', pending_fields: merged, recap: recap.recap });
  }

  // ── COMMIT ───────────────────────────────────────────────────────────
  const f: PendingFields = b.fields ?? session.pending_fields ?? {};
  const recapText: string = typeof b.recap === 'string' ? b.recap : session.recap ?? '';
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (v === '' || v == null ? null : Number(v));

  let resultDeal: any;
  let created = false;

  if (deal) {
    // Update existing deal — only fields the confirmation actually carried.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (f.contact_name !== undefined) patch.contact_name = str(f.contact_name);
    if (f.contact_email !== undefined) patch.contact_email = str(f.contact_email);
    if (f.value_estimate !== undefined && f.value_estimate !== null) patch.value_estimate = num(f.value_estimate);
    if (f.next_action !== undefined) patch.next_action = str(f.next_action);
    if (f.next_action_due !== undefined) patch.next_action_due = str(f.next_action_due);
    if (f.stage && STAGES.includes(f.stage)) patch.stage = f.stage;
    else if (deal.stage === 'inquiry' || deal.stage === 'discovery_scheduled') patch.stage = 'discovery_done';
    patch.notes = [str(deal.notes), callBlock(recapText, notes)].filter(Boolean).join('\n\n');
    const { data, error: uErr } = await supabaseAdmin.from('janet_deals').update(patch).eq('id', deal.id).select().single();
    if (uErr) return j({ error: uErr.message }, 500);
    resultDeal = data;
  } else {
    // Standalone → create the deal from what the call surfaced.
    const row: Record<string, unknown> = {
      name: session.title || str(f.contact_name) || 'Untitled opportunity',
      contact_name: str(f.contact_name),
      contact_email: str(f.contact_email),
      source: session.context ? 'network' : null,
      stage: f.stage && STAGES.includes(f.stage) ? f.stage : 'discovery_done',
      value_estimate: num(f.value_estimate),
      next_action: str(f.next_action),
      next_action_due: str(f.next_action_due),
      notes: callBlock(recapText, notes),
    };
    const { data, error: cErr } = await supabaseAdmin.from('janet_deals').insert(row).select().single();
    if (cErr) return j({ error: cErr.message }, 500);
    resultDeal = data;
    created = true;
  }

  await supabaseAdmin
    .from('janet_notepad_sessions')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      deal_id: resultDeal.id,
      pending_fields: f,
      recap: recapText,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  return j({ phase: 'commit', deal: resultDeal, created, recap: recapText });
};
