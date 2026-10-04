// Client logins vault — the third-party accounts behind a client's site (Resend, Gmail, GoDaddy, Vercel, …).
// Founder-only (admin routes); never exposed to JANET (no tool reads these tables). Secrets are sealed with
// vault.ts before they're stored, listed only as "set / not set", decrypted one field at a time on reveal, and
// every add / change / reveal / delete is written to client_login_events.

import { supabaseAdmin } from './supabase';
import { seal, unseal } from './vault';

export const SECRET_FIELDS = ['password', 'api_key', 'secret_notes'] as const;
export type SecretField = (typeof SECRET_FIELDS)[number];
const COL: Record<SecretField, string> = { password: 'password_enc', api_key: 'api_key_enc', secret_notes: 'secret_notes_enc' };

const nowIso = () => new Date().toISOString();
const clean = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

async function logEvent(e: { login_id: string | null; client_id: string | null; action: 'create' | 'update' | 'reveal' | 'delete'; field?: string | null; service?: string | null; actor: string }) {
  const { error } = await supabaseAdmin.from('client_login_events').insert({ ...e, field: e.field ?? null, service: e.service ?? null });
  if (error) console.error('[client-logins] audit log failed:', error.message);
}

/** A client's logins — no secrets, just whether each is set. */
export async function listLogins(clientId: string) {
  const { data, error } = await supabaseAdmin.from('client_logins')
    .select('id, client_id, site_id, service, login_url, username, notes, password_enc, api_key_enc, secret_notes_enc, updated_at, updated_by, janet_sites(name, production_url)')
    .eq('client_id', clientId).order('service');
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, client_id: r.client_id, site_id: r.site_id, site_name: r.janet_sites?.name ?? null,
    service: r.service, login_url: r.login_url, username: r.username, notes: r.notes,
    has_password: !!r.password_enc, has_api_key: !!r.api_key_enc, has_secret_notes: !!r.secret_notes_enc,
    updated_at: r.updated_at, updated_by: r.updated_by,
  }));
}

export type SaveLoginInput = {
  id?: string | null;
  client_id: string;
  site_id?: string | null;
  service: string;
  login_url?: string | null;
  username?: string | null;
  notes?: string | null;
  /** secret fields: a string replaces it, '' clears it, undefined/null leaves it as is */
  password?: string | null;
  api_key?: string | null;
  secret_notes?: string | null;
};

/** Add or update a login. Secrets are sealed here; leaving a secret blank keeps the current one. */
export async function saveLogin(input: SaveLoginInput, actor: string) {
  const service = clean(input.service, 80);
  if (!service) throw new Error('Name the service (e.g. Resend, Gmail, GoDaddy).');
  const { data: client } = await supabaseAdmin.from('janet_clients').select('id').eq('id', input.client_id).maybeSingle();
  if (!client) throw new Error('No such client.');
  if (input.site_id) {
    const { data: site } = await supabaseAdmin.from('janet_sites').select('id, client_id').eq('id', input.site_id).maybeSingle();
    if (!site || site.client_id !== input.client_id) throw new Error('That site belongs to a different client.');
  }

  const row: Record<string, unknown> = {
    client_id: input.client_id, site_id: input.site_id || null, service,
    login_url: clean(input.login_url, 300), username: clean(input.username, 200), notes: clean(input.notes, 2000),
    updated_at: nowIso(), updated_by: actor,
  };
  const changed: string[] = [];
  for (const f of SECRET_FIELDS) {
    const v = input[f];
    if (v === undefined || v === null) continue;      // untouched
    row[COL[f]] = v === '' ? null : seal(String(v).slice(0, 5000));
    changed.push(f);
  }

  if (input.id) {
    const { data, error } = await supabaseAdmin.from('client_logins').update(row).eq('id', input.id).eq('client_id', input.client_id).select('id').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Login not found.');
    await logEvent({ login_id: data.id, client_id: input.client_id, action: 'update', field: changed.join(',') || null, service, actor });
    return data.id as string;
  }
  const { data, error } = await supabaseAdmin.from('client_logins').insert(row).select('id').single();
  if (error) throw new Error(error.message);
  await logEvent({ login_id: data.id, client_id: input.client_id, action: 'create', field: changed.join(',') || null, service, actor });
  return data.id as string;
}

/** Decrypt ONE secret field of one login for the founder — logged. */
export async function revealSecret(loginId: string, field: SecretField, actor: string) {
  if (!SECRET_FIELDS.includes(field)) throw new Error('Unknown field.');
  const { data } = await supabaseAdmin.from('client_logins').select('id, client_id, service, password_enc, api_key_enc, secret_notes_enc').eq('id', loginId).maybeSingle();
  if (!data) throw new Error('Login not found.');
  const sealed = (data as any)[COL[field]] as string | null;
  if (!sealed) return null;
  const value = unseal(sealed);
  await logEvent({ login_id: data.id, client_id: data.client_id, action: 'reveal', field, service: data.service, actor });
  return value;
}

export async function deleteLogin(loginId: string, clientId: string, actor: string) {
  const { data, error } = await supabaseAdmin.from('client_logins').delete().eq('id', loginId).eq('client_id', clientId).select('id, service').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Login not found.');
  await logEvent({ login_id: data.id, client_id: clientId, action: 'delete', service: data.service, actor });
}
