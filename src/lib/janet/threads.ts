// JANET Feature 1 — conversation threads. Multiple named threads, each optionally
// attached to a client; switchable; nothing destroyed. janet_memory is shared
// across ALL threads (never touched here) — switching context never resets what
// she has learned.

import { supabaseAdmin } from '../supabase';

export async function listThreads(opts: { includeArchived?: boolean } = {}) {
  let q = supabaseAdmin
    .from('janet_threads')
    .select('id, title, client_id, status, last_message_at, created_at')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200);
  if (!opts.includeArchived) q = q.eq('status', 'active');
  const { data } = await q;
  const threads = data ?? [];
  // attach client names for grouping
  const clientIds = [...new Set(threads.map((t) => t.client_id).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (clientIds.length) {
    const { data: cs } = await supabaseAdmin.from('janet_clients').select('id, name').in('id', clientIds);
    for (const c of cs ?? []) names[c.id] = c.name;
  }
  return threads.map((t) => ({ ...t, client_name: t.client_id ? names[t.client_id] ?? null : null }));
}

export async function createThread(input: { title: string; client_id?: string | null }) {
  const title = (input.title ?? '').trim() || 'Untitled';
  const { data, error } = await supabaseAdmin
    .from('janet_threads')
    .insert({ title, client_id: input.client_id ?? null, last_message_at: new Date().toISOString() })
    .select('id, title, client_id, status, last_message_at, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function archiveThread(id: string, archived = true) {
  const { error } = await supabaseAdmin.from('janet_threads').update({ status: archived ? 'archived' : 'active' }).eq('id', id);
  if (error) throw new Error(error.message);
  return { id, archived };
}

/** Resolve a usable thread id — the given one if valid, else the most recent
 *  active thread, else create a General thread. Never returns null. */
export async function resolveThreadId(threadId?: string | null): Promise<string> {
  if (threadId) {
    const { data } = await supabaseAdmin.from('janet_threads').select('id').eq('id', threadId).maybeSingle();
    if (data) return data.id;
  }
  const { data: recent } = await supabaseAdmin
    .from('janet_threads').select('id').eq('status', 'active')
    .order('last_message_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (recent) return recent.id;
  return (await createThread({ title: 'General' })).id;
}

export async function touchThread(id: string) {
  await supabaseAdmin.from('janet_threads').update({ last_message_at: new Date().toISOString() }).eq('id', id);
}

/** When a thread is attached to a client, load that client's context so she
 *  knows where she is without being told. Standalone threads return null. */
export async function getThreadClientContext(threadId: string): Promise<string | null> {
  const { data: thread } = await supabaseAdmin.from('janet_threads').select('client_id, title').eq('id', threadId).maybeSingle();
  if (!thread?.client_id) return null;
  const { data: client } = await supabaseAdmin.from('janet_clients').select('*').eq('id', thread.client_id).maybeSingle();
  if (!client) return null;
  const [sitesR, dealsR, notesR] = await Promise.all([
    supabaseAdmin.from('janet_sites').select('name, production_url, status, retainer_status, repo_url').eq('client_id', client.id),
    supabaseAdmin.from('janet_deals').select('name, stage, value_estimate, next_action, next_action_due').eq('client_id', client.id),
    supabaseAdmin.from('janet_notepad_sessions').select('title, recap').in('deal_id',
      (await supabaseAdmin.from('janet_deals').select('id').eq('client_id', client.id)).data?.map((d) => d.id) ?? ['00000000-0000-0000-0000-000000000000']
    ).limit(6),
  ]);
  const lines: string[] = [`THIS THREAD IS ABOUT: ${client.name} (${client.status}) — thread "${thread.title}". Center this conversation on them; you already know where you are.`];
  if (client.contact_name || client.contact_email) lines.push(`Contact: ${client.contact_name ?? ''} ${client.contact_email ? `<${client.contact_email}>` : ''}`.trim());
  if (client.approver_name) lines.push(`Designated approver: ${client.approver_name}${client.approver_role ? ` (${client.approver_role})` : ''}`);
  if (client.notes) lines.push(`Notes: ${client.notes}`);
  const sites = sitesR.data ?? [];
  if (sites.length) lines.push(`Sites: ${sites.map((s) => `${s.name} (${s.production_url}) [${s.status}, retainer ${s.retainer_status}]`).join('; ')}`);
  const deals = dealsR.data ?? [];
  if (deals.length) lines.push(`Deals: ${deals.map((d) => `${d.name} [${d.stage}]${d.value_estimate ? ` ~$${Number(d.value_estimate).toLocaleString()}` : ''}${d.next_action ? ` — next: ${d.next_action}` : ''}`).join('; ')}`);
  const notes = (notesR.data ?? []).filter((n) => n.recap);
  if (notes.length) lines.push(`Discovery notes: ${notes.map((n) => n.title).join(', ')}`);
  if (/psrx/i.test(client.name)) lines.push(`(PSRx operational data is live in your BUSINESS SNAPSHOT and the get_psrx_* / analyze_psrx_* tools.)`);
  return lines.join('\n');
}
