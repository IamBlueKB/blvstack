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
  {
    name: 'get_clients',
    description:
      'List client accounts — the hubs that sites, deals, and discovery notes roll up to. Use for any question about clients/accounts.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['prospect', 'active', 'past'] } },
    },
    handler: async (input) => {
      let q = supabaseAdmin.from('janet_clients').select('*').order('name');
      const status = (input as any)?.status;
      if (typeof status === 'string') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, clients: data };
    },
  },
  {
    name: 'get_client',
    description:
      'Everything about one client account — their info, designated approver, and all their sites, deals, and discovery-call notes rolled up. Look them up by id or by name.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Client UUID' },
        name: { type: 'string', description: 'Client name (case-insensitive contains match)' },
      },
    },
    handler: async (input) => {
      const id = (input as any)?.id;
      const name = (input as any)?.name;
      let client: any = null;
      if (typeof id === 'string' && id) {
        const { data } = await supabaseAdmin.from('janet_clients').select('*').eq('id', id).maybeSingle();
        client = data;
      } else if (typeof name === 'string' && name) {
        const { data } = await supabaseAdmin.from('janet_clients').select('*').ilike('name', `%${name}%`).limit(1).maybeSingle();
        client = data;
      } else {
        throw new Error('Provide a client id or name.');
      }
      if (!client) return { found: false };
      const [sitesR, dealsR] = await Promise.all([
        supabaseAdmin.from('janet_sites').select('id, name, production_url, status, retainer_status').eq('client_id', client.id),
        supabaseAdmin.from('janet_deals').select('id, name, stage, value_estimate, next_action, next_action_due, notes').eq('client_id', client.id),
      ]);
      const dealIds = (dealsR.data ?? []).map((d) => d.id);
      let discovery_notes: any[] = [];
      if (dealIds.length) {
        const { data } = await supabaseAdmin
          .from('janet_notepad_sessions')
          .select('id, title, status, recap, created_at')
          .in('deal_id', dealIds)
          .order('created_at', { ascending: false });
        discovery_notes = data ?? [];
      }
      return { found: true, client, sites: sitesR.data ?? [], deals: dealsR.data ?? [], discovery_notes };
    },
  },
  {
    name: 'get_leads',
    description:
      'List inbound project leads (the /start intake form, with AI triage). Filter by status. Returns each lead plus its triage (ai_analysis: fit/tier/questions/red flags). Use for any question about inbound leads.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by lead status' },
        limit: { type: 'number', description: 'Max rows (default 25)' },
      },
    },
    handler: async (input) => {
      const limit = optNumber(input, 'limit', 25);
      let q = supabaseAdmin
        .from('leads')
        .select('id, name, business_name, email, phone, website_url, revenue_range, problem, timeline, budget_tier, source, status, urgency, first_response_at, ai_analysis, ai_analyzed_at, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      const status = (input as any)?.status;
      if (typeof status === 'string') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, leads: data };
    },
  },
  {
    name: 'get_lead',
    description: 'Full detail on one inbound lead by id, including the AI triage analysis and notes.',
    ring: 1,
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Lead UUID' } }, required: ['id'] },
    handler: async (input) => {
      const id = requireString(input, 'id');
      const { data, error } = await supabaseAdmin
        .from('leads')
        .select('id, name, business_name, email, phone, website_url, revenue_range, problem, timeline, budget_tier, source, status, urgency, first_response_at, ai_draft_reply, notes, ai_analysis, ai_analyzed_at, created_at')
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    name: 'get_messages',
    description: 'List inbound contact-form messages (contact_messages). Filter by status. Returns sender, message, status, and whether replied.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string' }, limit: { type: 'number', description: 'Max rows (default 25)' } },
    },
    handler: async (input) => {
      const limit = optNumber(input, 'limit', 25);
      let q = supabaseAdmin
        .from('contact_messages')
        .select('id, name, email, message, status, replied_at, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      const status = (input as any)?.status;
      if (typeof status === 'string') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, messages: data };
    },
  },
  {
    name: 'get_message',
    description: 'Full detail on one contact-form message by id, including any draft or sent reply.',
    ring: 1,
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Message UUID' } }, required: ['id'] },
    handler: async (input) => {
      const id = requireString(input, 'id');
      const { data, error } = await supabaseAdmin
        .from('contact_messages')
        .select('id, name, email, message, status, draft_subject, draft_body, replied_at, replied_subject, replied_body, created_at')
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    name: 'get_briefings',
    description: 'List your own past daily briefings (janet_briefings), newest first — date, read state, and summary line. Use to recall what you flagged on prior days.',
    ring: 1,
    input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max rows (default 14)' } } },
    handler: async (input) => {
      const limit = optNumber(input, 'limit', 14);
      const { data, error } = await supabaseAdmin
        .from('janet_briefings')
        .select('briefing_date, read_at, content')
        .order('briefing_date', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return {
        count: data.length,
        briefings: data.map((b) => ({ date: b.briefing_date, read: !!b.read_at, summary: (b.content as any)?.summary ?? null })),
      };
    },
  },
  {
    name: 'get_briefing',
    description: "Read one daily briefing in full — today's by default, or a specific date. Use to answer 'what did today's briefing say'.",
    ring: 1,
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'ISO date YYYY-MM-DD; omit for the latest' } } },
    handler: async (input) => {
      let q = supabaseAdmin.from('janet_briefings').select('briefing_date, content, read_at');
      const date = (input as any)?.date;
      if (typeof date === 'string' && date) q = q.eq('briefing_date', date);
      else q = q.order('briefing_date', { ascending: false });
      const { data, error } = await q.limit(1);
      if (error) throw new Error(error.message);
      if (!data?.length) return { found: false };
      return { found: true, date: data[0].briefing_date, read: !!data[0].read_at, content: data[0].content };
    },
  },
  {
    name: 'get_question_bank',
    description: 'Read the discovery question bank (janet_question_bank) — the standard set and per-deal-type templates you draw prepped questions from, with topic tags and active state.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        deal_type: { type: 'string', enum: ['refresh', 'new_build', 'rescue'] },
        include_inactive: { type: 'boolean' },
      },
    },
    handler: async (input) => {
      let q = supabaseAdmin.from('janet_question_bank').select('id, text, topic, deal_type, sort, active').order('sort');
      if (!(input as any)?.include_inactive) q = q.eq('active', true);
      const dt = (input as any)?.deal_type;
      if (typeof dt === 'string') q = q.eq('deal_type', dt);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, questions: data };
    },
  },
  {
    name: 'get_notepad_session',
    description:
      'Read a discovery notepad session in full — its notes, coverage state, extracted pending fields, blocks, and recap. With no id, lists recent sessions (including standalone ones not attached to a deal). Use to see what was captured on a call, even before it was processed into a deal.',
    ring: 1,
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Session UUID; omit to list recent sessions' } } },
    handler: async (input) => {
      const id = (input as any)?.id;
      if (typeof id === 'string' && id) {
        const { data, error } = await supabaseAdmin.from('janet_notepad_sessions').select('*').eq('id', id).single();
        if (error) throw new Error(error.message);
        return data;
      }
      const { data, error } = await supabaseAdmin
        .from('janet_notepad_sessions')
        .select('id, title, deal_id, deal_type, status, created_at, processed_at')
        .order('created_at', { ascending: false })
        .limit(25);
      if (error) throw new Error(error.message);
      return { count: data.length, sessions: data };
    },
  },
  {
    name: 'check_replies',
    description:
      'Check for recent inbound replies to outbound outreach (last 24h) — prospects that replied or unsubscribed. Read-only; sending anything back stays gated (Ring 3).',
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error, count } = await supabaseAdmin
        .from('prospects')
        .select('id, company_name, contact_name, contact_email, replied_at, status', { count: 'exact' })
        .in('status', ['replied', 'suppressed'])
        .gte('replied_at', since)
        .order('replied_at', { ascending: false });
      if (error) throw new Error(error.message);
      return { matched: count ?? 0, recent: data ?? [], window: 'last 24h' };
    },
  },
  {
    name: 'get_pending_approvals',
    description:
      'List Ring 3 actions you proposed that are still waiting on Blue to approve or reject. These persist across sessions — use this to remind Blue what is blocked on him.',
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const { data, error } = await supabaseAdmin
        .from('janet_pending_approvals')
        .select('id, summary, proposals, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return { count: data.length, pending: data };
    },
  },
  {
    name: 'get_response_stats',
    description:
      'Speed-to-lead stats — response times on leads already replied to (arrival → first response, avg + median) and which leads are aging unanswered. BLVSTACK sells speed; this measures ours.',
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const { data, error } = await supabaseAdmin
        .from('leads')
        .select('name, created_at, first_response_at, status')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const responded = (data ?? []).filter((l) => l.first_response_at);
      const mins = responded
        .map((l) => (new Date(l.first_response_at as string).getTime() - new Date(l.created_at).getTime()) / 60000)
        .filter((m) => m >= 0)
        .sort((a, b) => a - b);
      const avg = mins.length ? Math.round(mins.reduce((s, m) => s + m, 0) / mins.length) : null;
      const median = mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null;
      const now = Date.now();
      const aging = (data ?? [])
        .filter((l) => l.status === 'new' && !l.first_response_at)
        .map((l) => ({ name: l.name, hours: Math.floor((now - new Date(l.created_at).getTime()) / 3_600_000) }))
        .sort((a, b) => b.hours - a.hours);
      return { responded_count: responded.length, avg_response_minutes: avg, median_response_minutes: median, aging_unanswered: aging };
    },
  },
];
