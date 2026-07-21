// Clear Ear Studio — Phase 1 tools (contacts + sessions). JANET is the
// conversational interface: Blue tells her the details of a session in chat and
// it lands as a real row. Rule Zero applies — she never invents a name, amount,
// or date; missing detail is asked for, not guessed.
//
// Ring 1: reads. Ring 2: reversible internal writes (contacts, sessions). No
// external action here — invoicing/sending is Phase 2 (Ring 3, executor).

import { supabaseAdmin } from '../../supabase';
import type { JanetTool } from '../types';
import { createInvoice, recordPayment, getInvoice, listInvoices, getOutstanding } from '../clearear/invoicing';

function reqString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required input: ${key}`);
  return v.trim();
}
function optString(input: unknown, key: string): string | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function optNumber(input: unknown, key: string): number | undefined {
  const v = (input as any)?.[key];
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && isFinite(Number(v))) return Number(v);
  return undefined;
}
function optObject(input: unknown, key: string): Record<string, unknown> | undefined {
  const v = (input as any)?.[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const KINDS = ['individual', 'organization'];

async function findContact(idOrName: { contact_id?: string; contact_name?: string }) {
  if (idOrName.contact_id) {
    const { data } = await supabaseAdmin.from('clearear_contacts').select('*').eq('id', idOrName.contact_id).maybeSingle();
    return { match: data ?? null, candidates: data ? [data] : [] };
  }
  const name = idOrName.contact_name;
  if (!name) return { match: null, candidates: [] };
  const { data } = await supabaseAdmin.from('clearear_contacts').select('*').ilike('name', name).eq('status', 'active');
  const rows = data ?? [];
  return { match: rows.length === 1 ? rows[0] : null, candidates: rows };
}

export const clearearTools: JanetTool[] = [
  // ── Reads ─────────────────────────────────────────────────────────────
  {
    name: 'get_clearear_contacts',
    description:
      "List Clear Ear Studio contacts (studio clients — individuals and organizations). Filter by status ('active'/'archived'), kind ('individual'/'organization'), or a name search. Use to answer 'who are my studio clients', to find a contact before recording a session, or to list orgs. Returns id, name, kind, email, phone, status. For full detail + session history use get_clearear_contact.",
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'archived'] },
        kind: { type: 'string', enum: KINDS },
        search: { type: 'string', description: 'Case-insensitive name substring' },
        limit: { type: 'number' },
      },
    },
    handler: async (input) => {
      let q = supabaseAdmin.from('clearear_contacts').select('id, name, kind, email, phone, status').order('name');
      const status = optString(input, 'status');
      if (status) q = q.eq('status', status);
      const kind = optString(input, 'kind');
      if (kind) q = q.eq('kind', kind);
      const search = optString(input, 'search');
      if (search) q = q.ilike('name', `%${search}%`);
      q = q.limit(Math.min(Math.max(optNumber(input, 'limit') ?? 100, 1), 300));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data?.length ?? 0, contacts: data ?? [] };
    },
  },
  {
    name: 'get_clearear_contact',
    description:
      "One Clear Ear contact's full profile by id (or exact name): details, socials, address, plus their session history and computed totals — session count, lifetime billed amount, and last session date. Use for 'tell me about <contact>', 'when did <contact> last book', or before drafting anything for them.",
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Contact UUID (preferred)' },
        name: { type: 'string', description: 'Exact contact name (used if no id)' },
      },
    },
    handler: async (input) => {
      const { match, candidates } = await findContact({ contact_id: optString(input, 'id'), contact_name: optString(input, 'name') });
      if (!match) {
        if (candidates.length > 1) return { found: false, ambiguous: true, candidates: candidates.map((c) => ({ id: c.id, name: c.name, kind: c.kind })) };
        return { found: false };
      }
      const { data: sessions } = await supabaseAdmin
        .from('clearear_sessions')
        .select('id, session_date, service_label, hours, rate, amount, notes, invoice_id')
        .eq('contact_id', match.id)
        .order('session_date', { ascending: false })
        .limit(200);
      const rows = sessions ?? [];
      const lifetime = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
      return {
        found: true,
        contact: match,
        stats: { session_count: rows.length, lifetime_amount: lifetime, last_session_date: rows[0]?.session_date ?? null },
        sessions: rows,
      };
    },
  },
  {
    name: 'get_clearear_sessions',
    description:
      'List Clear Ear studio sessions, newest first. Filter by contact_id, service_id, or a date range (from/to, ISO dates). Use for the session log, "what did I record this week", or a contact\'s recent bookings. Returns each session with its contact name and service label.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string' },
        service_id: { type: 'string' },
        from: { type: 'string', description: 'ISO date (inclusive)' },
        to: { type: 'string', description: 'ISO date (inclusive)' },
        limit: { type: 'number' },
      },
    },
    handler: async (input) => {
      let q = supabaseAdmin
        .from('clearear_sessions')
        .select('id, contact_id, service_label, session_date, start_time, hours, rate, amount, notes, invoice_id, clearear_contacts(name)')
        .order('session_date', { ascending: false });
      const cid = optString(input, 'contact_id');
      if (cid) q = q.eq('contact_id', cid);
      const sid = optString(input, 'service_id');
      if (sid) q = q.eq('service_id', sid);
      const from = optString(input, 'from');
      if (from) q = q.gte('session_date', from);
      const to = optString(input, 'to');
      if (to) q = q.lte('session_date', to);
      q = q.limit(Math.min(Math.max(optNumber(input, 'limit') ?? 100, 1), 300));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const sessions = (data ?? []).map((s: any) => ({ ...s, contact_name: s.clearear_contacts?.name ?? null, clearear_contacts: undefined }));
      return { count: sessions.length, sessions };
    },
  },

  // ── Writes (Ring 2) ───────────────────────────────────────────────────
  {
    name: 'create_clearear_contact',
    description:
      "Create a Clear Ear Studio contact. Use when Blue names a studio client you don't have yet (confirm with him first if it's ambiguous — do NOT invent a contact from thin air). name is required; kind defaults to 'individual' (use 'organization' for the youth-program client etc.). socials is a JSON object ({instagram, x, tiktok, youtube, soundcloud, spotify}); address is a JSON object for orgs that need it on invoices. Returns the created contact.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        kind: { type: 'string', enum: KINDS },
        contact_person: { type: 'string', description: 'For organizations: who to address' },
        email: { type: 'string' },
        phone: { type: 'string' },
        socials: { type: 'object', description: '{ instagram, x, tiktok, youtube, soundcloud, spotify, ... }' },
        address: { type: 'object', description: 'For organizations that need it on invoices' },
        notes: { type: 'string' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const row: Record<string, unknown> = { name: reqString(input, 'name') };
      const kind = optString(input, 'kind');
      if (kind) row.kind = kind;
      for (const k of ['contact_person', 'email', 'phone', 'notes'] as const) {
        const v = optString(input, k);
        if (v !== undefined) row[k] = v;
      }
      const socials = optObject(input, 'socials');
      if (socials) row.socials = socials;
      const address = optObject(input, 'address');
      if (address) row.address = address;
      const { data, error } = await supabaseAdmin.from('clearear_contacts').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { created: true, contact: data };
    },
  },
  {
    name: 'update_clearear_contact',
    description:
      'Edit a Clear Ear contact by id — any of name, kind, contact_person, email, phone, socials, address, notes, or status (active/archived). Only the fields you pass change. Use to correct details, add socials, or archive a lapsed contact. Returns the updated contact.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        kind: { type: 'string', enum: KINDS },
        contact_person: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        socials: { type: 'object' },
        address: { type: 'object' },
        notes: { type: 'string' },
        status: { type: 'string', enum: ['active', 'archived'] },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ['name', 'kind', 'contact_person', 'email', 'phone', 'notes', 'status'] as const) {
        const v = optString(input, k);
        if (v !== undefined) patch[k] = v;
      }
      const socials = optObject(input, 'socials');
      if (socials) patch.socials = socials;
      const address = optObject(input, 'address');
      if (address) patch.address = address;
      if (Object.keys(patch).length === 1) throw new Error('Nothing to update.');
      const { data, error } = await supabaseAdmin.from('clearear_contacts').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { updated: true, contact: data };
    },
  },
  {
    name: 'record_clearear_session',
    description:
      "Record a Clear Ear studio session against a contact — the conversational entry point ('record a 3-hour studio session, $180, today'). Requires contact_id (look the contact up first with get_clearear_contacts / get_clearear_contact; if you don't have them, ask Blue or create them — never invent a contact). Give either an explicit amount, OR hours + rate (amount = hours × rate). If neither is derivable, DO NOT guess — ask Blue for the amount. service_id snapshots the service name + rate at session time. session_date defaults to today. Returns the created session.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string' },
        service_id: { type: 'string', description: 'From get_clearear_services / the catalog (optional)' },
        service_label: { type: 'string', description: 'Free-text service name if no catalog id' },
        session_date: { type: 'string', description: 'ISO date; defaults to today' },
        start_time: { type: 'string', description: 'HH:MM (optional)' },
        hours: { type: 'number' },
        rate: { type: 'number', description: 'Rate applied (may differ from the catalog default)' },
        amount: { type: 'number', description: 'What it came to; if omitted, computed from hours × rate' },
        notes: { type: 'string' },
      },
      required: ['contact_id'],
    },
    handler: async (input) => {
      const contactId = reqString(input, 'contact_id');
      const { data: contact } = await supabaseAdmin.from('clearear_contacts').select('id, name').eq('id', contactId).maybeSingle();
      if (!contact) throw new Error(`No Clear Ear contact with id ${contactId}. Look them up or create them first — do not invent one.`);

      // Snapshot the service (label + a fallback rate) if a catalog id was given.
      let serviceLabel = optString(input, 'service_label') ?? null;
      let serviceId: string | null = optString(input, 'service_id') ?? null;
      let catalogRate: number | undefined;
      if (serviceId) {
        const { data: svc } = await supabaseAdmin.from('clearear_services').select('id, name, default_rate').eq('id', serviceId).maybeSingle();
        if (!svc) throw new Error(`No Clear Ear service with id ${serviceId}.`);
        if (!serviceLabel) serviceLabel = svc.name; // snapshot the name
        if (svc.default_rate != null) catalogRate = Number(svc.default_rate);
      }

      const hours = optNumber(input, 'hours');
      let rate = optNumber(input, 'rate') ?? catalogRate;
      let amount = optNumber(input, 'amount');
      if (amount == null) {
        if (hours != null && rate != null) amount = round2(hours * rate);
        else throw new Error('Amount could not be determined. Provide an explicit amount, or hours + a rate — do not guess.');
      }
      if (rate == null && hours != null && hours > 0) rate = round2(amount / hours); // back out the effective rate for the snapshot

      const row: Record<string, unknown> = {
        contact_id: contactId,
        service_id: serviceId,
        service_label: serviceLabel,
        session_date: optString(input, 'session_date') ?? today(),
        start_time: optString(input, 'start_time') ?? null,
        hours: hours ?? null,
        rate: rate ?? null,
        amount,
        notes: optString(input, 'notes') ?? null,
      };
      const { data, error } = await supabaseAdmin.from('clearear_sessions').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { recorded: true, session: data, contact: contact.name };
    },
  },

  // ── Invoicing (Phase 2) ───────────────────────────────────────────────
  {
    name: 'get_clearear_invoices',
    description:
      "List Clear Ear invoices, newest first. Filter by status (draft/sent/viewed/partial/paid/overdue/void) or contact_id. Use for 'show my invoices', 'what's unpaid', or before recording a payment. Returns number, contact, status, total, amount paid, and balance. For 'who owes me money' use get_clearear_outstanding.",
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void'] },
        contact_id: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    handler: async (input) => {
      const invoices = await listInvoices({ status: optString(input, 'status'), contact_id: optString(input, 'contact_id'), limit: optNumber(input, 'limit') });
      return { count: invoices.length, invoices };
    },
  },
  {
    name: 'get_clearear_invoice',
    description: 'One Clear Ear invoice in full by id: header, line items, payments applied, balance, and the contact. Use to read an invoice before editing, sending, or recording a payment on it.',
    ring: 1,
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (input) => {
      const inv = await getInvoice(reqString(input, 'id'));
      if (!inv) return { found: false };
      return { found: true, ...inv };
    },
  },
  {
    name: 'get_clearear_outstanding',
    description: "Who owes money on Clear Ear invoices: every open invoice with a balance, its contact, balance, and days overdue, plus the total outstanding. Use for 'who owes me', 'what's overdue', 'how much is outstanding'. Grounded in real invoice rows.",
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => getOutstanding(),
  },
  {
    name: 'create_clearear_invoice',
    description:
      "Create a DRAFT Clear Ear invoice for a contact (never sent — Blue reviews and sends). Seed line items from a contact's unbilled sessions (session_ids) and/or add manual lines. Each manual line needs a description and either an amount or a unit_price (x quantity) — do NOT invent amounts. Optionally set due_date, tax_rate (percent), payment_methods (which method keys render — e.g. ['zelle','cash']), and notes. Returns the created draft with computed totals.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string' },
        session_ids: { type: 'array', items: { type: 'string' }, description: "Unbilled session ids to bill (from the contact's session history)" },
        lines: {
          type: 'array',
          description: 'Manual line items',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              service_label: { type: 'string', description: "What the line is FOR (e.g. 'Youth Audio Program')" },
              quantity: { type: 'number' },
              unit_price: { type: 'number' },
              amount: { type: 'number' },
            },
          },
        },
        due_date: { type: 'string', description: 'ISO date' },
        tax_rate: { type: 'number', description: 'Percent, e.g. 8.25' },
        payment_methods: { type: 'array', items: { type: 'string' }, description: "Method keys to show on this invoice: cashapp|zelle|cash|check|ach|stripe" },
        notes: { type: 'string' },
      },
      required: ['contact_id'],
    },
    handler: async (input) => {
      const i = input as any;
      const inv = await createInvoice({
        contact_id: reqString(input, 'contact_id'),
        session_ids: Array.isArray(i.session_ids) ? i.session_ids : undefined,
        lines: Array.isArray(i.lines) ? i.lines : undefined,
        due_date: optString(input, 'due_date') ?? null,
        tax_rate: optNumber(input, 'tax_rate') ?? null,
        payment_methods: Array.isArray(i.payment_methods) ? i.payment_methods : undefined,
        notes: optString(input, 'notes') ?? null,
      });
      return { created: true, ...inv };
    },
  },
  {
    name: 'record_clearear_payment',
    description:
      "Record a payment ('Marcus paid $180 CashApp today' → tie it to their open invoice, or leave invoice_id off for a standalone session payment). Recording against an invoice recalculates its balance and moves its status (partial/paid). Requires a positive amount and a method (cashapp/zelle/cash/check/ach/stripe/other). Provide invoice_id OR contact_id. paid_at defaults to today; reference is a check #/txn id; is_deposit flags a deposit. Never invent an amount or method — ask.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'The invoice this pays toward (optional for a standalone payment)' },
        contact_id: { type: 'string', description: 'Required if no invoice_id' },
        session_id: { type: 'string' },
        amount: { type: 'number' },
        method: { type: 'string', description: 'cashapp|zelle|cash|check|ach|stripe|other' },
        paid_at: { type: 'string', description: 'ISO date; defaults to today' },
        reference: { type: 'string', description: 'check #, transaction id, confirmation' },
        is_deposit: { type: 'boolean' },
        notes: { type: 'string' },
      },
      required: ['amount', 'method'],
    },
    handler: async (input) => {
      const amount = optNumber(input, 'amount');
      if (amount == null) throw new Error('A payment needs an amount — do not guess it.');
      const res = await recordPayment({
        invoice_id: optString(input, 'invoice_id') ?? null,
        contact_id: optString(input, 'contact_id'),
        session_id: optString(input, 'session_id') ?? null,
        amount,
        method: reqString(input, 'method'),
        paid_at: optString(input, 'paid_at'),
        reference: optString(input, 'reference') ?? null,
        is_deposit: (input as any)?.is_deposit === true,
        notes: optString(input, 'notes') ?? null,
        recorded_by: 'janet',
      });
      return { recorded: true, ...res };
    },
  },
];
