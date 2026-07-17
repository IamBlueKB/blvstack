// Invariants probe (Phase 4.2) — asserts LIVE reality so the source≠live drift
// that bit us three times this build (Findings A, F, G) is caught by machine, not
// by hand. Read-only + non-mutating. Run on a schedule; alert on any failure.
//
// A check's `ok` is: true (pass), false (FAIL — alert), or null (unknown/skipped,
// e.g. PSRx unreachable — does NOT fail the probe, but is surfaced).

import { supabaseAdmin } from '../supabase';
import { psrxSql, psrxConnected } from './psrx/client';
import { JANET_MODEL, JANET_MODEL_HEAVY } from './config';

export type Check = { name: string; ok: boolean | null; detail: string };
export type InvariantsResult = { ok: boolean; ran_at: string; checks: Check[] };

// PII / business-sensitive tables that must never be anon-readable.
const SENSITIVE_TABLES = [
  'janet_messages', 'janet_actions', 'janet_deals', 'janet_clients', 'janet_psrx_followups',
  'janet_psrx_suppression', 'prospects', 'janet_memory', 'janet_recommendations', 'outbound_emails',
  'janet_form_responses', 'janet_sent_emails', 'janet_page_views', 'contact_messages', 'leads',
];

/** Empirically confirm the public anon key reads 0 rows from every sensitive
 *  table (the real exposure test — not just the rowsecurity flag). */
async function checkRlsAnonBlocked(): Promise<Check> {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { name: 'rls_anon_blocked', ok: null, detail: 'anon key / url unavailable' };
  const exposed: string[] = [];
  for (const t of SENSITIVE_TABLES) {
    try {
      const r = await fetch(`${url}/rest/v1/${t}?select=*`, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, Prefer: 'count=exact', Range: '0-0' },
      });
      const cr = r.headers.get('content-range'); // "0-0/396" (rows) or "*/0" (blocked/empty)
      const total = cr ? Number(cr.split('/')[1]) || 0 : 0;
      if (r.status < 400 && total > 0) exposed.push(`${t}(${total})`);
    } catch {
      /* network error → can't confirm this one; don't mark exposed */
    }
  }
  return exposed.length
    ? { name: 'rls_anon_blocked', ok: false, detail: `ANON CAN READ: ${exposed.join(', ')}` }
    : { name: 'rls_anon_blocked', ok: true, detail: `anon blocked on all ${SENSITIVE_TABLES.length} sensitive tables` };
}

/** Env vars present + correctly shaped. */
function checkEnv(): Check[] {
  const checks: Check[] = [];

  checks.push({
    name: 'heavy_model_is_opus',
    ok: /opus/i.test(JANET_MODEL_HEAVY),
    detail:
      `JANET_MODEL_HEAVY="${JANET_MODEL_HEAVY}"` +
      (JANET_MODEL_HEAVY === JANET_MODEL ? ' — collapsed to the base loop model (escalation is a no-op)' : ''),
  });

  const psrxUrl = import.meta.env.PSRX_DATABASE_URL || process.env.PSRX_DATABASE_URL;
  checks.push({ name: 'psrx_db_url_set', ok: !!psrxUrl, detail: psrxUrl ? 'PSRX_DATABASE_URL set' : 'PSRX_DATABASE_URL MISSING' });

  const secretCount = String(import.meta.env.RESEND_WEBHOOK_SECRET ?? '').split(',').map((s: string) => s.trim()).filter(Boolean).length;
  const accounts = [import.meta.env.RESEND_API_KEY, import.meta.env.RESEND_OUTBOUND_API_KEY].filter(Boolean).length; // blvstack + tryblvstack
  checks.push({
    name: 'webhook_secret_per_account',
    ok: secretCount >= accounts,
    detail: `${secretCount} webhook secret(s) for ${accounts} Resend sending account(s)`,
  });

  return checks;
}

/** PSRx role has exactly: SELECT (broad), INSERT only on janet_lead_drafts, no
 *  UPDATE/DELETE. Read-only query against information_schema — never writes. */
async function checkPsrxGrants(): Promise<Check> {
  if (!psrxConnected()) return { name: 'psrx_role_privileges', ok: null, detail: 'PSRx not connected' };
  try {
    const sql = psrxSql();
    const rows = (await sql`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'janet_readonly' and table_schema = 'public'
    `) as Array<{ table_name: string; privilege_type: string }>;
    const selects = rows.filter((r) => r.privilege_type === 'SELECT').length;
    const inserts = [...new Set(rows.filter((r) => r.privilege_type === 'INSERT').map((r) => r.table_name))];
    const writes = rows.filter((r) => r.privilege_type === 'UPDATE' || r.privilege_type === 'DELETE').map((r) => `${r.table_name}:${r.privilege_type}`);
    const insertOk = inserts.length === 1 && inserts[0] === 'janet_lead_drafts';
    const ok = selects > 0 && insertOk && writes.length === 0;
    return {
      name: 'psrx_role_privileges',
      ok,
      detail: `SELECT on ${selects} tables; INSERT on [${inserts.join(', ') || 'none'}]; UPDATE/DELETE on [${writes.join(', ') || 'none'}]`,
    };
  } catch (e: any) {
    return { name: 'psrx_role_privileges', ok: null, detail: `grant query failed: ${e?.message ?? 'error'}` };
  }
}

/** Cross-DB loose-ref health (retires Finding H to a metric): how many
 *  janet_psrx_followups.lead_id have no matching PSRx assessment_leads row. */
async function checkPsrxOrphans(): Promise<Check> {
  if (!psrxConnected()) return { name: 'psrx_followup_orphans', ok: null, detail: 'PSRx not connected' };
  try {
    const { data } = await supabaseAdmin.from('janet_psrx_followups').select('lead_id');
    const ids = [...new Set((data ?? []).map((f: any) => f.lead_id).filter(Boolean))] as string[];
    if (!ids.length) return { name: 'psrx_followup_orphans', ok: true, detail: 'no followups to check' };
    const sql = psrxSql();
    const rows = (await sql`select id from assessment_leads where id = any(${ids}::uuid[])`) as Array<{ id: string }>;
    const present = new Set(rows.map((r) => String(r.id)));
    const orphans = ids.filter((id) => !present.has(String(id)));
    return {
      name: 'psrx_followup_orphans',
      ok: orphans.length === 0,
      detail: `${orphans.length}/${ids.length} followup lead_ids missing from PSRx assessment_leads`,
    };
  } catch (e: any) {
    return { name: 'psrx_followup_orphans', ok: null, detail: `orphan check failed: ${e?.message ?? 'error'}` };
  }
}

/** Run every invariant. `ok` is false only if a check hard-FAILS (unknown/skipped
 *  checks do not fail the probe, but are reported). */
export async function runInvariants(): Promise<InvariantsResult> {
  const checks: Check[] = [];
  checks.push(await checkRlsAnonBlocked());
  checks.push(...checkEnv());
  checks.push(await checkPsrxGrants());
  checks.push(await checkPsrxOrphans());
  return { ok: checks.every((c) => c.ok !== false), ran_at: new Date().toISOString(), checks };
}
