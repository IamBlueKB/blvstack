// JANET Phase 4C — PSRx intelligence layer. Aggregations that turn tables nobody
// reads into money-tied findings. Every function reports its own DATA QUALITY so
// JANET states what she can and cannot see — no invented signal (spec 4C: no vibes).
//
// Reality as of build: analyzer + portal data is almost entirely test/self rows,
// so those aggregations honestly return "insufficient". The lead funnel
// (referral_source × conversion) and the booking-gap finding are real now.

import { psrxSql } from './client';
import { supabaseAdmin } from '../../supabase';

const LAUNCH = '2026-05-01'; // pre-launch rows are manual/test entries

async function suppressedEmails(): Promise<string[]> {
  const { data } = await supabaseAdmin.from('janet_psrx_suppression').select('email');
  return (data ?? []).map((r) => String(r.email ?? '').toLowerCase()).filter(Boolean);
}
const isTestName = (s: string | null) => /\btest\b|riednbdbdj|^ej+$/i.test(s ?? '');

// ── 4C.1 / 4C.2 — analyzer intelligence + temporal ────────────────────
export async function analyzePsrxAnalyzer() {
  const sql = psrxSql();
  const supp = await suppressedEmails();
  const rows = await sql`
    select kirby_desai_score, colors_detected, cover_up, ai_cover_up_flag,
           session_estimate, fitzpatrick, client_name, client_email, created_at
    from tattoo_analyses order by created_at`;
  const real = rows.filter(
    (r: any) =>
      new Date(r.created_at) >= new Date(LAUNCH) &&
      !isTestName(r.client_name) &&
      !(r.client_email && supp.includes(String(r.client_email).toLowerCase()))
  );

  const kirby = real.map((r: any) => r.kirby_desai_score).filter((n: any) => typeof n === 'number');
  const coverUps = real.filter((r: any) => r.cover_up === true || r.ai_cover_up_flag === true).length;
  const colorFreq: Record<string, number> = {};
  const colorKey = (c: any) => (typeof c === 'string' ? c : c?.color ?? c?.name ?? c?.hex ?? JSON.stringify(c));
  for (const r of real) for (const c of Array.isArray(r.colors_detected) ? r.colors_detected : []) { const k = String(colorKey(c)); colorFreq[k] = (colorFreq[k] ?? 0) + 1; }
  const byMonth: Record<string, number> = {};
  for (const r of real) { const m = new Date(r.created_at).toISOString().slice(0, 7); byMonth[m] = (byMonth[m] ?? 0) + 1; }
  const fitz: Record<string, number> = {};
  for (const r of real) if (r.fitzpatrick) fitz[String(r.fitzpatrick)] = (fitz[String(r.fitzpatrick)] ?? 0) + 1;

  return {
    total_rows: rows.length,
    real_analyses: real.length,
    kirby_desai: kirby.length ? { min: Math.min(...kirby), max: Math.max(...kirby), avg: Math.round((kirby.reduce((a, b) => a + b, 0) / kirby.length) * 10) / 10 } : null,
    cover_up_rate_pct: real.length ? Math.round((100 * coverUps) / real.length) : null,
    top_colors: Object.entries(colorFreq).sort((a, b) => b[1] - a[1]).slice(0, 8),
    fitzpatrick_distribution: fitz,
    by_month: byMonth,
    data_quality:
      real.length < 10
        ? `Only ${real.length} real analyses (of ${rows.length} rows — the rest are pre-launch/test/self). Insufficient for reliable pricing/demand patterns. This is a market-research instrument that pays off once real analyses accrue; do NOT infer trends from this yet.`
        : 'sufficient for aggregate patterns',
  };
}

// ── 4C.3 — revenue-per-lead economics (source profitability) ──────────
export async function analyzePsrxRevenueBySource() {
  const sql = psrxSql();
  const rows = await sql`
    select coalesce(referral_source, '(unknown)') as source,
           count(*)::int as leads,
           count(*) filter (where status = 'converted')::int as converted
    from assessment_leads
    where created_at >= ${LAUNCH}
    group by 1 order by leads desc`;
  const by_source = rows.map((r: any) => ({
    source: r.source, leads: r.leads, converted: r.converted,
    conversion_pct: r.leads ? Math.round((100 * r.converted) / r.leads) : 0,
  }));
  return {
    by_source,
    caveat:
      'Conversion = the manual status=\'converted\' flag (clinic-manager set). There is NO $ value per conversion — in-clinic treatment revenue lives in AestheticsPro, which is not reachable (see booking visibility). So this ranks sources by CONVERSION RATE, not profit. To rank by profit you need a treatment-value input (see the booking-gap proxy). Paid-source spend is in meta_campaigns; organic/referral/popup carry no spend.',
  };
}

// ── 4C.4 — portal retention + the assessment→portal funnel break ──────
export async function analyzePsrxPortalRetention() {
  const sql = psrxSql();
  const supp = await suppressedEmails();
  const members = await sql`
    select status, cancelled_at, cancellation_reason, checkin_streak, winback_step,
           subscription_start_date, last_checkin_at, email
    from portal_members`;
  const real = members.filter((m: any) => !(m.email && supp.includes(String(m.email).toLowerCase())));
  const [{ n: realLeads }] = await sql`select count(*)::int as n from assessment_leads where created_at >= ${LAUNCH}`;
  const active = real.filter((m: any) => m.status === 'active').length;
  const cancelled = real.filter((m: any) => m.status === 'cancelled');
  return {
    real_members: real.length,
    active,
    cancelled: cancelled.length,
    churn_reasons: cancelled.map((m: any) => m.cancellation_reason).filter(Boolean),
    funnel_break: { real_assessment_leads: realLeads, real_portal_members: real.length, note: `${realLeads} real assessment leads → ${real.length} real portal member(s)` },
    data_quality:
      real.length < 5
        ? `Only ${real.length} real portal member(s) (test/self excluded) — churn-cause analysis needs volume and isn't possible yet. The signal that IS real and stark: the assessment→portal funnel is near-total loss (${realLeads} leads → ${real.length} subs). Diagnose the funnel break, not churn, for now.`
        : 'sufficient for churn analysis',
  };
}

// ── 4C.5 — reputation + marketing intelligence ────────────────────────
export async function analyzePsrxReputation() {
  const sql = psrxSql();
  const campaigns = await sql`
    select name, objective, status, spend_total, impressions, clicks, conversions
    from meta_campaigns order by spend_total desc nulls last limit 20`;
  return {
    reviews: 'No reviews table in the live PSRx DB — review-language mining (the free high-converting ad copy) is unavailable until reviews are ingested (e.g. a Google Places pull). Flag as an opportunity, do not fabricate quotes.',
    meta_campaigns: campaigns,
    campaign_note: campaigns.length
      ? 'Campaign spend/impressions/clicks are here. To measure campaign performance vs lead QUALITY (not just volume), join to leads by referral_source / UTM — real signal once meta leads carry source tags.'
      : 'No meta_campaigns rows — paid performance data not populated yet.',
  };
}

// ── 4C.6 — the AestheticsPro gap (investigation conclusion) ───────────
export function getPsrxBookingVisibility() {
  return {
    reachable: false,
    finding:
      'Bookings are entirely external. PSRx links out to a hosted AestheticsPro booking widget (web2.myaestheticspro.com/booknow) from its marketing pages. There is NO API integration, webhook, export, or confirmation-email ingestion anywhere in the PSRx codebase. Once a patient clicks "Book Now", PSRx — and therefore JANET — sees nothing about whether they booked, showed, what they were treated for, or what they paid.',
    only_conversion_signal:
      "The sole signal is the manual assessment_leads.status='converted' flag, set by hand by the clinic manager. It carries no dollar value, no treatment type, and no service date.",
    best_available_proxy: [
      'Conversion RATE by referral_source (status=converted / leads) — available now, no dollars.',
      'Shopify orders for retail-product revenue — separate from in-clinic treatment revenue.',
      'To unlock true revenue attribution: either (a) wire AestheticsPro\'s API if it exposes one (a new credential + a PSRx-side build), or (b) add one tiny field so the clinic manager enters an approximate treatment value when marking a lead converted — cheapest path to revenue-per-source.',
    ],
  };
}
