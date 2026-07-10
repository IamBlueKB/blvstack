// JANET v1 — Ring 1 read tools (spec §6)
// All reads, no approval, no mutation. Logged only on failure (registry handles that).
// web_search / web_fetch are Anthropic server-side tools, added in brain.ts — not here.

import { supabaseAdmin } from '../../supabase';
import type { JanetTool } from '../types';

function requireString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v) throw new Error(`Missing required input: ${key}`);
  return v;
}

function optNumber(input: unknown, key: string, fallback: number): number {
  const v = (input as any)?.[key];
  return typeof v === 'number' && v > 0 ? Math.min(v, 100) : fallback;
}

export const ring1Tools: JanetTool[] = [
  {
    name: 'get_deals',
    description:
      'List deals in the pipeline. Filter by stage or staleness. Use this to answer any question about the deal pipeline, stalled deals, or upcoming next actions.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: [
            'inquiry', 'discovery_scheduled', 'discovery_done', 'proposal_sent',
            'negotiating', 'won', 'building', 'delivered', 'lost',
          ],
          description: 'Only deals in this stage',
        },
        stale_days: {
          type: 'number',
          description: 'Only deals not updated in at least this many days',
        },
      },
    },
    handler: async (input) => {
      let q = supabaseAdmin
        .from('janet_deals')
        .select('id, name, contact_name, contact_email, source, referred_by, stage, value_estimate, next_action, next_action_due, notes, outcome, outcome_reason, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(50);
      const stage = (input as any)?.stage;
      if (typeof stage === 'string') q = q.eq('stage', stage);
      const staleDays = (input as any)?.stale_days;
      if (typeof staleDays === 'number' && staleDays > 0) {
        const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();
        q = q.lt('updated_at', cutoff);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, deals: data };
    },
  },
  {
    name: 'get_deal',
    description: 'Full detail for one deal by id, including notes and linked site.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Deal UUID' } },
      required: ['id'],
    },
    handler: async (input) => {
      const id = requireString(input, 'id');
      const { data, error } = await supabaseAdmin
        .from('janet_deals')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    name: 'get_sites',
    description:
      'List the connected-site portfolio (client builds under monitoring) with retainer status and latest scan summary.',
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const [sitesRes, scansRes] = await Promise.all([
        supabaseAdmin.from('janet_sites').select('*').order('created_at'),
        supabaseAdmin
          .from('janet_site_scans')
          .select('site_id, scan_type, passed, failed, score, created_at')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (sitesRes.error) throw new Error(sitesRes.error.message);
      const latestBySite = new Map<string, any>();
      for (const s of scansRes.data ?? []) {
        if (!latestBySite.has(s.site_id)) latestBySite.set(s.site_id, s);
      }
      return {
        count: sitesRes.data.length,
        sites: sitesRes.data.map((s) => ({ ...s, latest_scan: latestBySite.get(s.id) ?? null })),
      };
    },
  },
  {
    name: 'get_site_scans',
    description: 'Scan history for one site, newest first. Use to spot regressions over time.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site UUID' },
        limit: { type: 'number', description: 'Max scans to return (default 10)' },
      },
      required: ['site_id'],
    },
    handler: async (input) => {
      const siteId = requireString(input, 'site_id');
      const limit = optNumber(input, 'limit', 10);
      const { data, error } = await supabaseAdmin
        .from('janet_site_scans')
        .select('*')
        .eq('site_id', siteId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return { count: data.length, scans: data };
    },
  },
  {
    name: 'get_prospects',
    description:
      'List outbound prospects (SunResponse cold-outreach pipeline). Filter by status or niche. Returns research summaries, not full research blobs.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [
            'new', 'researched', 'composed', 'queued', 'sent',
            'follow_up_1', 'follow_up_2', 'follow_up_3',
            'replied', 'booked', 'dead', 'suppressed',
          ],
        },
        niche: { type: 'string', description: "Niche slug, e.g. 'solar'" },
        limit: { type: 'number', description: 'Max rows (default 25)' },
      },
    },
    handler: async (input) => {
      const limit = optNumber(input, 'limit', 25);
      let q = supabaseAdmin
        .from('prospects')
        .select('id, company_name, company_url, contact_name, contact_email, status, niche, disqualified, disqualified_reason, pain_points, last_sent_at, replied_at, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      const status = (input as any)?.status;
      if (typeof status === 'string') q = q.eq('status', status);
      const niche = (input as any)?.niche;
      if (typeof niche === 'string') q = q.eq('niche', niche);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, prospects: data };
    },
  },
  {
    name: 'get_replies',
    description:
      'Recent inbound replies to outbound emails — prospects whose status is replied, newest first, with their send history.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max rows (default 10)' } },
    },
    handler: async (input) => {
      const limit = optNumber(input, 'limit', 10);
      const { data, error } = await supabaseAdmin
        .from('prospects')
        .select('id, company_name, contact_name, contact_email, niche, replied_at, last_sent_at, follow_up_count')
        .eq('status', 'replied')
        .order('replied_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return { count: data.length, replies: data };
    },
  },
  {
    name: 'get_memory',
    description: 'Read your own memory entries. Filter by category.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['preference', 'pricing', 'playbook', 'correction', 'fact'],
        },
        include_inactive: { type: 'boolean', description: 'Include deactivated entries' },
      },
    },
    handler: async (input) => {
      let q = supabaseAdmin
        .from('janet_memory')
        .select('id, category, content, source, active, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (!(input as any)?.include_inactive) q = q.eq('active', true);
      const category = (input as any)?.category;
      if (typeof category === 'string') q = q.eq('category', category);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, memories: data };
    },
  },
  {
    name: 'get_recent_actions',
    description:
      'Read your own audit trail (janet_actions) — what tools you ran, with ring, status, and approval. Read-only; you cannot write to this table.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max rows (default 20)' } },
    },
    handler: async (input) => {
      const limit = optNumber(input, 'limit', 20);
      const { data, error } = await supabaseAdmin
        .from('janet_actions')
        .select('id, tool_name, ring, status, approved_by_user, output_summary, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return { count: data.length, actions: data };
    },
  },
];
