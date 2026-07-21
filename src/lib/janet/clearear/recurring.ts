// Clear Ear Studios - recurring invoices (e.g. the youth program billed monthly).
// A template + frequency; the cron generates the next invoice as a DRAFT on its
// date and advances the schedule. Never auto-sent - Blue reviews and sends, same
// as everything else.

import { supabaseAdmin } from '../../supabase';
import { createInvoice } from './invoicing';

export type RecurringTemplate = {
  lines?: any[]; // manual line items
  payment_methods?: string[];
  notes?: string | null;
  tax_rate?: number | null;
  due_days?: number | null; // due_date = issue_date + due_days
};

export async function setRecurring(input: { id?: string; contact_id: string; frequency: string; next_issue_date: string; template: RecurringTemplate; active?: boolean }) {
  const FREQ = ['monthly', 'weekly', 'quarterly'];
  if (!FREQ.includes(input.frequency)) throw new Error(`frequency must be one of ${FREQ.join('/')}.`);
  const { data: contact } = await supabaseAdmin.from('clearear_contacts').select('id').eq('id', input.contact_id).maybeSingle();
  if (!contact) throw new Error('No such contact.');
  const row = { contact_id: input.contact_id, frequency: input.frequency, next_issue_date: input.next_issue_date, template: input.template ?? {}, active: input.active ?? true };
  if (input.id) {
    const { data, error } = await supabaseAdmin.from('clearear_recurring').update(row).eq('id', input.id).select().single();
    if (error) throw new Error(error.message);
    return { updated: true, recurring: data };
  }
  const { data, error } = await supabaseAdmin.from('clearear_recurring').insert(row).select().single();
  if (error) throw new Error(error.message);
  return { created: true, recurring: data };
}

function advance(dateStr: string, frequency: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCMonth(d.getUTCMonth() + 1); // monthly
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Generate DRAFT invoices for every active recurring whose date has arrived, and
 *  advance each schedule. Returns what it generated. Never sends. */
export async function generateDueRecurring() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: due } = await supabaseAdmin.from('clearear_recurring').select('*').eq('active', true).lte('next_issue_date', today).limit(100);
  const generated: any[] = [];
  const skipped: any[] = [];
  for (const r of due ?? []) {
    const t = (r.template ?? {}) as RecurringTemplate;
    if (!Array.isArray(t.lines) || t.lines.length === 0) { skipped.push({ id: r.id, reason: 'template has no lines' }); continue; }
    try {
      const inv = await createInvoice({
        contact_id: r.contact_id,
        lines: t.lines,
        tax_rate: t.tax_rate ?? null,
        payment_methods: Array.isArray(t.payment_methods) ? t.payment_methods : undefined,
        notes: t.notes ?? null,
        due_date: t.due_days != null ? addDays(today, t.due_days) : null,
      });
      await supabaseAdmin.from('clearear_invoices').update({ recurring_id: r.id }).eq('id', (inv as any).invoice.id);
      await supabaseAdmin.from('clearear_recurring').update({ next_issue_date: advance(r.next_issue_date, r.frequency) }).eq('id', r.id);
      generated.push({ recurring_id: r.id, invoice_number: (inv as any).invoice.invoice_number });
    } catch (e) {
      skipped.push({ id: r.id, reason: (e as Error).message });
    }
  }
  return { generated: generated.length, skipped: skipped.length, detail: { generated, skipped } };
}
