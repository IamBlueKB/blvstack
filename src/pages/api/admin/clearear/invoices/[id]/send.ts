import type { APIRoute } from 'astro';
import { sendInvoiceEmail } from '../../../../../../lib/janet/clearear/send';

export const prerender = false;

/** POST /api/admin/clearear/invoices/[id]/send — email the invoice to the contact.
 *  The founder's click IS the approval → routed through the gated send executor.
 *  Body: { note? }. Marks the invoice sent. */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const admin = locals.adminEmail;
  if (!admin) return json({ error: 'Unauthorized' }, 401);
  const id = params.id;
  if (!id) return json({ error: 'Missing invoice id' }, 400);

  let note: string | null = null;
  try {
    if (request.headers.get('content-type')?.includes('application/json')) note = (await request.json())?.note ?? null;
  } catch { /* no body is fine */ }

  try {
    const res = await sendInvoiceEmail({ invoiceId: id, approvalRef: `manual:${admin}:clearear_invoice:${id}`, actor: admin, note });
    return json({ ok: true, ...res });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
