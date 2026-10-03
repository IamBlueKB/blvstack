import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { assertBusiness } from '../../../../lib/janet/clearear/expenses';

export const prerender = false;

/**
 * POST /api/admin/clearear/settings — update issuer details or a payment method.
 * Body: { section: 'issuer', business, ...fields } | { section: 'method', id, instructions?, active?, label? }.
 * Founder-gated. Issuer details + method instructions appear on invoices.
 * Issuer details are per business (clearear | blvstack); the EIN (tax_id) is entity-level —
 * one legal entity — so it lives in books_entity_settings, not the per-business row.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.adminEmail) return json({ error: 'Unauthorized' }, 401);
  let b: any;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    if (b.section === 'issuer') {
      const business = assertBusiness(b.business);
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { updated_at: now };
      for (const k of ['business_name', 'email', 'phone', 'default_terms', 'default_notes'] as const) {
        if (b[k] !== undefined) patch[k] = b[k] || null;
      }
      if (b.default_tax_rate !== undefined) patch.default_tax_rate = b.default_tax_rate === '' || b.default_tax_rate == null ? 0 : Number(b.default_tax_rate);
      if (b.address !== undefined) patch.address = b.address && typeof b.address === 'object' ? b.address : null;
      const { data, error } = await supabaseAdmin.from('clearear_settings').update(patch).eq('business', business).select().single();
      if (error) throw new Error(error.message);
      if (b.tax_id !== undefined) {
        const { error: eErr } = await supabaseAdmin.from('books_entity_settings').update({ tax_id: b.tax_id || null, updated_at: now }).eq('id', 1);
        if (eErr) throw new Error(eErr.message);
      }
      return json({ ok: true, settings: data });
    }
    if (b.section === 'method') {
      if (!b.id) return json({ error: 'method id required' }, 400);
      const patch: Record<string, unknown> = {};
      if (b.instructions !== undefined) patch.instructions = b.instructions || null;
      if (typeof b.active === 'boolean') patch.active = b.active;
      if (b.label !== undefined && b.label) patch.label = b.label;
      if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400);
      const { data, error } = await supabaseAdmin.from('clearear_payment_methods').update(patch).eq('id', b.id).select().single();
      if (error) throw new Error(error.message);
      return json({ ok: true, method: data });
    }
    return json({ error: "section must be 'issuer' or 'method'" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
