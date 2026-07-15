// JANET — Ring 2 admin-wiring act tools (reversible internal writes / drafts).
// Executed without per-action approval, always logged to janet_actions. Nothing
// here SENDS to a real person — that's Ring 3 (ring3.ts). Drafts stay drafts.
//
// Outbound tools replicate the corresponding /admin endpoint logic inline (the
// established pattern: tools call lib functions + supabaseAdmin directly, never
// self-HTTP). The endpoints remain the human path; these are JANET's path to the
// same lib functions.

import { supabaseAdmin } from '../../supabase';
import { anthropic, MODEL } from '../../anthropic';
import { researchProspect, detectNiche } from '../../outbound/researcher';
import { composeInitialEmail } from '../../outbound/composer';
import { searchPlaces } from '../../outbound/places';
import { getNiche, listNiches } from '../../niches';
import { scrapeUrl } from '../../outbound/scraper';
import { composeReply } from '../../reply-composer';
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

const stripHtml = (html: string) =>
  html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CLIENT_STATUSES = ['prospect', 'active', 'past'];

const LEAD_DRAFT_SYSTEM = `You are drafting a first-touch email reply from Blue, the founder of BLVSTACK, to an inbound lead who submitted a project inquiry.

BLVSTACK builds AI systems for businesses ready to operate at a higher standard. Direct, founder-to-founder voice. No corporate fluff. No emojis. No "I hope this finds you well." No fake urgency. Sign as "Blue".

Goal of the email: acknowledge the inquiry, demonstrate you read it, and propose a concrete next step (a short discovery call if the fit looks strong, or one clarifying question if borderline).

Constraints:
- 80-150 words max
- Reference at least one specific detail from their problem (shows you actually read it)
- One clear ask (call, clarifying question, or "send me X")
- Plain text — no HTML

Output ONLY the email body. No subject line, no preamble like "Here's a draft:". Just the email itself starting with the greeting.`;

export const ring2AdminTools: JanetTool[] = [
  // ── Clients ──────────────────────────────────────────────────────────
  {
    name: 'create_client',
    description:
      'Create a client account (janet_clients) — the hub sites, deals, and notes roll up to. Optionally set the designated approver (who owns approvals for this client). Returns the created client.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Account / business name' },
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        status: { type: 'string', enum: CLIENT_STATUSES },
        notes: { type: 'string' },
        approver_name: { type: 'string' },
        approver_email: { type: 'string' },
        approver_role: { type: 'string', description: "e.g. 'clinic manager'" },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const row = {
        name: reqString(input, 'name'),
        contact_name: optString(input, 'contact_name') ?? null,
        contact_email: optString(input, 'contact_email') ?? null,
        contact_phone: optString(input, 'contact_phone') ?? null,
        status: optString(input, 'status') ?? 'active',
        notes: optString(input, 'notes') ?? null,
        approver_name: optString(input, 'approver_name') ?? null,
        approver_email: optString(input, 'approver_email') ?? null,
        approver_role: optString(input, 'approver_role') ?? null,
      };
      const { data, error } = await supabaseAdmin.from('janet_clients').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { created: true, client: data };
    },
  },
  {
    name: 'update_client',
    description:
      "Update a client account — contact details, status, notes, or the designated approver. Only the fields you pass change. Returns the updated client.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Client UUID' },
        name: { type: 'string' },
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        status: { type: 'string', enum: CLIENT_STATUSES },
        notes: { type: 'string' },
        approver_name: { type: 'string' },
        approver_email: { type: 'string' },
        approver_role: { type: 'string' },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const key of ['name', 'contact_name', 'contact_email', 'contact_phone', 'notes', 'approver_name', 'approver_email', 'approver_role'] as const) {
        const v = optString(input, key);
        if (v !== undefined) patch[key] = v;
      }
      const status = optString(input, 'status');
      if (status && CLIENT_STATUSES.includes(status)) patch.status = status;
      if (Object.keys(patch).length === 1) throw new Error('Nothing to update — provide at least one field.');
      const { data, error } = await supabaseAdmin.from('janet_clients').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { updated: true, client: data };
    },
  },

  // ── Recommendation ledger (Phase 2 — accountability) ─────────────────
  {
    name: 'log_recommendation',
    description:
      "Log a recommendation you're making to the ledger (janet_recommendations) — your advice, your reasoning, and your confidence. Do this EVERY time you make a meaningful call: a lead triage verdict, a suggested next action on a deal, a revenue idea, a pricing call, a site fix. This is how you get stakes: the outcome gets tagged later and it shows up in your scorecard. Returns the created recommendation (with its id).",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['lead_triage', 'deal_action', 'site_fix', 'revenue_idea', 'pricing', 'outreach', 'other'],
          description: 'What kind of call this is',
        },
        recommendation: { type: 'string', description: 'What you recommend, in one or two sentences' },
        reasoning: { type: 'string', description: 'WHY — your stated reasoning at the time (this is what you get graded on)' },
        confidence: { type: 'number', description: 'Your own confidence, 0 to 1' },
        subject_type: { type: 'string', enum: ['lead', 'deal', 'site', 'client', 'prospect'], description: 'What the recommendation is about (optional)' },
        subject_id: { type: 'string', description: 'UUID of the subject record (optional)' },
        subject_label: { type: 'string', description: 'Human-readable subject, e.g. the lead/deal/client name (optional but helpful)' },
      },
      required: ['category', 'recommendation', 'reasoning'],
    },
    handler: async (input) => {
      const confidenceRaw = optNumber(input, 'confidence');
      const confidence = confidenceRaw === undefined ? null : Math.min(Math.max(confidenceRaw, 0), 1);
      const row = {
        category: reqString(input, 'category'),
        recommendation: reqString(input, 'recommendation'),
        reasoning: reqString(input, 'reasoning'),
        confidence,
        subject_type: optString(input, 'subject_type') ?? null,
        subject_id: optString(input, 'subject_id') ?? null,
        subject_label: optString(input, 'subject_label') ?? null,
        status: 'open',
      };
      const { data, error } = await supabaseAdmin.from('janet_recommendations').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { logged: true, recommendation: data };
    },
  },
  {
    name: 'record_outcome',
    description:
      "Record the outcome of a past recommendation (by id) once you or Blue know what happened — 'worked', 'failed', 'partial', or 'unknown', with detail and any $ impact. You can also set Blue's verdict (right/wrong/mixed) and update the status (accepted/rejected/ignored/superseded). When YOU infer an outcome from the data, propose it and let Blue confirm; don't invent a verdict he didn't give. Returns the updated recommendation.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Recommendation UUID' },
        outcome: { type: 'string', enum: ['worked', 'failed', 'partial', 'unknown'] },
        outcome_detail: { type: 'string', description: 'What actually happened' },
        outcome_value: { type: 'number', description: '$ impact if measurable' },
        status: { type: 'string', enum: ['open', 'accepted', 'rejected', 'ignored', 'superseded'] },
        blue_verdict: { type: 'string', enum: ['right', 'wrong', 'mixed'], description: "Blue's judgment — only set when he actually gave it" },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const patch: Record<string, unknown> = {};
      const outcome = optString(input, 'outcome');
      if (outcome !== undefined) {
        patch.outcome = outcome;
        patch.outcome_recorded_at = new Date().toISOString();
      }
      const detail = optString(input, 'outcome_detail');
      if (detail !== undefined) patch.outcome_detail = detail;
      const value = optNumber(input, 'outcome_value');
      if (value !== undefined) patch.outcome_value = value;
      const status = optString(input, 'status');
      if (status !== undefined) patch.status = status;
      const verdict = optString(input, 'blue_verdict');
      if (verdict !== undefined) patch.blue_verdict = verdict;
      if (Object.keys(patch).length === 0) throw new Error('Nothing to record — provide outcome, detail, value, status, or verdict.');
      const { data, error } = await supabaseAdmin.from('janet_recommendations').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { recorded: true, recommendation: data };
    },
  },

  // ── Memory management ────────────────────────────────────────────────
  {
    name: 'update_memory',
    description: 'Edit an existing memory entry (janet_memory) — its content or category. Use to fix a memory that is wrong or outdated. Returns the updated entry.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory UUID' },
        content: { type: 'string' },
        category: { type: 'string', enum: ['preference', 'pricing', 'playbook', 'correction', 'fact'] },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const content = optString(input, 'content');
      if (content !== undefined) patch.content = content;
      const category = optString(input, 'category');
      if (category !== undefined) patch.category = category;
      if (Object.keys(patch).length === 1) throw new Error('Nothing to update — provide content or category.');
      const { data, error } = await supabaseAdmin.from('janet_memory').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { updated: true, memory: data };
    },
  },
  {
    name: 'deactivate_memory',
    description: 'Deactivate a memory (set active=false) so it stops loading into your context, without deleting it. Use to retire a stale preference. Reversible.',
    ring: 2,
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Memory UUID' } }, required: ['id'] },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const { data, error } = await supabaseAdmin.from('janet_memory').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { deactivated: true, memory: data };
    },
  },
  {
    name: 'delete_memory',
    description: 'Permanently delete a memory entry. Use only for a genuinely wrong entry — prefer deactivate_memory to retire without losing it.',
    ring: 2,
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'Memory UUID' } }, required: ['id'] },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const { error } = await supabaseAdmin.from('janet_memory').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { deleted: true, id };
    },
  },

  // ── Lead / message drafts (draft only — SEND is Ring 3) ──────────────
  {
    name: 'draft_lead_reply',
    description:
      'Draft a first-touch reply to an inbound lead (by lead id), grounded in their inquiry and triage. Returns the draft body — does NOT send. To send, propose send_lead_reply after Blue approves.',
    ring: 2,
    input_schema: { type: 'object', properties: { lead_id: { type: 'string', description: 'Lead UUID' } }, required: ['lead_id'] },
    handler: async (input) => {
      const id = reqString(input, 'lead_id');
      const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', id).single();
      if (error) throw new Error(error.message);
      const firstName = (lead.name ?? '').split(' ')[0] || 'there';
      const userPrompt = `Lead details:\n\nName: ${lead.name ?? '—'} (use first name: ${firstName})\nBusiness: ${lead.business_name ?? '—'}\nRevenue: ${lead.revenue_range ?? '—'}\nTimeline: ${lead.timeline ?? '—'}\nBudget: ${lead.budget_tier ?? '—'}\n\nTheir problem (their own words):\n${lead.problem ?? '—'}\n${lead.ai_analysis ? `\nPrior triage analysis:\n${JSON.stringify(lead.ai_analysis, null, 2)}\n` : ''}\n\nDraft the reply email.`;
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 600,
        system: LEAD_DRAFT_SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const draft = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
      return { lead_id: id, to: lead.email ?? null, draft };
    },
  },
  {
    name: 'draft_message_reply',
    description:
      'Draft a reply to an inbound contact-form message (by message id) and save it as the message draft. Returns { subject, body } — does NOT send. To send, propose send_message_reply after Blue approves.',
    ring: 2,
    input_schema: { type: 'object', properties: { message_id: { type: 'string', description: 'contact_messages UUID' } }, required: ['message_id'] },
    handler: async (input) => {
      const id = reqString(input, 'message_id');
      const { data: msg, error } = await supabaseAdmin.from('contact_messages').select('id, name, email, message').eq('id', id).single();
      if (error) throw new Error(error.message);
      const { subject, body } = await composeReply({ name: msg.name, email: msg.email, message: msg.message });
      const { error: upErr } = await supabaseAdmin.from('contact_messages').update({ draft_subject: subject, draft_body: body }).eq('id', id);
      if (upErr) throw new Error(upErr.message);
      return { message_id: id, to: msg.email, subject, body };
    },
  },

  // ── Outbound (research / compose drafts / find / scrape) ─────────────
  {
    name: 'compose_prospect_email',
    description:
      'Compose (draft) a cold outreach email for a researched prospect (by id) and save it as the prospect draft. Returns { subject, body } — does NOT send. Refuses if the prospect is disqualified.',
    ring: 2,
    input_schema: { type: 'object', properties: { prospect_id: { type: 'string', description: 'prospects UUID' } }, required: ['prospect_id'] },
    handler: async (input) => {
      const id = reqString(input, 'prospect_id');
      const { data: p, error } = await supabaseAdmin.from('prospects').select('*').eq('id', id).single();
      if (error) throw new Error(error.message);
      if (p.disqualified) throw new Error(`Prospect is disqualified${p.disqualified_reason ? `: ${p.disqualified_reason}` : ''}.`);
      const { subject, body } = await composeInitialEmail({
        contact_name: p.contact_name,
        company_name: p.company_name,
        company_url: p.company_url,
        pain_points: p.pain_points,
        ai_research: p.ai_research,
        niche: p.niche,
      });
      await supabaseAdmin
        .from('prospects')
        .update({ draft_subject: subject, draft_email: body, status: p.status === 'new' ? 'composed' : p.status })
        .eq('id', id);
      return { prospect_id: id, subject, body };
    },
  },
  {
    name: 'research_prospect',
    description:
      "Research a prospect (by id): fetch their site + contact pages, run the researcher, and save pain points, niche, and contacts to the prospect. Ring 2 — reads public pages, writes only the prospect record. Returns the research summary.",
    ring: 2,
    input_schema: { type: 'object', properties: { prospect_id: { type: 'string', description: 'prospects UUID' } }, required: ['prospect_id'] },
    handler: async (input) => {
      const id = reqString(input, 'prospect_id');
      const { data: prospect, error } = await supabaseAdmin.from('prospects').select('*').eq('id', id).single();
      if (error) throw new Error(error.message);
      if (!prospect.company_url) throw new Error('Prospect has no company URL to research.');

      const SUBPAGES = ['/contact', '/contact-us', '/about', '/team'];
      const base = new URL(prospect.company_url);
      const urls = [base.toString(), ...SUBPAGES.map((p) => new URL(p, base).toString())];
      const fetched = await Promise.allSettled(
        urls.map((u) =>
          fetch(u, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BLVSTACK-Bot/1.0)', Accept: 'text/html,application/xhtml+xml' },
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
          })
        )
      );
      const PER_PAGE_CAP = 6000;
      let textContent = '';
      let pagesFetched = 0;
      for (let i = 0; i < fetched.length; i++) {
        const r = fetched[i];
        if (r.status !== 'fulfilled' || !r.value.ok) continue;
        const text = stripHtml(await r.value.text());
        if (!text) continue;
        textContent += `\n\n--- ${urls[i]} ---\n${text.slice(0, PER_PAGE_CAP)}`;
        pagesFetched++;
      }
      if (pagesFetched === 0) throw new Error(`Could not fetch any pages from ${prospect.company_url}`);

      let nicheForResearch: string | null = prospect.niche ?? null;
      let autoDetectedNiche: string | null = null;
      if (!nicheForResearch) {
        autoDetectedNiche = detectNiche(textContent, prospect.company_url);
        nicheForResearch = autoDetectedNiche;
      }
      const research = await researchProspect(prospect.company_name ?? 'Unknown', prospect.company_url, textContent, { niche: nicheForResearch });
      const painPointsSummary = research.pain_points.map((p: any) => `${p.problem} → ${p.blvstack_solution} (${p.tier}, ${p.confidence})`).join('\n');
      const updates: Record<string, unknown> = {
        ai_research: research,
        pain_points: painPointsSummary,
        status: 'researched',
        disqualified: research.disqualified === true,
        disqualified_reason: research.disqualified === true ? research.disqualified_reason ?? null : null,
      };
      if (!prospect.niche && autoDetectedNiche) updates.niche = autoDetectedNiche;
      if (!prospect.contact_email && research.contact_hints?.emails_found?.length > 0) updates.contact_email = research.contact_hints.emails_found[0];
      if (!prospect.contact_name && research.contact_hints?.team_members?.length > 0) updates.contact_name = research.contact_hints.team_members[0];
      await supabaseAdmin.from('prospects').update(updates).eq('id', id);

      return {
        prospect_id: id,
        disqualified: research.disqualified === true,
        pain_points: research.pain_points?.slice(0, 4) ?? [],
        contacts: research.contact_hints ?? null,
      };
    },
  },
  {
    name: 'find_prospects',
    description:
      'Find local-business prospects via Google Places and add the new ones to the prospect list (dedup by URL). Optionally constrain to a niche. Ring 2 — inserts prospect rows, does not contact anyone.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Places search, e.g. "med spas in Austin TX"' },
        max_results: { type: 'number', description: '1-60 (default 20)' },
        niche: { type: 'string', description: 'Niche slug to pre-tag + constrain (optional)' },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const query = reqString(input, 'query').trim();
      const maxResults = Math.min(Math.max(optNumber(input, 'max_results') ?? 20, 1), 60);
      let nicheSlug: string | null = null;
      let includedType: string | null = null;
      const niche = optString(input, 'niche');
      if (niche) {
        if (!new Set(listNiches().map((n) => n.slug)).has(niche)) throw new Error(`Unknown niche slug: ${niche}`);
        nicheSlug = niche;
        includedType = getNiche(nicheSlug)?.detection.googlePlacesTypes?.[0] ?? null;
      }
      const places = await searchPlaces(query, maxResults, { includedType });
      if (places.length === 0) return { found: 0, message: 'No results from Google Places' };
      const withWebsites = places.filter((p) => p.website);
      if (withWebsites.length === 0) return { found: 0, message: `Found ${places.length} businesses but none have websites` };
      const websites = withWebsites.map((p) => p.website).filter(Boolean) as string[];
      const { data: existingRows } = await supabaseAdmin.from('prospects').select('company_url').in('company_url', websites);
      const existing = new Set((existingRows ?? []).map((r: any) => r.company_url));
      const rows = withWebsites
        .filter((p) => !existing.has(p.website!))
        .map((p) => ({
          source_url: `google_places: ${query}`,
          company_name: p.name,
          company_url: p.website,
          notes: [
            p.primary_type ? `Category: ${p.primary_type}` : null,
            p.address ? `Address: ${p.address}` : null,
            p.phone ? `Phone: ${p.phone}` : null,
            p.rating ? `Rating: ${p.rating} (${p.user_ratings_total} reviews)` : null,
            p.business_status && p.business_status !== 'OPERATIONAL' ? `⚠ Status: ${p.business_status}` : null,
            p.hours ? `Hours: ${p.hours}` : null,
          ].filter(Boolean).join('\n') || null,
          status: 'new',
          niche: nicheSlug,
        }));
      if (rows.length === 0) return { found: 0, total: places.length, message: `All ${withWebsites.length} already in prospects` };
      const { data, error } = await supabaseAdmin.from('prospects').insert(rows).select('id, company_name, company_url');
      if (error) throw new Error(error.message);
      return { found: data?.length ?? 0, total: places.length, added: data ?? [] };
    },
  },
  {
    name: 'scrape_prospects',
    description:
      'Extract prospects from up to 10 URLs (directories, "Top X" lists, blog posts) and add the new ones (dedup + suppression-checked). Ring 2 — inserts prospect rows, contacts no one.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, description: '1-10 URLs to extract from' },
        max_per_url: { type: 'number', description: '1-100 (default 20)' },
      },
      required: ['urls'],
    },
    handler: async (input) => {
      const urls = (input as any)?.urls;
      if (!Array.isArray(urls) || urls.length === 0) throw new Error('Provide at least one URL.');
      if (urls.length > 10) throw new Error('Max 10 URLs per batch.');
      const maxPerUrl = Math.min(Math.max(optNumber(input, 'max_per_url') ?? 20, 1), 100);
      const results: { url: string; found: number; error?: string }[] = [];
      for (const url of urls) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BLVSTACK-Bot/1.0)', Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' });
          if (!res.ok) { results.push({ url, found: 0, error: `HTTP ${res.status}` }); continue; }
          const textContent = stripHtml(await res.text());
          if (textContent.length < 800) { results.push({ url, found: 0, error: 'Page appears JS-rendered (content too thin).' }); continue; }
          const { data: alreadyRows } = await supabaseAdmin.from('prospects').select('company_name').eq('source_url', url).not('company_name', 'is', null);
          const alreadyExtracted = (alreadyRows ?? []).map((r: any) => r.company_name).filter(Boolean);
          const prospects = await scrapeUrl(url, textContent, maxPerUrl, alreadyExtracted);
          if (prospects.length === 0) { results.push({ url, found: 0 }); continue; }
          const emails = prospects.map((p: any) => p.contact_email).filter(Boolean) as string[];
          let suppressed = new Set<string>();
          if (emails.length > 0) {
            const { data: suppRows } = await supabaseAdmin.from('suppression_list').select('email').in('email', emails);
            suppressed = new Set((suppRows ?? []).map((r: any) => r.email));
          }
          const companyUrls = prospects.map((p: any) => p.company_url).filter(Boolean) as string[];
          let existingUrls = new Set<string>();
          if (companyUrls.length > 0) {
            const { data: exRows } = await supabaseAdmin.from('prospects').select('company_url').in('company_url', companyUrls);
            existingUrls = new Set((exRows ?? []).map((r: any) => r.company_url));
          }
          const rows = prospects
            .filter((p: any) => !(p.contact_email && suppressed.has(p.contact_email)) && !(p.company_url && existingUrls.has(p.company_url)))
            .map((p: any) => ({ source_url: url, company_name: p.company_name, company_url: p.company_url, contact_name: p.contact_name, contact_email: p.contact_email, notes: p.context, status: 'new' }));
          if (rows.length > 0) await supabaseAdmin.from('prospects').insert(rows);
          results.push({ url, found: rows.length });
        } catch (err: any) {
          results.push({ url, found: 0, error: err?.message ?? 'Unknown error' });
        }
      }
      return { total_found: results.reduce((s, r) => s + r.found, 0), results };
    },
  },
];
