// JANET Phase 4A — PSRx typed reads. Shaped to how she reasons about the clinic,
// not 1:1 per table. All read-only. Reusable shape, but deliberately NOT a generic
// connector — deep integration is a one-off for owned properties (spec 4A.1).

import { psrxSql, psrxConnected } from './client';
import { supabaseAdmin } from '../../supabase';

const clampLimit = (n: number | undefined, def: number, max = 100) =>
  Math.min(Math.max(typeof n === 'number' && n > 0 ? n : def, 1), max);

// ─── Leads / assessments ──────────────────────────────────────────────
export async function getPsrxLeads(opts: { status?: string; limit?: number } = {}) {
  const sql = psrxSql();
  const limit = clampLimit(opts.limit, 25);
  const rows = opts.status
    ? await sql`
        select id, first_name, last_name, email, status, primary_concern, concerns, goals,
               timeline, referral_source, fitzpatrick, assigned_staff_id, follow_up_due_at,
               follow_up_sent, staff_contacted, staff_contacted_at, contacted_via_email,
               contacted_via_call, contacted_via_text, contacted_at, last_contact_method, created_at
        from assessment_leads where status = ${opts.status}
        order by created_at desc limit ${limit}`
    : await sql`
        select id, first_name, last_name, email, status, primary_concern, concerns, goals,
               timeline, referral_source, fitzpatrick, assigned_staff_id, follow_up_due_at,
               follow_up_sent, staff_contacted, staff_contacted_at, contacted_via_email,
               contacted_via_call, contacted_via_text, contacted_at, last_contact_method, created_at
        from assessment_leads
        order by created_at desc limit ${limit}`;
  return rows;
}

/** Full detail on one lead — the assessment content, AI readouts, conversion/contact
 *  state, and the comms thread. This is what she reads to qualify a lead (4B). */
export async function getPsrxLead(id: string) {
  const sql = psrxSql();
  const [lead] = await sql`select * from assessment_leads where id = ${id} limit 1`;
  if (!lead) return { found: false };
  const messages = await sql`
    select channel, direction, subject, body, status, sent_by, created_at
    from lead_messages where lead_id = ${id} order by created_at desc limit 20`;
  return { found: true, lead, messages };
}

// ─── Analyzer (tattoo; skin analyzer wires the same way when it lands) ─
export async function getPsrxAnalyses(opts: { limit?: number } = {}) {
  const sql = psrxSql();
  const limit = clampLimit(opts.limit, 30);
  return await sql`
    select id, client_name, assessment_lead_id, fitzpatrick, tattoo_location, tattoo_size,
           ink_type, ink_age, scarring, cover_up, colors_detected, wavelengths,
           kirby_desai_score, session_estimate, ai_cover_up_flag, consent_logged_at, email_sent, created_at
    from tattoo_analyses order by created_at desc limit ${limit}`;
}

// ─── Portal ($29/mo) ──────────────────────────────────────────────────
export async function getPsrxPortal(opts: { limit?: number } = {}) {
  const sql = psrxSql();
  const limit = clampLimit(opts.limit, 50);
  const members = await sql`
    select id, first_name, last_name, email, tier, status, founding_member_number,
           founding_rate_ends_at, subscription_start_date, next_billing_date, cancelled_at,
           cancellation_reason, last_login_at, last_checkin_at, checkin_streak,
           winback_step, winback_converted
    from portal_members order by subscription_start_date desc nulls last limit ${limit}`;
  return { members };
}

// ─── Operational health ───────────────────────────────────────────────
export async function getPsrxHealth() {
  const sql = psrxSql();
  const health = await sql`
    select check_name, status, http_code, error_detail, severity, ran_at
    from system_health_checks order by ran_at desc limit 12`;
  const [uptime] = await sql`
    select url, status_code, response_time_ms, is_up, error_detail, ran_at
    from uptime_checks order by ran_at desc limit 1`;
  return { health, latest_uptime: uptime ?? null };
}

// ─── Marketing / reputation ───────────────────────────────────────────
export async function getPsrxCampaigns() {
  const sql = psrxSql();
  const campaigns = await sql`
    select name, objective, status, spend_total, impressions, clicks, conversions,
           start_date, end_date, created_at
    from meta_campaigns order by created_at desc limit 20`;
  // Note: a `reviews` table does not exist in the live PSRx DB (repo has code for
  // one, but it was never provisioned). Reputation reads land when it exists.
  return { campaigns };
}

// ─── Compact snapshot data (drives the business-snapshot PSRx block) ───
export type PsrxSnapshot = {
  connected: boolean;
  leads: { total: number; new_unhandled: number; non_converted: number; converted: number; aging_cold: number };
  portal: { total: number; active: number; at_risk: number };
  nurture: { eligible: number; pending_drafts: number };
  analyses: { total: number };
  health: { red_checks: number; site_up: boolean | null; last_check_at: string | null };
  attention: string[];
};

/** One round-trip-ish digest for the snapshot. Never throws — degrades to
 *  connected:false so the snapshot simply omits PSRx on any failure. */
export async function getPsrxSnapshot(): Promise<PsrxSnapshot> {
  const empty: PsrxSnapshot = {
    connected: false,
    leads: { total: 0, new_unhandled: 0, non_converted: 0, converted: 0, aging_cold: 0 },
    portal: { total: 0, active: 0, at_risk: 0 },
    nurture: { eligible: 0, pending_drafts: 0 },
    analyses: { total: 0 },
    health: { red_checks: 0, site_up: null, last_check_at: null },
    attention: [],
  };
  if (!psrxConnected()) return empty;
  try {
    const sql = psrxSql();
    // Exclude JANET's do-not-contact / test-self identities from real counts.
    const { data: supp } = await supabaseAdmin.from('janet_psrx_suppression').select('email');
    const suppressed = (supp ?? []).map((r) => String(r.email ?? '').toLowerCase()).filter(Boolean);
    // ONE round-trip. Concurrent queries (Promise.all) pipeline onto a single
    // connection and deadlock against the Supavisor transaction pooler, so the
    // whole digest is a single statement of scalar subqueries.
    // NB: the live PSRx DB has no `converted`/`nurture_step`/`at_risk` columns
    // (those repo migrations were never applied) — conversion is status='converted',
    // at-risk is derived from check-in recency.
    const [r] = await sql`
      select
        (select count(*) from assessment_leads)::int as leads_total,
        (select count(*) from assessment_leads where status = 'new')::int as leads_new,
        (select count(*) from assessment_leads where status not in ('converted','archived'))::int as leads_non_converted,
        (select count(*) from assessment_leads where status = 'converted')::int as leads_converted,
        (select count(*) from assessment_leads where status in ('new','reviewed','contacted')
              and created_at < now() - interval '14 days')::int as leads_aging_cold,
        (select count(*) from portal_members where not (lower(email) = any(${suppressed})))::int as portal_total,
        (select count(*) from portal_members where status = 'active' and not (lower(email) = any(${suppressed})))::int as portal_active,
        (select count(*) from portal_members where status = 'active' and not (lower(email) = any(${suppressed}))
              and (last_checkin_at < now() - interval '30 days'
                   or (last_checkin_at is null and subscription_start_date < now() - interval '30 days')))::int as portal_at_risk,
        (select count(*) from assessment_leads l where l.status not in ('converted','archived')
              and l.created_at >= '2026-05-01'
              and not (lower(l.email) = any(${suppressed}))
              and exists (select 1 from lead_messages m where m.lead_id = l.id and m.direction = 'outbound')
              and not exists (select 1 from lead_messages m where m.lead_id = l.id and (m.bounced_at is not null or m.unsubscribed_at is not null))
              and not exists (select 1 from portal_members pm where lower(pm.email) = lower(l.email))
              and greatest(coalesce((select max(m.created_at) from lead_messages m where m.lead_id = l.id and m.direction = 'outbound'), to_timestamp(0)), coalesce(l.contacted_at, to_timestamp(0))) < now() - interval '14 days'
              and (select count(*) from janet_lead_drafts d where d.lead_id = l.id and d.status in ('pending','approved','sent')) < 3
              and not exists (select 1 from janet_lead_drafts d where d.lead_id = l.id and d.status = 'pending'))::int as nurture_eligible,
        (select count(*) from janet_lead_drafts where status = 'pending')::int as pending_drafts,
        (select count(*) from tattoo_analyses)::int as analyses_total,
        (select count(*) from system_health_checks where status = 'red' and ran_at > now() - interval '2 days')::int as health_red,
        (select max(ran_at) from system_health_checks) as health_last_at,
        (select is_up from uptime_checks order by ran_at desc limit 1) as site_up`;

    const snap: PsrxSnapshot = {
      connected: true,
      leads: {
        total: r.leads_total, new_unhandled: r.leads_new,
        non_converted: r.leads_non_converted, converted: r.leads_converted, aging_cold: r.leads_aging_cold,
      },
      portal: { total: r.portal_total, active: r.portal_active, at_risk: r.portal_at_risk },
      nurture: { eligible: r.nurture_eligible, pending_drafts: r.pending_drafts },
      analyses: { total: r.analyses_total },
      health: {
        red_checks: r.health_red ?? 0,
        site_up: r.site_up === null || r.site_up === undefined ? null : r.site_up,
        last_check_at: r.health_last_at ? new Date(r.health_last_at).toISOString().slice(0, 10) : null,
      },
      attention: [],
    };

    // What needs attention — surfaced so she leads with it, no tool call needed.
    if (snap.leads.new_unhandled > 0) snap.attention.push(`${snap.leads.new_unhandled} new PSRx lead(s) unhandled`);
    if (snap.nurture.pending_drafts > 0) snap.attention.push(`${snap.nurture.pending_drafts} follow-up draft(s) awaiting clinic-manager approval`);
    if (snap.nurture.eligible > 0) snap.attention.push(`${snap.nurture.eligible} non-converted lead(s) eligible for follow-up (qualify + draft)`);
    if (snap.portal.at_risk > 0) snap.attention.push(`${snap.portal.at_risk} portal member(s) at churn risk (no check-in 30d+)`);
    if (snap.health.red_checks > 0) snap.attention.push(`${snap.health.red_checks} PSRx health check(s) red`);
    if (snap.health.site_up === false) snap.attention.push('PSRx site is DOWN (latest uptime check failed)');
    if (snap.leads.total > 0 && snap.portal.total >= 0 && snap.leads.total > snap.portal.total * 10)
      snap.attention.push(`funnel gap: ${snap.leads.total} leads vs ${snap.portal.total} portal member(s)`);

    return snap;
  } catch (err) {
    console.error('[janet] PSRx snapshot failed:', err);
    return empty;
  }
}
