// Billing activity — one place every card-plan event is recorded (shown on the client's account) and, for the ones
// Blue wants to hear about, emailed to him: a client signs up, a card is declined, a site pauses, a payment comes
// back after a decline (site restored), a plan ends on Stripe's side. Blue approved these emails 2026-10-03.

import { supabaseAdmin } from '../../supabase';
import { resend } from '../../resend';
import { sendVerified } from '../executor';

export type BillingEventKind =
  | 'signed_up' | 'charge_paid' | 'charge_failed' | 'card_updated'
  | 'site_paused' | 'site_restored' | 'plan_paused' | 'plan_resumed' | 'plan_ended';

const OWNER_APPROVAL = 'policy:owner-billing-notices@2026-10-03'; // Blue: "yes email me"
const env = (import.meta as any).env ?? {};
const OWNER = (env.OWNER_NOTIFY_EMAIL as string) || 'blue@blvstack.com';
const BASE = env.PUBLIC_SITE_URL || 'https://blvstack.com';
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Record an event once (ref = the real-world identity of the event, so webhook retries don't double it). */
export async function recordBillingEvent(e: {
  retainer_id: string | null; kind: BillingEventKind; detail?: string | null; amount?: number | null;
  ref?: string | null; site_id?: string | null; contact_id?: string | null;
}): Promise<boolean> {
  const { error } = await supabaseAdmin.from('billing_events').insert({
    retainer_id: e.retainer_id, kind: e.kind, detail: e.detail ?? null, amount: e.amount ?? null,
    ref: e.ref ?? null, site_id: e.site_id ?? null, contact_id: e.contact_id ?? null,
  });
  if (error && !/duplicate key|unique/i.test(error.message)) { console.error('[billing-events]', error.message); return false; }
  return !error; // false when it was already recorded
}

/** Email Blue about a billing event. Idempotent on `key`. */
export async function notifyOwner(key: string, subject: string, lines: string[], links: { label: string; url: string }[] = []) {
  const text = [...lines, '', ...links.map((l) => `${l.label}: ${l.url}`)].join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#161616;">
    ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
    ${links.length ? `<p>${links.map((l) => `<a href="${l.url}" style="color:#1d4ed8;">${esc(l.label)}</a>`).join(' &nbsp;·&nbsp; ')}</p>` : ''}
    <p style="color:#8a8a8a;font-size:12px;margin-top:18px;">BLVSTACK billing — automatic notice</p>
  </div>`;
  const res = await sendVerified({
    actionType: 'send_owner_billing_notice',
    lane: 'manual',
    approvalRef: OWNER_APPROVAL,
    idempotencyKey: `owner_notice:${key}`,
    message: { client: resend, from: 'BLVSTACK Billing <hello@blvstack.com>', to: OWNER, subject, text, html },
    log: { type: 'general', source: 'cron', to: OWNER, toName: 'Blue', fromEmail: 'hello@blvstack.com', actor: 'billing', subject, body: text },
  });
  if (!res.ok) console.error('[billing-events] owner notice failed:', res.error);
  return res.ok;
}

/** The context an owner notice needs: client name, plan, their linked sites, admin links. */
export async function planContext(retainerId: string) {
  const { data: ret } = await supabaseAdmin.from('clearear_retainers')
    .select('id, business, contact_id, monthly_rate, start_date, current_period_end, past_due_since, clearear_contacts(name)')
    .eq('id', retainerId).maybeSingle();
  if (!ret) return null;
  const { data: sites } = await supabaseAdmin.from('janet_sites').select('id, name, production_url, client_id, auto_suspend, suspend_grace_days').eq('billing_retainer_id', retainerId);
  const r = ret as any;
  const clientId = (sites ?? []).find((s: any) => s.client_id)?.client_id ?? null;
  return {
    ret: r,
    name: (r.clearear_contacts?.name as string) ?? 'A client',
    rate: usd(Number(r.monthly_rate) || 0),
    sites: (sites ?? []) as any[],
    links: [
      ...(clientId ? [{ label: 'Client account', url: `${BASE}/admin/clients/${clientId}` }] : []),
      { label: 'Retainers', url: `${BASE}/admin/clearear/retainers?business=${r.business}` },
    ],
  };
}

export const EVENT_LABEL: Record<BillingEventKind, string> = {
  signed_up: 'Set up automatic payments',
  charge_paid: 'Payment received',
  charge_failed: 'Card declined',
  card_updated: 'Card updated',
  site_paused: 'Site paused',
  site_restored: 'Site restored',
  plan_paused: 'Billing paused',
  plan_resumed: 'Billing resumed',
  plan_ended: 'Plan ended',
};

/** Recent billing activity for one or more plans (newest first). */
export async function listBillingEvents(retainerIds: string[], limit = 12) {
  if (!retainerIds.length) return [];
  const { data } = await supabaseAdmin.from('billing_events')
    .select('id, retainer_id, site_id, kind, detail, amount, at')
    .in('retainer_id', retainerIds).order('at', { ascending: false }).limit(limit);
  return (data ?? []) as { id: number; retainer_id: string; site_id: string | null; kind: BillingEventKind; detail: string | null; amount: number | null; at: string }[];
}
