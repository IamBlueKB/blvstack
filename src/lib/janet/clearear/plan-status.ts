// A client's card-plan status at a glance — the badge on their account (and on the clients list): auto-pay active,
// waiting on their card, past due (with the pause date), site paused, billing paused, plan ended. Plans are found
// through the client's sites (janet_sites.billing_retainer_id), the same link the site-pausing system uses.

import { supabaseAdmin } from '../../supabase';

const TZ = 'America/Chicago';
const DAY = 86_400_000;
const BASE = (import.meta as any).env?.PUBLIC_SITE_URL || 'https://blvstack.com';
const shortDate = (d: string | Date) => new Date(d).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export type Tone = 'ok' | 'wait' | 'warn' | 'bad' | 'off';
export type PlanStatus = {
  retainer_id: string;
  card: boolean;
  badge: string;          // short pill text
  tone: Tone;
  line: string;           // one-sentence status
  signup_url: string | null;
  sites: { id: string; url: string; paused: boolean }[];
};

export const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-emerald-500/40 text-emerald-400',
  wait: 'border-sky-400/40 text-sky-300',
  warn: 'border-amber-500/50 text-amber-400',
  bad: 'border-red-500/50 text-red-400',
  off: 'border-white/10 text-slate/50',
};

function statusOf(r: any, sites: any[]): PlanStatus {
  const card = r.billing_method === 'stripe_subscription';
  const rate = `${usd(Number(r.monthly_rate) || 0)}/mo`;
  const s = sites.map((x) => ({ id: x.id, url: String(x.production_url).replace(/^https?:\/\//, ''), paused: !!x.suspended_at }));
  const base = { retainer_id: r.id, card, sites: s, signup_url: r.status === 'pending' && r.signup_token ? `${BASE}/subscribe/${r.signup_token}` : null };
  const pausedSites = s.filter((x) => x.paused);
  if (pausedSites.length) return { ...base, badge: 'Site paused', tone: 'warn', line: `${pausedSites.map((x) => x.url).join(', ')} is paused — it comes back as soon as they pay.` };
  if (r.status === 'pending') return { ...base, badge: 'Waiting on card', tone: 'wait', line: `${rate} card plan — waiting on them to add a card.` };
  if (r.status === 'ended') return { ...base, badge: 'Plan ended', tone: 'off', line: `${rate} plan ended${r.end_date ? ` ${shortDate(r.end_date + 'T12:00:00')}` : ''}.` };
  if (r.status === 'paused') return { ...base, badge: 'Billing paused', tone: 'warn', line: `${rate} — billing is paused.` };
  if (r.past_due_since) {
    const auto = sites.filter((x) => x.auto_suspend && !x.suspended_at);
    const at = auto.length ? new Date(new Date(r.past_due_since).getTime() + Math.min(...auto.map((x) => Number(x.suspend_grace_days) || 7)) * DAY) : null;
    return { ...base, badge: 'Past due', tone: 'bad', line: `Card declined — past due since ${shortDate(r.past_due_since)}${at ? `; site pauses ${shortDate(at)} unless paid` : ''}.` };
  }
  const next = r.current_period_end ? ` · next charge ${shortDate(r.current_period_end)}` : '';
  return { ...base, badge: card ? 'Auto-pay on' : 'Invoiced monthly', tone: 'ok', line: `${rate} ${card ? 'charged automatically' : 'by monthly invoice'}${next}.` };
}

/** Plan statuses for each of these clients (via their sites). Clients with no linked plan are absent. */
export async function planStatusForClients(clientIds: string[]): Promise<Map<string, PlanStatus[]>> {
  const out = new Map<string, PlanStatus[]>();
  if (!clientIds.length) return out;
  const { data: sites } = await supabaseAdmin.from('janet_sites')
    .select('id, client_id, production_url, billing_retainer_id, auto_suspend, suspend_grace_days, suspended_at')
    .in('client_id', clientIds).not('billing_retainer_id', 'is', null);
  const retIds = [...new Set(((sites ?? []) as any[]).map((s) => s.billing_retainer_id))];
  if (!retIds.length) return out;
  const { data: rets } = await supabaseAdmin.from('clearear_retainers')
    .select('id, status, billing_method, monthly_rate, current_period_end, past_due_since, signup_token, end_date')
    .in('id', retIds);
  for (const r of (rets ?? []) as any[]) {
    const linked = ((sites ?? []) as any[]).filter((s) => s.billing_retainer_id === r.id);
    const status = statusOf(r, linked);
    for (const cid of new Set(linked.map((s) => s.client_id as string))) {
      out.set(cid, [...(out.get(cid) ?? []), status]);
    }
  }
  return out;
}
