import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { recomputeInvoice, recordPayment, getInvoice } from '../../../../../lib/janet/clearear/invoicing';
import { markInvoiceSentExternally, reverseInvoiceMarkSent } from '../../../../../lib/janet/clearear/mark-sent';
import { deleteInvoice } from '../../../../../lib/janet/clearear/reversal';

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
      case 'edit_line': {
        // Change an existing line in place (description / qty / unit price), then
        // recompute. Amount is derived from qty × unit price unless given outright.
        if (!b.line_id) return json({ error: 'line_id required' }, 400);
        const { data: line } = await supabaseAdmin.from('clearear_invoice_lines').select('id, quantity, unit_price, amount').eq('id', b.line_id).eq('invoice_id', id).maybeSingle();
        if (!line) return json({ error: 'Line not found on this invoice' }, 404);
        const patch: Record<string, unknown> = {};
        if (b.description !== undefined) {
          if (!String(b.description).trim()) return json({ error: 'A line needs a description' }, 400);
          patch.description = String(b.description).trim();
        }
        if (b.service_label !== undefined) patch.service_label = b.service_label || null;
        const qty = b.quantity !== undefined && b.quantity !== '' ? num(b.quantity) : num(line.quantity);
        const unit = b.unit_price !== undefined && b.unit_price !== '' ? num(b.unit_price) : num(line.unit_price);
        if (b.quantity !== undefined) patch.quantity = qty;
        if (b.unit_price !== undefined) patch.unit_price = round2(unit);
        if (b.amount !== undefined && b.amount !== '') patch.amount = round2(num(b.amount));
        else if (b.quantity !== undefined || b.unit_price !== undefined) patch.amount = round2(qty * unit);
        if (Object.keys(patch).length) await supabaseAdmin.from('clearear_invoice_lines').update(patch).eq('id', b.line_id);
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
      case 'delete': {
        // Draft (never sent, unpaid) or an already-voided invoice. Live invoices
        // refuse — void first so money that moved keeps its trail.
        const res = await deleteInvoice(id, locals.adminEmail || 'blue');
        return json({ ok: true, ...res });
      }
      case 'void': {
        await supabaseAdmin.from('clearear_invoices').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', id);
        return json({ ok: true, ...((await getInvoice(id)) as object) });
      }
      case 'mark_sent': {
        // Blue sent this invoice himself (Gmail / text / in person). Flip it to
        // 'sent' with an external-action provenance row; do NOT re-email it.
        if (!b.channel) return json({ error: 'channel is required (email | text | in_person | personal_email)' }, 400);
        const res = await markInvoiceSentExternally({ invoiceId: id, channel: String(b.channel), note: b.note ?? null, actor: locals.adminEmail || 'blue' });
        return json({ ok: true, mark_sent: res, ...((await getInvoice(id)) as object) });
      }
      case 'unmark_sent': {
        // Reverse an external mark_sent: sent -> draft, retract the provenance row.
        const res = await reverseInvoiceMarkSent({ invoiceId: id, reason: String(b.reason ?? ''), actor: locals.adminEmail || 'blue' });
        return json({ ok: true, unmark_sent: res, ...((await getInvoice(id)) as object) });
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
