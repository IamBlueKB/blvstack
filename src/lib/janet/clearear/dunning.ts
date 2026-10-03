// Non-payment handling for card-subscription retainers — Blue's policy (2026-10-03):
//   • a declined charge starts the clock (past_due_since) and the client is emailed at once with a link to update
//     their card and, when their site is set to auto-pause, the date it pauses;
//   • 2 days before that date: a reminder;
//   • on the date (default 7 days — the site's suspend_grace_days): the site pauses (BLVSTACK holding page) and the
//     client is told; nothing is deleted;
//   • the moment a payment goes through — Stripe's own retry, or the client's new card — the site comes back and the
//     client gets a "you're all set" note.
// Client emails are automatic by Blue's standing approval (approval ref below); each one goes out once per episode
// through the gated send executor (idempotent), BCC'd to Blue like every send.

import { supabaseAdmin } from '../../supabase';
import { resend } from '../../resend';
import { sendVerified } from '../executor';
import { suspendSite, restoreSite, hostOf } from './site-suspension';

// the client's billing page (same link as their signup page) — built here, not imported, so subscriptions.ts can
// import this module without a cycle
const BASE = (import.meta as any).env?.PUBLIC_SITE_URL || 'https://blvstack.com';
const signupUrl = (token: string) => `${BASE}/subscribe/${token}`;

const APPROVAL_REF = 'policy:billing-notices@2026-10-03'; // Blue: "yes emails" — automatic billing notices
const NONPAYMENT = 'non-payment';
const FINAL_NOTICE_DAYS = 2;
const DAY = 86_400_000;
const TZ = 'America/Chicago';
const nowIso = () => new Date().toISOString();
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const longDate = (d: Date) => d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });

type Notice = 'failed' | 'final' | 'paused' | 'restored';

/** The sites that hang off a retainer and pause with it (auto_suspend on, linked to a Vercel project). */
async function pausableSites(retainerId: string) {
  const { data } = await supabaseAdmin.from('janet_sites')
    .select('id, name, production_url, auto_suspend, suspend_grace_days, suspended_at, suspended_reason, vercel_project_id')
    .eq('billing_retainer_id', retainerId);
  return ((data ?? []) as any[]).filter((s) => s.auto_suspend && s.vercel_project_id);
}

/** When the sites pause: the shortest grace period among them, counted from the first failed charge. */
function pauseAt(pastDueSince: string, sites: any[]): Date | null {
  if (!sites.length) return null;
  const days = Math.min(...sites.map((s) => Number(s.suspend_grace_days) || 7));
  return new Date(new Date(pastDueSince).getTime() + days * DAY);
}

/** "Gary" from "DJ Guru G (Gary Bolton)" — the person, not the stage name. */
function greetingName(contact: any) {
  const person = (contact?.contact_person as string) || ((contact?.name as string)?.match(/\(([^)]+)\)/)?.[1] ?? '') || (contact?.name as string) || '';
  return person.trim().split(/\s+/)[0] || 'there';
}

const listSites = (sites: any[]) => {
  const names = sites.map((s) => hostOf(s.production_url));
  return names.length <= 1 ? (names[0] ?? 'your website') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

async function sendNotice(ret: any, kind: Notice, ctx: { sites: any[]; pauseOn?: Date | null; why?: string | null }) {
  const { data: contact } = await supabaseAdmin.from('clearear_contacts').select('name, email, contact_person').eq('id', ret.contact_id).maybeSingle();
  if (!contact?.email) return { sent: false, why: 'no email on the contact' };
  const { data: settings } = await supabaseAdmin.from('clearear_settings').select('business_name, email').eq('business', ret.business).maybeSingle();
  const biz = settings?.business_name || (ret.business === 'blvstack' ? 'BLVSTACK' : 'Clear Ear Studios');
  const replyTo = settings?.email || 'hello@blvstack.com';
  const link = ret.signup_token ? signupUrl(ret.signup_token) : null;
  const plan = `your ${biz} monthly plan (${usd(Number(ret.monthly_rate) || 0)})`;
  const site = listSites(ctx.sites);
  const hasSites = ctx.sites.length > 0;
  const first = greetingName(contact);

  const copy: Record<Notice, { subject: string; lines: string[]; button?: string }> = {
    failed: {
      subject: 'Your payment didn’t go through',
      lines: [
        `We tried to charge your card for ${plan} and it didn’t go through${ctx.why ? ` (${ctx.why.replace(/\.$/, '').toLowerCase()})` : ''}. Stripe will try again automatically.`,
        'To keep everything running, please update your card — it only takes a minute.',
        ...(hasSites && ctx.pauseOn ? [`If it isn’t resolved by ${longDate(ctx.pauseOn)}, ${site} will be paused until the payment goes through.`] : []),
      ],
      button: 'Update your card',
    },
    final: {
      subject: `Reminder: ${site} will be paused ${ctx.pauseOn ? `on ${longDate(ctx.pauseOn)}` : 'soon'}`,
      lines: [
        `Your last payment for ${plan} still hasn’t gone through.`,
        `${ctx.pauseOn ? `On ${longDate(ctx.pauseOn)}` : 'Soon'}, ${site} will be paused until it does. Updating your card takes a minute.`,
      ],
      button: 'Update your card',
    },
    paused: {
      subject: hasSites ? `Your website is paused (${site})` : 'Your plan is past due',
      lines: [
        `Because your payment for ${plan} is past due, ${site} is paused for now. Nothing has been deleted.`,
        'Update your card and it comes back on automatically as soon as the payment goes through.',
      ],
      button: 'Update your card',
    },
    restored: {
      subject: hasSites ? `You’re all set — ${site} is back online` : 'You’re all set — payment received',
      lines: [hasSites ? `Thanks — your payment went through and ${site} is back online.` : `Thanks — your payment for ${plan} went through.`],
    },
  };
  const c = copy[kind];
  const text = [`Hi ${first},`, '', ...c.lines.flatMap((l) => [l, '']), ...(c.button && link ? [`${c.button}: ${link}`, ''] : []), 'Thank you,', biz].join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#161616;">
    <p>Hi ${esc(first)},</p>
    ${c.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
    ${c.button && link ? `<p><a href="${link}" style="display:inline-block;background:#161616;color:#fff;text-decoration:none;padding:11px 20px;border-radius:2px;font-size:13px;letter-spacing:.02em;">${esc(c.button)}</a></p><p style="color:#8a8a8a;font-size:12px;">Or open: ${link}</p>` : ''}
    <p style="margin-top:22px;">Thank you,<br>${esc(biz)}</p>
  </div>`;

  // once per non-payment episode (keyed on when it began), never twice on a retry
  const episode = (ret.past_due_since as string | null)?.slice(0, 19) ?? 'none';
  const res = await sendVerified({
    actionType: 'send_billing_notice',
    lane: 'manual', // the blvstack.com sending key (same as invoice emails); approval = Blue's standing policy
    approvalRef: APPROVAL_REF,
    idempotencyKey: `billing_notice:${ret.id}:${kind}:${episode}`,
    message: { client: resend, from: `${biz} <hello@blvstack.com>`, to: contact.email, replyTo, subject: c.subject, text, html },
    log: { type: 'general', source: 'cron', to: contact.email, toName: contact.name ?? null, fromEmail: replyTo, actor: 'billing', subject: c.subject, body: text },
  });
  return { sent: res.ok, why: res.error };
}

/** A card charge failed — start the clock (first failure only) and tell the client once. */
export async function onChargeFailed(retainerId: string, ctx: { why?: string | null }) {
  const { data: ret } = await supabaseAdmin.from('clearear_retainers').select('*').eq('id', retainerId).maybeSingle();
  if (!ret || ret.status === 'ended') return;
  if (!ret.past_due_since) {
    const { data } = await supabaseAdmin.from('clearear_retainers').update({ past_due_since: nowIso(), updated_at: nowIso() }).eq('id', retainerId).is('past_due_since', null).select().maybeSingle();
    if (data) Object.assign(ret, data);
    else { const { data: fresh } = await supabaseAdmin.from('clearear_retainers').select('*').eq('id', retainerId).single(); Object.assign(ret, fresh); }
  }
  if (!ret.dunning_stage) {
    const sites = await pausableSites(ret.id);
    const r = await sendNotice(ret, 'failed', { sites, pauseOn: pauseAt(ret.past_due_since, sites), why: ctx.why ?? null });
    if (r.sent) await supabaseAdmin.from('clearear_retainers').update({ dunning_stage: 'failed', dunning_notice_at: nowIso(), updated_at: nowIso() }).eq('id', ret.id);
  }
}

/** A payment went through — close the episode: bring back any site paused for non-payment and tell the client. */
export async function onChargePaid(retainerId: string) {
  const { data: ret } = await supabaseAdmin.from('clearear_retainers').select('*').eq('id', retainerId).maybeSingle();
  if (!ret || (!ret.past_due_since && !ret.dunning_stage)) return; // wasn't behind — nothing to undo
  const { data: linked } = await supabaseAdmin.from('janet_sites').select('id, name, production_url, suspended_at, suspended_reason').eq('billing_retainer_id', ret.id);
  const restored: any[] = [];
  for (const s of (linked ?? []) as any[]) {
    if (s.suspended_at && String(s.suspended_reason ?? '').startsWith(NONPAYMENT)) {
      await restoreSite(s.id, { actor: 'billing', why: 'payment received' });
      restored.push(s);
    }
  }
  if (ret.dunning_stage) await sendNotice(ret, 'restored', { sites: restored });
  await supabaseAdmin.from('clearear_retainers').update({ past_due_since: null, dunning_stage: null, dunning_notice_at: nowIso(), updated_at: nowIso() }).eq('id', ret.id);
}

/** Hourly: move every past-due card subscription along the policy (reminder → pause), and restore anything paid
 *  whose webhook was missed. Safe to run any number of times. */
export async function runDunningSweep(now = new Date()) {
  const out = { checked: 0, reminders: 0, paused: 0, restored: 0, errors: [] as string[] };
  const { data: behind } = await supabaseAdmin.from('clearear_retainers').select('*')
    .eq('billing_method', 'stripe_subscription').not('past_due_since', 'is', null).neq('status', 'ended');
  for (const ret of (behind ?? []) as any[]) {
    out.checked++;
    try {
      const sites = await pausableSites(ret.id);
      const at = pauseAt(ret.past_due_since, sites);
      if (!ret.dunning_stage) { await onChargeFailed(ret.id, {}); continue; } // the first notice never went out
      if (!at) continue; // nothing to pause — the card-update notice already went out
      if (now >= at) {
        const toPause = sites.filter((s) => !s.suspended_at);
        for (const s of toPause) await suspendSite(s.id, { reason: `${NONPAYMENT} since ${ret.past_due_since.slice(0, 10)}`, actor: 'billing' });
        out.paused += toPause.length;
        if (ret.dunning_stage !== 'paused') {
          const r = await sendNotice(ret, 'paused', { sites, pauseOn: at });
          if (r.sent) await supabaseAdmin.from('clearear_retainers').update({ dunning_stage: 'paused', dunning_notice_at: nowIso(), updated_at: nowIso() }).eq('id', ret.id);
        }
      } else if (ret.dunning_stage === 'failed' && now.getTime() >= at.getTime() - FINAL_NOTICE_DAYS * DAY) {
        const r = await sendNotice(ret, 'final', { sites, pauseOn: at });
        if (r.sent) { out.reminders++; await supabaseAdmin.from('clearear_retainers').update({ dunning_stage: 'final', dunning_notice_at: nowIso(), updated_at: nowIso() }).eq('id', ret.id); }
      }
    } catch (e) {
      out.errors.push(`${ret.id}: ${(e as Error).message}`);
    }
  }

  // Catch-up: a site still paused for non-payment whose retainer is current again (paid while a webhook was lost).
  const { data: paused } = await supabaseAdmin.from('janet_sites').select('id, billing_retainer_id, suspended_reason').not('suspended_at', 'is', null).like('suspended_reason', `${NONPAYMENT}%`);
  for (const s of (paused ?? []) as any[]) {
    if (!s.billing_retainer_id) continue;
    const { data: ret } = await supabaseAdmin.from('clearear_retainers').select('id, status, past_due_since').eq('id', s.billing_retainer_id).maybeSingle();
    if (ret && ret.status === 'active' && !ret.past_due_since) {
      try { await restoreSite(s.id, { actor: 'billing', why: 'retainer current again' }); out.restored++; } catch (e) { out.errors.push(`${s.id}: ${(e as Error).message}`); }
    }
  }
  return out;
}

/** For admin + JANET: when a past-due retainer's sites pause (null if they don't). */
export async function pauseDateFor(ret: { id: string; past_due_since: string | null }) {
  if (!ret.past_due_since) return null;
  return pauseAt(ret.past_due_since, await pausableSites(ret.id));
}
