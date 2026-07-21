// Clear Ear Studios - contact + session creation, shared by JANET's tools and the
// admin UI forms so both go through ONE implementation (same money math, same
// Rule Zero: a session needs a real amount or hours x rate - never invented).

import { supabaseAdmin } from '../../supabase';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const today = () => new Date().toISOString().slice(0, 10);
export const CLEAREAR_KINDS = ['individual', 'organization'];

export type CreateContactInput = {
  name: string;
  kind?: string;
  contact_person?: string | null;
  email?: string | null;
  phone?: string | null;
  socials?: Record<string, unknown> | null;
  address?: Record<string, unknown> | null;
  notes?: string | null;
};

export async function createContact(input: CreateContactInput) {
  if (!input.name || !input.name.trim()) throw new Error('A contact needs a name.');
  const row: Record<string, unknown> = { name: input.name.trim() };
  if (input.kind && CLEAREAR_KINDS.includes(input.kind)) row.kind = input.kind;
  for (const k of ['contact_person', 'email', 'phone', 'notes'] as const) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) row[k] = v.trim();
  }
  if (input.socials && typeof input.socials === 'object') row.socials = input.socials;
  if (input.address && typeof input.address === 'object') row.address = input.address;
  const { data, error } = await supabaseAdmin.from('clearear_contacts').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export type RecordSessionInput = {
  contact_id: string;
  service_id?: string | null;
  service_label?: string | null;
  session_date?: string | null;
  start_time?: string | null;
  hours?: number | null;
  rate?: number | null;
  amount?: number | null;
  notes?: string | null;
};

/** Record a session. Snapshots the service name + rate; computes amount from
 *  hours x rate when not given explicitly; refuses when neither is derivable
 *  (Rule Zero - never invent an amount). Returns the session + contact name. */
export async function recordSession(input: RecordSessionInput) {
  const { data: contact } = await supabaseAdmin.from('clearear_contacts').select('id, name').eq('id', input.contact_id).maybeSingle();
  if (!contact) throw new Error(`No Clear Ear contact with id ${input.contact_id} - look them up or create them first.`);

  let serviceLabel: string | null = input.service_label ?? null;
  const serviceId: string | null = input.service_id ?? null;
  let catalogRate: number | undefined;
  if (serviceId) {
    const { data: svc } = await supabaseAdmin.from('clearear_services').select('id, name, default_rate').eq('id', serviceId).maybeSingle();
    if (!svc) throw new Error(`No Clear Ear service with id ${serviceId}.`);
    if (!serviceLabel) serviceLabel = svc.name;
    if (svc.default_rate != null) catalogRate = num(svc.default_rate);
  }

  const hours = input.hours != null ? num(input.hours) : undefined;
  let rate = input.rate != null ? num(input.rate) : catalogRate;
  let amount = input.amount != null ? num(input.amount) : undefined;
  if (amount == null) {
    if (hours != null && rate != null) amount = round2(hours * rate);
    else throw new Error('Amount could not be determined. Give an explicit amount, or hours + a rate - never guessed.');
  }
  if (rate == null && hours != null && hours > 0) rate = round2(amount / hours);

  const row: Record<string, unknown> = {
    contact_id: input.contact_id,
    service_id: serviceId,
    service_label: serviceLabel,
    session_date: input.session_date || today(),
    start_time: input.start_time || null,
    hours: hours ?? null,
    rate: rate ?? null,
    amount,
    notes: input.notes || null,
  };
  const { data, error } = await supabaseAdmin.from('clearear_sessions').insert(row).select().single();
  if (error) throw new Error(error.message);
  return { session: data, contact: contact.name };
}
