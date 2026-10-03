// Client-site hosting control — pause a client's website (non-payment, or by hand) and bring it back.
//
// Pausing puts ONE Vercel Firewall rule on the site's own Vercel project: every request gets a temporary (307)
// redirect to BLVSTACK's neutral holding page (/unavailable). Restoring removes the rule. The site's code,
// deployments and data are never touched — it's a single reversible switch that takes effect in seconds.
// Verified on a throwaway project 2026-10-03: rule on → 307 to the holding page in ~4s; rule off → site back.
//
// Credentials: VERCEL_SITES_TOKEN (team-wide access token, production env only) + VERCEL_TEAM_ID.

import { supabaseAdmin } from '../../supabase';
import { logJanetAction } from '../actions';

const env = (import.meta as any).env ?? {};
const BASE = env.PUBLIC_SITE_URL || 'https://blvstack.com';
const RULE_NAME = 'blvstack-suspension';
const nowIso = () => new Date().toISOString();

export const hostOf = (url: string) => {
  try { return new URL(url).host; } catch { return url; }
};

async function vercel(path: string, init: RequestInit = {}) {
  const token = env.VERCEL_SITES_TOKEN as string | undefined;
  const team = env.VERCEL_TEAM_ID as string | undefined;
  if (!token || !team) throw new Error('Site pausing isn’t configured on this environment (VERCEL_SITES_TOKEN / VERCEL_TEAM_ID).');
  const res = await fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${team}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err: any = new Error(`Vercel ${res.status}: ${body?.error?.message ?? String(text).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/** A Vercel project by id or name → its id (used when Blue links a site). */
export async function resolveVercelProject(idOrName: string): Promise<{ id: string; name: string }> {
  const p = await vercel(`/v9/projects/${encodeURIComponent(idOrName.trim())}`);
  return { id: p.id, name: p.name };
}

async function findRule(projectId: string) {
  try {
    const cfg = await vercel(`/v1/security/firewall/config/active?projectId=${projectId}`);
    return ((cfg?.rules ?? []) as any[]).find((r) => r.name === RULE_NAME) ?? null;
  } catch (e: any) {
    if (e.status === 404) return null; // no firewall config yet = no rule
    throw e;
  }
}

function suspensionRule(site: any) {
  const location = `${BASE}/unavailable?site=${encodeURIComponent(hostOf(site.production_url))}`;
  return {
    name: RULE_NAME,
    description: 'Site paused by BLVSTACK',
    active: true,
    conditionGroup: [{ conditions: [{ type: 'path', op: 'pre', value: '/' }] }],
    action: { mitigate: { action: 'redirect', redirect: { location, permanent: false } } },
  };
}

/** Pause a client's site: every visit goes to BLVSTACK's holding page until it's restored. */
export async function suspendSite(siteId: string, opts: { reason: string; actor: string }) {
  const { data: site } = await supabaseAdmin.from('janet_sites').select('*').eq('id', siteId).maybeSingle();
  if (!site) throw new Error(`No site with id ${siteId}.`);
  if (!site.vercel_project_id) throw new Error(`${site.name} isn’t linked to its Vercel project yet — link it on the site page first.`);
  if (site.suspended_at) return { site, already: true };

  let rule = await findRule(site.vercel_project_id);
  if (!rule) {
    const insert = () => vercel(`/v1/security/firewall/config?projectId=${site.vercel_project_id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'rules.insert', id: null, value: suspensionRule(site) }),
    });
    try {
      await insert();
    } catch (e: any) {
      // A project whose firewall is switched off can't take custom rules — switch it on, then add the rule.
      await vercel(`/v1/security/firewall/config?projectId=${site.vercel_project_id}`, { method: 'PATCH', body: JSON.stringify({ action: 'firewallEnabled', id: null, value: true }) }).catch(() => { throw e; });
      await insert();
    }
    rule = await findRule(site.vercel_project_id);
  }

  const { data, error } = await supabaseAdmin.from('janet_sites')
    .update({ suspended_at: nowIso(), suspended_reason: opts.reason, suspension_rule_id: rule?.id ?? null })
    .eq('id', siteId).select().single();
  if (error) throw new Error(error.message);
  await logJanetAction({ tool_name: 'suspend_site', ring: 3, input: { site_id: siteId, reason: opts.reason, actor: opts.actor }, output_summary: `Paused ${site.name} (${site.production_url}) — ${opts.reason}`, status: 'completed' });
  return { site: data, already: false };
}

/** Bring a paused site back (removes the redirect rule). */
export async function restoreSite(siteId: string, opts: { actor: string; why?: string }) {
  const { data: site } = await supabaseAdmin.from('janet_sites').select('*').eq('id', siteId).maybeSingle();
  if (!site) throw new Error(`No site with id ${siteId}.`);
  if (!site.suspended_at) return { site, already: true };

  if (site.vercel_project_id) {
    const rule = site.suspension_rule_id ? { id: site.suspension_rule_id } : await findRule(site.vercel_project_id);
    if (rule?.id) {
      try {
        await vercel(`/v1/security/firewall/config?projectId=${site.vercel_project_id}`, { method: 'PATCH', body: JSON.stringify({ action: 'rules.remove', id: rule.id, value: null }) });
      } catch (e: any) {
        // the stored id went stale (rule edited/recreated) — remove by name instead; a missing rule is already "restored"
        const byName = await findRule(site.vercel_project_id);
        if (byName?.id) await vercel(`/v1/security/firewall/config?projectId=${site.vercel_project_id}`, { method: 'PATCH', body: JSON.stringify({ action: 'rules.remove', id: byName.id, value: null }) });
        else if (e.status !== 404) throw e;
      }
    }
  }

  const { data, error } = await supabaseAdmin.from('janet_sites')
    .update({ suspended_at: null, suspended_reason: null, suspension_rule_id: null })
    .eq('id', siteId).select().single();
  if (error) throw new Error(error.message);
  await logJanetAction({ tool_name: 'restore_site', ring: 3, input: { site_id: siteId, actor: opts.actor }, output_summary: `Restored ${site.name} (${site.production_url})${opts.why ? ` — ${opts.why}` : ''}`, status: 'completed' });
  return { site: data, already: false };
}
