import type { APIRoute } from 'astro';
import { createInvoice } from '../../../../../lib/janet/clearear/invoicing';

export const prerender = false;

/**
 * POST /api/admin/clearear/invoices — create a DRAFT invoice.
 * Body: { contact_id, session_ids?, lines?, due_date?, tax_rate?, payment_methods?, notes? }.
 * Founder-gated. Returns the created invoice { invoice, lines, ... }.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!b?.contact_id) return json({ error: 'contact_id is required' }, 400);
  try {
    const inv = await createInvoice({
      contact_id: b.contact_id,
      session_ids: Array.isArray(b.session_ids) ? b.session_ids : undefined,
      lines: Array.isArray(b.lines) ? b.lines : undefined,
      due_date: b.due_date || null,
      tax_rate: b.tax_rate != null && b.tax_rate !== '' ? Number(b.tax_rate) : null,
      payment_methods: Array.isArray(b.payment_methods) ? b.payment_methods : undefined,
      notes: b.notes || null,
    });
    return json({ ok: true, ...(inv as object) });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
