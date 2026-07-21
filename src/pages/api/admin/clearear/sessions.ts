import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { recordSession } from '../../../../lib/janet/clearear/records';

export const prerender = false;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * POST /api/admin/clearear/sessions — log, edit, or delete a session.
 *   create: { contact_id, service_id?, service_label?, session_date?, hours?, rate?, amount?, notes? }
 *   edit:   { id, ...fields }          — uninvoiced only
 *   delete: { id, action:'delete' }    — uninvoiced only
 * Amount is required OR hours + rate (computed) — never invented. Founder-gated.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const numOrNull = (v: any) => (v === '' || v == null ? null : Number(v));

  // Edit / delete an existing session — blocked once it's on an invoice.
  if (b?.id) {
    try {
      const { data: sess } = await supabaseAdmin.from('clearear_sessions').select('id, invoice_id, hours, rate, amount').eq('id', b.id).maybeSingle();
      if (!sess) return json({ error: 'Session not found' }, 404);
      if (sess.invoice_id) return json({ error: "This session is on an invoice — remove the line from the invoice first to change or delete it." }, 409);

      if (b.action === 'delete') {
        const { error } = await supabaseAdmin.from('clearear_sessions').delete().eq('id', b.id);
        if (error) throw new Error(error.message);
        return json({ ok: true, deleted: true });
      }

      const patch: Record<string, unknown> = {};
      if (b.session_date) patch.session_date = b.session_date;
      if (b.service_id !== undefined) patch.service_id = b.service_id || null;
      if (b.service_label !== undefined) patch.service_label = b.service_label || null;
      if (b.notes !== undefined) patch.notes = b.notes || null;
      const hours = b.hours !== undefined ? numOrNull(b.hours) : Number(sess.hours) || null;
      const rateIn = b.rate !== undefined ? numOrNull(b.rate) : Number(sess.rate) || null;
      let amount = b.amount !== undefined && b.amount !== '' ? numOrNull(b.amount) : null;
      if (amount == null) {
        if (hours != null && rateIn != null) amount = round2(hours * rateIn);
        else amount = Number(sess.amount); // unchanged
      }
      let rate = rateIn;
      if (rate == null && hours != null && hours > 0 && amount != null) rate = round2(amount / hours);
      patch.hours = hours;
      patch.rate = rate;
      patch.amount = amount;
      if (b.hours !== undefined) patch.hours = hours;
      const { data, error } = await supabaseAdmin.from('clearear_sessions').update(patch).eq('id', b.id).select().single();
      if (error) throw new Error(error.message);
      return json({ ok: true, session: data });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  if (!b?.contact_id) return json({ error: 'contact_id is required' }, 400);

  try {
    const res = await recordSession({
      contact_id: b.contact_id,
      service_id: b.service_id || null,
      service_label: b.service_label || null,
      session_date: b.session_date || null,
      start_time: b.start_time || null,
      hours: numOrNull(b.hours),
      rate: numOrNull(b.rate),
      amount: numOrNull(b.amount),
      notes: b.notes || null,
    });
    return json({ ok: true, ...res });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
