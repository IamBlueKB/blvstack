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
];
