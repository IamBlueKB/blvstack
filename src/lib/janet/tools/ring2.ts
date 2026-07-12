// JANET v1 — Ring 2 tools (spec §6): reversible internal writes. Executed
// without per-action approval, but ALWAYS logged to janet_actions (the registry
// handles logging). Nothing here leaves BLVSTACK's walls or touches a real
// person — that's Ring 3.
//
// Audit-engine tools (run_site_scan, run_url_audit) are Phase 5.

import { supabaseAdmin } from '../../supabase';
import { anthropic } from '../../anthropic';
import { JANET_MODEL, JANET_MODEL_HEAVY, usdCostOf } from '../config';
import type { JanetTool } from '../types';

function reqString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required input: ${key}`);
  return v;
}
function optString(input: unknown, key: string): string | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}
function optNumber(input: unknown, key: string): number | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

const DEAL_STAGES = [
  'inquiry', 'discovery_scheduled', 'discovery_done', 'proposal_sent',
  'negotiating', 'won', 'building', 'delivered', 'lost',
] as const;

/** Draft text via the JANET model (nested call) — used by the draft_* tools. */
async function draftWithClaude(
  system: string,
  user: string,
  maxTokens = 1200,
  model: string = JANET_MODEL
): Promise<{ text: string; usage: any }> {
  const resp = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();
  return { text, usage: resp.usage };
}

export const ring2Tools: JanetTool[] = [
  {
    name: 'create_deal',
    description:
      'Create a new deal in the pipeline (a new inquiry or referral). Use when Blue mentions a new lead you should track. Returns the created deal.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "Short deal name, e.g. 'Interior design refresh — Dana'" },
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        source: { type: 'string', enum: ['referral', 'inbound', 'outbound', 'network'] },
        referred_by: { type: 'string' },
        stage: { type: 'string', enum: DEAL_STAGES as unknown as string[] },
        value_estimate: { type: 'number', description: 'USD estimate' },
        next_action: { type: 'string' },
        notes: { type: 'string' },
        client_id: { type: 'string', description: 'Attach to a client account (janet_clients id)' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const row = {
        name: reqString(input, 'name'),
        contact_name: optString(input, 'contact_name') ?? null,
        contact_email: optString(input, 'contact_email') ?? null,
        source: optString(input, 'source') ?? null,
        referred_by: optString(input, 'referred_by') ?? null,
        stage: optString(input, 'stage') ?? 'inquiry',
        value_estimate: optNumber(input, 'value_estimate') ?? null,
        next_action: optString(input, 'next_action') ?? null,
        notes: optString(input, 'notes') ?? null,
        client_id: optString(input, 'client_id') ?? null,
      };
      const { data, error } = await supabaseAdmin.from('janet_deals').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { created: true, deal: data };
    },
  },
  {
    name: 'update_deal',
    description:
      "Update a deal — stage, next action, notes, value, or close outcome. Use to move a deal through the pipeline or record what changed. Set outcome to 'won'/'lost' with a reason when a deal closes.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Deal UUID' },
        stage: { type: 'string', enum: DEAL_STAGES as unknown as string[] },
        next_action: { type: 'string' },
        next_action_due: { type: 'string', description: 'ISO date (YYYY-MM-DD)' },
        value_estimate: { type: 'number' },
        notes: { type: 'string', description: 'Replaces the notes field' },
        outcome: { type: 'string', enum: ['won', 'lost'] },
        outcome_reason: { type: 'string' },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const stage = optString(input, 'stage');
      if (stage) patch.stage = stage;
      const nextAction = optString(input, 'next_action');
      if (nextAction !== undefined) patch.next_action = nextAction;
      const due = optString(input, 'next_action_due');
      if (due) patch.next_action_due = due;
      const val = optNumber(input, 'value_estimate');
      if (val !== undefined) patch.value_estimate = val;
      const notes = optString(input, 'notes');
      if (notes !== undefined) patch.notes = notes;
      const outcome = optString(input, 'outcome');
      if (outcome) {
        patch.outcome = outcome;
        patch.outcome_reason = optString(input, 'outcome_reason') ?? null;
        patch.outcome_at = new Date().toISOString();
      }
      const { data, error } = await supabaseAdmin.from('janet_deals').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { updated: true, deal: data };
    },
  },
  {
    name: 'add_memory',
    description:
      "Record something learned or a preference Blue stated, so it persists across sessions. ALWAYS use this when Blue corrects you or tells you how he wants something done. Categories: 'preference', 'pricing', 'playbook', 'correction', 'fact'.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['preference', 'pricing', 'playbook', 'correction', 'fact'] },
        content: { type: 'string', description: 'The memory in plain language' },
        source: { type: 'string', description: "How it was learned, e.g. 'Blue said, 2026-07-09'" },
      },
      required: ['category', 'content'],
    },
    handler: async (input) => {
      const row = {
        category: reqString(input, 'category'),
        content: reqString(input, 'content'),
        source: optString(input, 'source') ?? 'conversation',
      };
      const { data, error } = await supabaseAdmin.from('janet_memory').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { saved: true, memory: data };
    },
  },
  {
    name: 'create_site',
    description:
      'Register a site in the portfolio (a new build or an existing one to monitor). Returns the created site.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        production_url: { type: 'string' },
        client_name: { type: 'string' },
        repo_url: { type: 'string' },
        status: { type: 'string', enum: ['active', 'development', 'archived'] },
        notes: { type: 'string' },
        client_id: { type: 'string', description: 'Attach to a client account (janet_clients id)' },
      },
      required: ['name', 'production_url'],
    },
    handler: async (input) => {
      const row = {
        name: reqString(input, 'name'),
        production_url: reqString(input, 'production_url'),
        client_name: optString(input, 'client_name') ?? null,
        repo_url: optString(input, 'repo_url') ?? null,
        status: optString(input, 'status') ?? 'active',
        notes: optString(input, 'notes') ?? null,
        client_id: optString(input, 'client_id') ?? null,
      };
      const { data, error } = await supabaseAdmin.from('janet_sites').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { created: true, site: data };
    },
  },
  {
    name: 'update_site',
    description:
      "Update a connected site — fix its name, status, client, repo, retainer status/amount, or notes. Use when a site's details are wrong or change (e.g. correcting a misspelled name).",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Site UUID' },
        name: { type: 'string' },
        production_url: { type: 'string' },
        client_name: { type: 'string' },
        repo_url: { type: 'string' },
        status: { type: 'string', enum: ['active', 'development', 'archived'] },
        retainer_status: { type: 'string', enum: ['none', 'pitched', 'active'] },
        retainer_monthly: { type: 'number' },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const patch: Record<string, unknown> = {};
      for (const key of ['name', 'production_url', 'client_name', 'repo_url', 'status', 'retainer_status', 'notes'] as const) {
        const v = optString(input, key);
        if (v !== undefined) patch[key] = v;
      }
      const rm = optNumber(input, 'retainer_monthly');
      if (rm !== undefined) patch.retainer_monthly = rm;
      if (Object.keys(patch).length === 0) throw new Error('Nothing to update — provide at least one field.');
      const { data, error } = await supabaseAdmin.from('janet_sites').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { updated: true, site: data };
    },
  },
  {
    name: 'draft_email',
    description:
      'Draft an email WITHOUT sending it (draft ≠ send). Use to compose a reply or follow-up for Blue to review. Returns { to, subject, body }. To actually send, propose send_email after Blue approves the draft.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email, if known' },
        brief: { type: 'string', description: 'What the email should say / the goal' },
        deal_id: { type: 'string', description: 'Optional deal for context' },
      },
      required: ['brief'],
    },
    handler: async (input) => {
      const brief = reqString(input, 'brief');
      const to = optString(input, 'to');
      let context = '';
      const dealId = optString(input, 'deal_id');
      if (dealId) {
        const { data } = await supabaseAdmin.from('janet_deals').select('*').eq('id', dealId).single();
        if (data) context = `\n\nDeal context:\n${JSON.stringify(data)}`;
      }
      const { text } = await draftWithClaude(
        "You draft short, direct emails as Blue, founder of BLVSTACK. Plain, warm, no fluff, no marketing-speak. Return ONLY the email in the form:\nSubject: <line>\n\n<body>\nSign off as 'Blue'.",
        `Brief: ${brief}${to ? `\nTo: ${to}` : ''}${context}`,
        700
      );
      const m = /^\s*Subject:\s*(.+?)\n([\s\S]*)$/i.exec(text);
      const subject = m ? m[1].trim() : '(no subject)';
      const body = m ? m[2].trim() : text;
      return { to: to ?? null, subject, body };
    },
  },
  {
    name: 'draft_proposal',
    description:
      "Generate a scope + proposal draft for a deal, from its notes and Blue's pricing memory. Use after a discovery call. Returns the proposal text for Blue to review. Does NOT send.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Deal UUID' },
        notes: { type: 'string', description: 'Discovery notes to scope from (optional if the deal already has notes)' },
      },
      required: ['deal_id'],
    },
    handler: async (input, ctx) => {
      const dealId = reqString(input, 'deal_id');
      const { data: deal, error } = await supabaseAdmin.from('janet_deals').select('*').eq('id', dealId).single();
      if (error) throw new Error(error.message);
      const { data: pricing } = await supabaseAdmin
        .from('janet_memory')
        .select('content')
        .eq('active', true)
        .in('category', ['pricing', 'playbook']);
      const pricingNotes = (pricing ?? []).map((p) => `- ${p.content}`).join('\n') || '(no pricing memory yet)';
      const notes = optString(input, 'notes') ?? deal.notes ?? '(no notes)';
      // Proposal drafting is a hard one-shot → escalate to the heavy model; its
      // spend is reported to the turn's budget at the heavy model's rates (1.7).
      const { text, usage } = await draftWithClaude(
        "You write concise, concrete project proposals for BLVSTACK (AI systems + site builds). Structure: the problem, the proposed scope (bulleted), timeline, price, and next step. Ground the price in the pricing memory provided. No filler.",
        `Deal: ${deal.name}\nContact: ${deal.contact_name ?? 'unknown'}\n\nDiscovery notes:\n${notes}\n\nPricing memory:\n${pricingNotes}`,
        1400,
        JANET_MODEL_HEAVY
      );
      ctx?.onCost?.(usdCostOf(usage, JANET_MODEL_HEAVY));
      return { deal_id: dealId, proposal: text };
    },
  },
];
