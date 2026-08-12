import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { resend } from '../../../../../lib/resend';
import { sendVerified } from '../../../../../lib/janet/executor';
import { getPageForDoc, getRecipientLinks } from '../../../../../lib/janet/publish';

/**
 * Send a reviewed proposal to its deal contact, from the admin preview page.
 * Blue clicking Send in his authenticated admin panel IS the approval (same pattern
 * as the Clear Ear invoice send), so it carries a manual approval ref through the ONE
 * gated send path — idempotent, ledgered, read-back.
 *
 * GET  → what would be sent (recipient, subject, body, blockers) for the confirm modal.
 * POST → actually send, then advance the deal to proposal_sent (a REAL send).
 */
export const prerender = false;

const FROM = 'Blue <hello@blvstack.com>';
const SITE = 'https://blvstack.com';

async function build(docId: string) {
  const { data: doc } = await supabaseAdmin.from('janet_docs').select('id, title, deal_id, doc_type').eq('id', docId).maybeSingle();
  if (!doc) return { error: 'Doc not found.' };

  const blockers: string[] = [];
  let deal: any = null;
  if (!doc.deal_id) blockers.push('This proposal is not attached to a deal, so there is no contact to send it to. Attach it to a deal first.');
  else {
    const { data: d } = await supabaseAdmin.from('janet_deals').select('id, name, stage, contact_name, contact_email').eq('id', doc.deal_id).maybeSingle();
    deal = d ?? null;
    if (!deal) blockers.push('The attached deal no longer exists.');
    else if (!deal.contact_email) blockers.push(`The deal "${deal.name}" has no contact email. Add one on the deal first.`);
  }

  const page = await getPageForDoc(docId);
  if (!page || !page.published) blockers.push('This proposal is not published yet, so there is no link to send. Publish it first (JANET: publish_page), then send.');

  // Prefer a tokened per-recipient link so opens are attributed to this recipient.
  let url = page?.slug ? `${SITE}/${page.slug}` : '';
  if (page?.id && url) {
    const links = await getRecipientLinks(page.id);
    if (links.length) url = `${url}?v=${links[0].token}`;
  }

  const first = (deal?.contact_name ?? '').trim().split(/\s+/)[0] || 'there';
  const subject = `${doc.title}`;
  const body = [
    `Hi ${first},`,
    '',
    `Here's the proposal:`,
    url,
    '',
    `Look it over and let me know if you have questions or want to talk through anything.`,
    '',
    `Blue`,
  ].join('\n');

  return { doc, deal, page, url, subject, body, blockers };
}

export const GET: APIRoute = async ({ params, locals }) => {
  if (!(locals as any).adminEmail) return json({ error: 'Unauthorized' }, 401);
  const built = await build(params.id!);
  if ((built as any).error) return json(built, 404);
  const { doc, deal, url, subject, body, blockers } = built as any;
  return json({
    ok: true,
    doc: { id: doc.id, title: doc.title },
    deal: deal ? { id: deal.id, name: deal.name, stage: deal.stage, contact_name: deal.contact_name, contact_email: deal.contact_email } : null,
    url, subject, body, blockers,
  });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const admin = (locals as any).adminEmail;
  if (!admin) return json({ error: 'Unauthorized' }, 401);

  const built = await build(params.id!);
  if ((built as any).error) return json(built, 404);
  const { doc, deal, blockers } = built as any;
  if (blockers.length) return json({ error: blockers[0], blockers }, 400);

  let b: any = {};
  try { b = await request.json(); } catch { /* body optional — fall back to the built draft */ }
  const subject = (b.subject ?? (built as any).subject).toString().trim();
  const body = (b.body ?? (built as any).body).toString().trim();
  if (!subject || !body) return json({ error: 'Subject and body are required.' }, 400);

  const res = await sendVerified({
    actionType: 'send_proposal',
    lane: 'manual',
    // Blue clicking Send in the authenticated admin panel IS the approval.
    approvalRef: `manual:${admin}:proposal:${doc.id}`,
    // Day-scoped: a double-click (or refresh) can't send twice, but a genuine
    // re-send after revisions on another day is still allowed.
    idempotencyKey: `send_proposal:${doc.id}:${deal.contact_email}:${new Date().toISOString().slice(0, 10)}`,
    message: { client: resend, from: FROM, to: deal.contact_email, replyTo: 'blue@blvstack.com', subject, text: body },
    log: { type: 'general', source: 'manual', to: deal.contact_email, toName: deal.contact_name ?? null, fromEmail: 'blue@blvstack.com', actor: admin, subject, body, dealId: deal.id },
  });
  if (!res.ok) return json({ error: res.error ?? 'Send failed.' }, 400);

  // A real send advances the deal — the stage now reflects a send that actually happened.
  if (['inquiry', 'discovery_scheduled', 'discovery_done'].includes(deal.stage)) {
    await supabaseAdmin.from('janet_deals')
      .update({ stage: 'proposal_sent', next_action: `Follow up with ${deal.contact_name ?? 'the client'} on the proposal`, updated_at: new Date().toISOString() })
      .eq('id', deal.id);
  }

  return json({ ok: true, sent: true, dedup: res.dedup === true, to: deal.contact_email, message_id: res.id });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
