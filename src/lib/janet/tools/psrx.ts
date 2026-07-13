// JANET Phase 4A — PSRx read tools (Ring 1). Read-only reads over the dedicated
// janet_readonly role. She holds the full state of the clinic the way she holds
// BLVSTACK's. No writes exist here (the role can't write); the one PSRx write lane
// (the approval queue) is Phase 4B, separate.

import type { JanetTool } from '../types';
import { psrxConnected } from '../psrx/client';
import {
  getPsrxLeads, getPsrxLead, getPsrxAnalyses, getPsrxPortal,
  getPsrxHealth, getPsrxCampaigns, getPsrxSnapshot,
} from '../psrx/reads';
import {
  getNurtureCandidates, queuePsrxLeadDraft, getPsrxQueue, addPsrxSuppression,
} from '../psrx/nurture';
import {
  analyzePsrxAnalyzer, analyzePsrxRevenueBySource, analyzePsrxPortalRetention,
  analyzePsrxReputation, getPsrxBookingVisibility,
} from '../psrx/intelligence';

function reqString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required input: ${key}`);
  return v;
}
function optNumber(input: unknown, key: string): number | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}
function guard() {
  if (!psrxConnected()) throw new Error('PSRx is not connected in this environment (PSRX_DATABASE_URL not set).');
}

export const psrxTools: JanetTool[] = [
  {
    name: 'get_psrx_overview',
    description:
      "PSRx clinic at a glance — lead funnel counts (total / new-unhandled / non-converted / converted / gone-cold), portal membership (active / at-risk), analyzer volume, and site/health status. Use to answer 'how is PSRx doing' or to lead into deeper reads. PSRx is BLVSTACK's client-one clinic (med spa).",
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      guard();
      return await getPsrxSnapshot();
    },
  },
  {
    name: 'get_psrx_leads',
    description:
      "PSRx inbound assessment leads (their site assessment IS the lead — intake answers + CRM/conversion state in one). Filter by status (new/reviewed/contacted/converted/archived). Returns concerns, goals, timeline, referral_source, nurture_step, converted, contact flags, staff assignment. Use for the funnel and for finding non-converted leads worth following up.",
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'new | reviewed | contacted | converted | archived' },
        limit: { type: 'number', description: 'Max rows (default 25)' },
      },
    },
    handler: async (input) => {
      guard();
      const status = typeof (input as any)?.status === 'string' ? (input as any).status : undefined;
      const rows = await getPsrxLeads({ status, limit: optNumber(input, 'limit') });
      return { count: rows.length, leads: rows };
    },
  },
  {
    name: 'get_psrx_lead',
    description:
      "Full detail on one PSRx lead by id — the complete assessment (concerns, goals, history, fitzpatrick), the AI readouts (client_readout, practitioner_brief), conversion/contact state, and the comms thread (lead_messages). This is what you read to qualify a lead.",
    ring: 1,
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'assessment_leads UUID' } }, required: ['id'] },
    handler: async (input) => {
      guard();
      return await getPsrxLead(reqString(input, 'id'));
    },
  },
  {
    name: 'get_psrx_analyses',
    description:
      "PSRx tattoo-removal analyses — per-analysis colors_detected, wavelengths, kirby_desai_score (difficulty), session_estimate, cover_up flag, ink type/age, fitzpatrick. This is a market-research instrument, not just a lead tool: aggregate it to find demand and pricing signal.",
    ring: 1,
    input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max rows (default 30)' } } },
    handler: async (input) => {
      guard();
      const rows = await getPsrxAnalyses({ limit: optNumber(input, 'limit') });
      return { count: rows.length, analyses: rows };
    },
  },
  {
    name: 'get_psrx_portal',
    description:
      "PSRx $29/mo portal members — tier, status, founding number, engagement (last_login, checkin_streak), and churn signals (at_risk, winback_step, cancelled). Use for retention analysis and the assessment→portal conversion problem. Subscription status is a cached mirror of Recharge.",
    ring: 1,
    input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max rows (default 50)' } } },
    handler: async (input) => {
      guard();
      return await getPsrxPortal({ limit: optNumber(input, 'limit') });
    },
  },
  {
    name: 'get_psrx_health',
    description:
      "PSRx operational health — recent system_health_checks (integration probes: PostHog/Brevo/Shopify/Supabase/Meta) with green/red status and severity, plus the latest uptime probe of the public site. Use to catch a regression on the live patient-facing site before patients do.",
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      guard();
      return await getPsrxHealth();
    },
  },
  {
    name: 'get_psrx_campaigns',
    description:
      "PSRx marketing + reputation — Meta ad campaigns (spend, impressions, clicks, conversions) and Google/other reviews (author, rating, text, source). Cross-reference with treatments and lead quality; mine review language for ad copy.",
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      guard();
      return await getPsrxCampaigns();
    },
  },

  // ── Nurture-lead flow (4B): qualify → draft → queue. She never sends. ──
  {
    name: 'get_psrx_nurture_candidates',
    description:
      "The prioritized queue of PSRx non-converted leads eligible for a follow-up — every hard guardrail already applied (not converted, not in the 14-day cooldown, under the 3-follow-up cap, not on the do-not-contact list, not already queued). Returns each lead's assessment signals (concerns, goals, timeline, referral_source, fitzpatrick), how long since their last touch, and how many JANET follow-ups they've had. This is who to qualify — read the assessment and decide who deserves follow-up. Excluded counts are returned so nothing is silently dropped.",
    ring: 1,
    input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max eligible candidates (default 40)' } } },
    handler: async (input) => {
      guard();
      return await getNurtureCandidates({ limit: optNumber(input, 'limit') });
    },
  },
  {
    name: 'queue_psrx_lead_draft',
    description:
      "Queue a drafted follow-up for the clinic manager to approve (the ONE write lane into PSRx) — or record a 'not qualified / don't chase' decision (qualified=false, no draft). For a qualified lead, provide a personalized draft that references THEIR assessment (concerns/goals/timeline), your proposed cadence and its reasoning, and your confidence. The hard guardrails are re-enforced here in code and will REFUSE a converted lead, a lead inside the 14-day cooldown, one past the 3-follow-up cap, one on the do-not-contact list, or one already queued. Every call is logged to your recommendation ledger. This does NOT send — a human approves, then PSRx's own gated path sends.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'PSRx assessment_leads UUID' },
        qualified: { type: 'boolean', description: 'true = worth a follow-up (queue a draft); false = do not chase (record the reason only)' },
        qualification_reasoning: { type: 'string', description: 'WHY this lead does or does not deserve follow-up — your stated reasoning (feeds the ledger)' },
        proposed_cadence: { type: 'string', description: "The follow-up rhythm, e.g. 'follow up in 5 days' or 'parked until March'" },
        cadence_reasoning: { type: 'string', description: 'Why that cadence, from the assessment signals' },
        draft_subject: { type: 'string', description: 'Draft email subject (required when qualified)' },
        draft_body: { type: 'string', description: 'Draft email body, personalized to their assessment (required when qualified)' },
        confidence: { type: 'number', description: 'Your confidence 0-1 in this qualification call' },
      },
      required: ['lead_id', 'qualified', 'qualification_reasoning'],
    },
    handler: async (input) => {
      guard();
      return await queuePsrxLeadDraft(input as any);
    },
  },
  {
    name: 'get_psrx_queue',
    description:
      'The PSRx approval queue — drafts you have queued and their state (pending / approved / edited / rejected / sent). Filter by status. Use to report what is waiting on the clinic manager and to track outcomes back into your ledger.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'pending | approved | edited | rejected | sent' },
        limit: { type: 'number', description: 'Max rows (default 50)' },
      },
    },
    handler: async (input) => {
      guard();
      const status = typeof (input as any)?.status === 'string' ? (input as any).status : undefined;
      return await getPsrxQueue({ status, limit: optNumber(input, 'limit') });
    },
  },
  {
    name: 'add_psrx_suppression',
    description:
      "Add a PSRx lead (by email and/or lead_id) to your do-not-contact list so you never draft for them again. Use when a lead opts out, replies 'stop', bounces, or the clinic manager says do not contact them. State the reason.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        lead_id: { type: 'string', description: 'PSRx assessment_leads UUID' },
        reason: { type: 'string', description: "e.g. 'opted out', 'manager: do not contact', 'bounced'" },
      },
      required: ['reason'],
    },
    handler: async (input) => {
      guard();
      const email = typeof (input as any)?.email === 'string' ? (input as any).email : undefined;
      const lead_id = typeof (input as any)?.lead_id === 'string' ? (input as any).lead_id : undefined;
      return await addPsrxSuppression({ email, lead_id, reason: reqString(input, 'reason') });
    },
  },

  // ── Intelligence layer (4C): find the money. Every result carries its own
  //    data_quality/caveat — cite it, never invent signal. Pair each real finding
  //    with a drafted deliverable (draft_email/draft_proposal) and log it as a
  //    recommendation (log_recommendation, category revenue_idea/pricing).
  {
    name: 'analyze_psrx_analyzer',
    description:
      "Aggregate the tattoo analyzer as a MARKET-RESEARCH instrument (4C.1/4C.2): Kirby-Desai difficulty distribution, cover-up rate, top colors, fitzpatrick mix, and volume by month (temporal). Surfaces pricing/packaging and seasonal-demand signal. RESPECT the data_quality field — analyzer data is mostly test/self right now; do not infer trends from thin data.",
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => { guard(); return await analyzePsrxAnalyzer(); },
  },
  {
    name: 'analyze_psrx_revenue_sources',
    description:
      "Revenue-per-lead economics (4C.3): assessment leads grouped by referral_source with conversion rate per source — which sources produce converting patients vs tire-kickers, to redirect ad spend. CITE the caveat: conversion is the manual status='converted' flag with NO dollar value (treatment revenue is in AestheticsPro, unreachable). This ranks by conversion rate, not profit.",
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => { guard(); return await analyzePsrxRevenueBySource(); },
  },
  {
    name: 'analyze_psrx_retention',
    description:
      "Portal retention + the assessment→portal funnel break (4C.4): real (test-excluded) member counts, cancellations + reasons, and the stark funnel loss (real leads → real subs). Use the data_quality field — with near-zero real members, diagnose the FUNNEL BREAK (why assessment-takers don't subscribe), not churn.",
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => { guard(); return await analyzePsrxPortalRetention(); },
  },
  {
    name: 'analyze_psrx_reputation',
    description:
      'Reputation + marketing intelligence (4C.5): Meta campaign performance and review availability. Note: the reviews table does not exist in the live DB, so review-language mining is unavailable — flag it as an opportunity, never fabricate quotes.',
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => { guard(); return await analyzePsrxReputation(); },
  },
  {
    name: 'get_psrx_booking_visibility',
    description:
      "The AestheticsPro gap (4C.6): the funnel goes dark at booking. Returns the plain finding that bookings are external (a hosted AestheticsPro link — no API/webhook/export/email ingestion), the only conversion signal (manual status='converted', no $), and the best available proxy. Use this whenever asked to attribute real treatment revenue — say plainly what cannot be seen.",
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => { guard(); return getPsrxBookingVisibility(); },
  },
];
