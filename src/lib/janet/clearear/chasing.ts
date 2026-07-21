// Clear Ear Studios - overdue chasing + lapsed-client outreach (Phase 3.1/3.2).
// Overdue invoices and lapsed clients surface as PREPARED DECISIONS in the morning
// queue (the initiative loop): a drafted, polite message, one-click approve,
// through the same executor + ledger as everything else. Nothing sends unapproved.

import { supabaseAdmin } from '../../supabase';
import { anthropic } from '../../anthropic';
import { JANET_MODEL } from '../config';
import type { PreparedDecision } from '../initiative';

const DAY = 86_400_000;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

async function draft(system: string, context: string): Promise<string> {
  const resp = await anthropic.messages.create({ model: JANET_MODEL, max_tokens: 350, system, messages: [{ role: 'user', content: context }] });
  return resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
}

/** Flip sent/viewed/partial invoices past their due date (with a balance) to
 *  'overdue'. Deterministic; run daily. Returns how many flipped. */
export async function flipOverdue(): Promise<{ flipped: number }> {
  const { data } = await supabaseAdmin
    .from('clearear_invoices')
    .update({ status: 'overdue', updated_at: new Date().toISOString() })
    .in('status', ['sent', 'viewed', 'partial'])
    .lt('due_date', today())
    .gt('balance', 0)
    .select('id');
  return { flipped: data?.length ?? 0 };
}

const REMINDER_SYSTEM = `You are writing a brief, polite payment reminder from Clear Ear Studios (a recording studio) to a client with an outstanding invoice balance. Warm and professional — a friendly nudge, never pressure, guilt, or threats. Reference the invoice number and that a balance is outstanding, and thank them. 40-75 words, plain text, sign as "Clear Ear Studios". Output ONLY the email body — a payment link is appended automatically, so do not invent one.`;

/** Overdue invoices with a contact email → a prepared reminder decision each. */
export async function overdueInvoiceDecisions(): Promise<PreparedDecision[]> {
  const { data: invs } = await supabaseAdmin
    .from('clearear_invoices')
    .select('id, invoice_number, contact_id, status, due_date, balance, total, clearear_contacts(name, email)')
    .eq('status', 'overdue')
    .gt('balance', 0)
    .order('due_date', { ascending: true })
    .limit(20);
  const out: PreparedDecision[] = [];
  for (const inv of (invs ?? []) as any[]) {
    const contact = inv.clearear_contacts;
    const daysOver = inv.due_date ? Math.floor((Date.now() - new Date(inv.due_date).getTime()) / DAY) : 0;
    const bal = num(inv.balance);
    if (!contact?.email) {
      out.push({
        kind: 'blocked', priority: 55, value_estimate: bal,
        evidence: `Can't send a reminder for ${inv.invoice_number} — ${contact?.name ?? 'the client'} has no email on file. Add it on their contact and it'll queue automatically.`,
        summary: `⚠ Missing data — reminder for ${inv.invoice_number} blocked (no client email)`,
        proposals: [], dedup_key: `blocked_clearear_reminder:${inv.id}`,
      });
      continue;
    }
    let body: string;
    try {
      body = await draft(REMINDER_SYSTEM, `Invoice ${inv.invoice_number} for ${contact.name}. Balance outstanding: ${usd(bal)}. Due ${inv.due_date} (${daysOver} days ago). Draft the reminder.`);
    } catch { continue; }
    out.push({
      kind: 'initiative',
      priority: Math.min(90, 55 + Math.floor(daysOver / 7) * 5), // older overdue ranks higher, capped
      value_estimate: bal,
      evidence: `Overdue invoice — ${inv.invoice_number}, ${contact.name}, ${usd(bal)} due ${daysOver}d ago (due ${inv.due_date}).`,
      summary: `Send payment reminder — ${inv.invoice_number} to ${contact.name} (${usd(bal)}, ${daysOver}d overdue)`,
      proposals: [{ tool: 'send_clearear_message', input: { contact_id: inv.contact_id, invoice_id: inv.id, subject: `Payment reminder — Invoice ${inv.invoice_number}`, body }, summary: `Email reminder for ${inv.invoice_number} to ${contact.name}` }],
      dedup_key: `clearear_reminder:${inv.id}`,
    });
  }
  return out;
}

const CHECKIN_SYSTEM = `You are writing a brief, warm check-in from Clear Ear Studios (a recording studio) to a studio client who hasn't booked a session in a while. Friendly and low-pressure — glad to have them back whenever they're ready, and open to helping with their next project. Acknowledge it's been a bit. No hard sell. 40-75 words, plain text, sign as "Clear Ear Studios". Output ONLY the email body.`;

/** Active contacts with no session in `lapsedDays` (and an email) → a prepared
 *  check-in decision each. */
export async function lapsedClientDecisions(lapsedDays = 60): Promise<PreparedDecision[]> {
  const { data: contacts } = await supabaseAdmin
    .from('clearear_contacts')
    .select('id, name, email')
    .eq('status', 'active')
    .not('email', 'is', null)
    .limit(200);
  if (!contacts || contacts.length === 0) return [];
  const { data: sessions } = await supabaseAdmin.from('clearear_sessions').select('contact_id, session_date');
  const last = new Map<string, string>();
  for (const s of sessions ?? []) {
    const prev = last.get(s.contact_id);
    if (!prev || s.session_date > prev) last.set(s.contact_id, s.session_date);
  }
  const out: PreparedDecision[] = [];
  for (const c of contacts as any[]) {
    const lastDate = last.get(c.id);
    if (!lastDate) continue; // never had a session — not "lapsed", just new; skip
    const days = Math.floor((Date.now() - new Date(lastDate).getTime()) / DAY);
    if (days < lapsedDays) continue;
    let body: string;
    try {
      body = await draft(CHECKIN_SYSTEM, `Client: ${c.name}. Last session was ${lastDate} (${days} days ago). Draft the check-in.`);
    } catch { continue; }
    out.push({
      kind: 'initiative', priority: 30, value_estimate: null,
      evidence: `Lapsed client — ${c.name}, last session ${lastDate} (${days}d ago).`,
      summary: `Check in with ${c.name} (${days}d since last session)`,
      proposals: [{ tool: 'send_clearear_message', input: { contact_id: c.id, subject: `Been a minute — Clear Ear Studios`, body }, summary: `Email check-in to ${c.name}` }],
      dedup_key: `clearear_checkin:${c.id}`,
    });
  }
  return out;
}
