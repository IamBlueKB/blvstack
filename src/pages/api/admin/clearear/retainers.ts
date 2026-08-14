import type { APIRoute } from 'astro';
import { createRetainer, setRetainerStatus } from '../../../../lib/janet/clearear/retainers';
import { assertBusiness } from '../../../../lib/janet/clearear/expenses';

// POST /api/admin/clearear/retainers — open a retainer, or change its status.
export const prerender = false;

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  if (!(locals as any).adminEmail) return json({ error: 'Unauthorized' }, 401);
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  try {
    if (b.action === 'set_status' && b.id) {
      const r = await setRetainerStatus(b.id, b.status, b.end_date || null);
      return json({ ok: true, retainer: r });
    }
    const r = await createRetainer({
      business: assertBusiness(b.business),
      contact_id: b.contact_id,
      monthly_rate: Number(b.monthly_rate),
      start_date: b.start_date,
      payment_methods: Array.isArray(b.payment_methods) ? b.payment_methods : [],
      notes: b.notes || null,
      actor: (locals as any).adminEmail,
    });
    return json({ ok: true, retainer: r });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};
