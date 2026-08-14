// Clear Ear / BLVSTACK — projects. A project groups the invoices for one piece of
// work (deposit + balance roll up to one project). total_value is the contract/quote
// value: PIPELINE, never revenue. Revenue is always collected payments — a project's
// value and its collected money are different numbers and never added together.
//
// Rule Zero holds: total_value is what Blue states, not a guess.

import { supabaseAdmin } from '../../supabase';
import { guardedCreate, naturalKey } from '../write-executor';
import { assertBusiness, type Business } from './expenses';

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export const PROJECT_STATUSES = ['proposed', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type CreateProjectInput = {
  business: Business;
  contact_id: string;
  name: string;
  total_value?: number | null;
  status?: ProjectStatus;
  start_date?: string | null;
  target_date?: string | null;
  notes?: string | null;
  actor?: string;
};

/** Create a project for a client in a given business. The client must belong to the
 *  same business — you can't open a BLVSTACK project against a Clear Ear contact. */
export async function createProject(input: CreateProjectInput) {
  const business = assertBusiness(input.business);
  if (!input.name || !input.name.trim()) throw new Error('A project needs a name.');
  const { data: contact } = await supabaseAdmin.from('clearear_contacts').select('id, name, business').eq('id', input.contact_id).maybeSingle();
  if (!contact) throw new Error(`No contact with id ${input.contact_id}.`);
  if (contact.business !== business) throw new Error(`Contact "${contact.name}" is a ${contact.business} contact — a ${business} project can only belong to a ${business} contact.`);
  const status = (input.status && PROJECT_STATUSES.includes(input.status) ? input.status : 'active') as ProjectStatus;

  const key = naturalKey('clearear_project', [business, input.contact_id, input.name.trim()]);
  const { row, dedup } = await guardedCreate<any>({
    actionType: 'clearear_project',
    idempotencyKey: key,
    actor: input.actor ?? 'blue',
    payload: { business, contact_id: input.contact_id, name: input.name.trim() },
    create: async () => {
      const { data, error } = await supabaseAdmin.from('clearear_projects').insert({
        business, contact_id: input.contact_id, name: input.name.trim(),
        total_value: input.total_value != null ? round2(num(input.total_value)) : null,
        status, start_date: input.start_date ?? null, target_date: input.target_date ?? null,
        notes: input.notes ?? null,
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    reread: async (id) => (await supabaseAdmin.from('clearear_projects').select('*').eq('id', id).maybeSingle()).data,
  });
  return { ...row, dedup };
}

/** Update a project's status (proposed → active → completed, etc.) or details. */
export async function updateProject(id: string, patch: Partial<Pick<CreateProjectInput, 'name' | 'total_value' | 'status' | 'start_date' | 'target_date' | 'notes'>>) {
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name != null) upd.name = String(patch.name).trim();
  if (patch.total_value !== undefined) upd.total_value = patch.total_value != null ? round2(num(patch.total_value)) : null;
  if (patch.status && PROJECT_STATUSES.includes(patch.status)) upd.status = patch.status;
  if (patch.start_date !== undefined) upd.start_date = patch.start_date ?? null;
  if (patch.target_date !== undefined) upd.target_date = patch.target_date ?? null;
  if (patch.notes !== undefined) upd.notes = patch.notes ?? null;
  const { data, error } = await supabaseAdmin.from('clearear_projects').update(upd).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** List projects for a business (or 'all'), each with its money rollup. */
export async function listProjects(opts: { business: Business | 'all'; status?: ProjectStatus; contact_id?: string }) {
  let q = supabaseAdmin
    .from('clearear_projects')
    .select('id, business, contact_id, name, total_value, status, start_date, target_date, clearear_contacts(name)')
    .order('created_at', { ascending: false });
  if (opts.business !== 'all') q = q.eq('business', assertBusiness(opts.business));
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.contact_id) q = q.eq('contact_id', opts.contact_id);
  const { data: projects } = await q;
  const rows = (projects ?? []) as any[];
  if (rows.length === 0) return [];

  // Money per project, from the real invoice + payment rows.
  const ids = rows.map((r) => r.id);
  const { data: invs } = await supabaseAdmin
    .from('clearear_invoices')
    .select('id, project_id, total, balance, status, amount_paid')
    .in('project_id', ids);
  const roll = new Map<string, { invoiced: number; collected: number; outstanding: number; count: number }>();
  for (const inv of (invs ?? []) as any[]) {
    if (inv.status === 'void') continue;
    const r = roll.get(inv.project_id) ?? { invoiced: 0, collected: 0, outstanding: 0, count: 0 };
    r.invoiced += num(inv.total);
    r.collected += num(inv.amount_paid);
    r.outstanding += num(inv.balance);
    r.count += 1;
    roll.set(inv.project_id, r);
  }
  return rows.map((r) => {
    const m = roll.get(r.id) ?? { invoiced: 0, collected: 0, outstanding: 0, count: 0 };
    return {
      id: r.id, business: r.business, name: r.name, status: r.status,
      contact_id: r.contact_id, contact_name: r.clearear_contacts?.name ?? null,
      total_value: r.total_value != null ? num(r.total_value) : null,
      start_date: r.start_date, target_date: r.target_date,
      invoice_count: m.count,
      invoiced: round2(m.invoiced), collected: round2(m.collected), outstanding: round2(m.outstanding),
    };
  });
}

/** Pipeline: projects grouped by status, with count and summed total_value. Pipeline
 *  value is potential work — NOT collected money. */
export async function getProjectPipeline(opts: { business: Business | 'all' }) {
  const list = await listProjects({ business: opts.business });
  const byStatus: Record<string, { count: number; value: number; invoiced: number; outstanding: number }> = {};
  for (const p of list) {
    const s = (byStatus[p.status] ??= { count: 0, value: 0, invoiced: 0, outstanding: 0 });
    s.count += 1; s.value += p.total_value ?? 0; s.invoiced += p.invoiced; s.outstanding += p.outstanding;
  }
  return {
    business: opts.business,
    by_status: byStatus,
    total_pipeline_value: round2(list.reduce((s, p) => s + (p.total_value ?? 0), 0)),
    projects: list,
  };
}
