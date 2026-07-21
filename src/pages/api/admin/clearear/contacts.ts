import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { createContact, CLEAREAR_KINDS } from '../../../../lib/janet/clearear/records';

export const prerender = false;

/**
 * POST /api/admin/clearear/contacts — create a contact, or update one with `id`.
 * Body: { id?, name?, kind?, contact_person?, email?, phone?, socials?, address?, notes?, status? }.
 * Founder-gated.
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
    // Hard delete — only when the contact has no financial history, else refuse
    // (archive instead, so invoices/payments are never orphaned).
    if (b.action === 'delete') {
      if (!b.id) return json({ error: 'id required' }, 400);
      const [s, i, p] = await Promise.all([
        supabaseAdmin.from('clearear_sessions').select('id', { count: 'exact', head: true }).eq('contact_id', b.id),
        supabaseAdmin.from('clearear_invoices').select('id', { count: 'exact', head: true }).eq('contact_id', b.id),
        supabaseAdmin.from('clearear_payments').select('id', { count: 'exact', head: true }).eq('contact_id', b.id),
      ]);
      const sc = s.count ?? 0, ic = i.count ?? 0, pc = p.count ?? 0;
      if (sc + ic + pc > 0) {
        const parts = [sc && `${sc} session(s)`, ic && `${ic} invoice(s)`, pc && `${pc} payment(s)`].filter(Boolean).join(', ');
        return json({ error: `This contact has ${parts} — archive them instead of deleting, so the records stay intact.`, has_history: true }, 409);
      }
      const { error } = await supabaseAdmin.from('clearear_contacts').delete().eq('id', b.id);
      if (error) throw new Error(error.message);
      return json({ ok: true, deleted: true });
    }

    // Update an existing contact.
    if (typeof b.id === 'string' && b.id) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ['name', 'contact_person', 'email', 'phone', 'notes'] as const) if (b[k] !== undefined) patch[k] = b[k] || null;
      if (b.kind && CLEAREAR_KINDS.includes(b.kind)) patch.kind = b.kind;
      if (b.status === 'active' || b.status === 'archived') patch.status = b.status;
      if (b.socials !== undefined) patch.socials = b.socials && typeof b.socials === 'object' ? b.socials : null;
      if (b.address !== undefined) patch.address = b.address && typeof b.address === 'object' ? b.address : null;
      if (!patch.name && Object.keys(patch).length === 1) return json({ error: 'Nothing to update' }, 400);
      const { data, error } = await supabaseAdmin.from('clearear_contacts').update(patch).eq('id', b.id).select().single();
      if (error) throw new Error(error.message);
      return json({ ok: true, contact: data });
    }
    // Create.
    const contact = await createContact({ name: b.name, kind: b.kind, contact_person: b.contact_person, email: b.email, phone: b.phone, socials: b.socials, address: b.address, notes: b.notes });
    return json({ ok: true, contact });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
