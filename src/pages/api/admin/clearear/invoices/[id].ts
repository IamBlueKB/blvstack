import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { recomputeInvoice, recordPayment, getInvoice } from '../../../../../lib/janet/clearear/invoicing';

export const prerender = false;

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

/**
 * POST /api/admin/clearear/invoices/[id] — act on one invoice, then recompute.
 * Body: { action, ... }:
 *   'update'        { due_date?, tax_rate?, notes?, payment_methods? }
 *   'add_line'      { description, service_label?, quantity?, unit_price?, amount? }
 *   'delete_line'   { line_id }
 *   'record_payment'{ amount, method, paid_at?, reference?, is_deposit?, notes? }
 *   'void'          -> status void
 * Returns the refreshed full invoice.
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  const id = params.id;
  if (!id) return json({ error: 'Missing invoice id' }, 400);

  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { data: inv } = await supabaseAdmin.from('clearear_invoices').select('id, status').eq('id', id).maybeSingle();
  if (!inv) return json({ error: 'Invoice not found' }, 404);

  try {
    switch (b.action) {
      case 'update': {
        const patch: Record<string, unknown> = {};
        if (b.due_date !== undefined) patch.due_date = b.due_date || null;
        if (b.tax_rate !== undefined) patch.tax_rate = b.tax_rate === '' || b.tax_rate == null ? 0 : Number(b.tax_rate);
        if (b.notes !== undefined) patch.notes = b.notes || null;
        if (Array.isArray(b.payment_methods)) patch.payment_methods = b.payment_methods;
        if (Object.keys(patch).length) await supabaseAdmin.from('clearear_invoices').update(patch).eq('id', id);
        break;
      }
      case 'add_line': {
        if (!b.description) return json({ error: 'A line needs a description' }, 400);
        const qty = b.quantity != null && b.quantity !== '' ? num(b.quantity) : 1;
        const unit = b.unit_price != null && b.unit_price !== '' ? num(b.unit_price) : undefined;
        let amount = b.amount != null && b.amount !== '' ? num(b.amount) : undefined;
        if (amount == null) {
          if (unit == null) return json({ error: 'Give an amount, or a unit price (times quantity).' }, 400);
          amount = round2(qty * unit);
        }
        const { data: maxRow } = await supabaseAdmin.from('clearear_invoice_lines').select('sort_order').eq('invoice_id', id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
        await supabaseAdmin.from('clearear_invoice_lines').insert({ invoice_id: id, description: String(b.description), service_label: b.service_label || null, quantity: qty, unit_price: round2(unit ?? amount), amount: round2(amount), sort_order: (maxRow?.sort_order ?? -1) + 1 });
        break;
      }
      case 'delete_line': {
        if (!b.line_id) return json({ error: 'line_id required' }, 400);
        // If the line came from a session, free that session back up.
        const { data: line } = await supabaseAdmin.from('clearear_invoice_lines').select('session_id').eq('id', b.line_id).eq('invoice_id', id).maybeSingle();
        if (line?.session_id) await supabaseAdmin.from('clearear_sessions').update({ invoice_id: null }).eq('id', line.session_id);
        await supabaseAdmin.from('clearear_invoice_lines').delete().eq('id', b.line_id).eq('invoice_id', id);
        break;
      }
      case 'record_payment': {
        const res = await recordPayment({ invoice_id: id, amount: num(b.amount), method: b.method, paid_at: b.paid_at || undefined, reference: b.reference || null, is_deposit: b.is_deposit === true, notes: b.notes || null, recorded_by: 'blue' });
        return json({ ok: true, ...((await getInvoice(id)) as object), payment: res.payment });
      }
      case 'void': {
        await supabaseAdmin.from('clearear_invoices').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', id);
        return json({ ok: true, ...((await getInvoice(id)) as object) });
      }
      default:
        return json({ error: `Unknown action: ${b.action}` }, 400);
    }

    await recomputeInvoice(id);
    return json({ ok: true, ...((await getInvoice(id)) as object) });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
