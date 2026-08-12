// JANET The Doc (Feature 2) — tools. She can read/write docs, search across
// threads and docs, and — through the existing plan-approve-execute system —
// file structured records extracted from a doc (Mode B). Filing is Ring 3: she
// proposes, Blue approves, then it executes.

import type { JanetTool, JanetContext } from '../types';
import { listDocs, getDoc, createDoc, updateDoc, docToMarkdown, markdownToBlocks, searchThreadsAndDocs, buildTemplate, DOC_TYPES, type DocType } from '../docs';
import { executeJanetTool } from './registry';
import { getPublishedBySlug, getPageForDoc } from '../publish';
import { supabaseAdmin } from '../../supabase';

export const docTools: JanetTool[] = [
  {
    name: 'get_docs',
    description:
      'List docs in the workspace (proposals, scopes, campaigns, protocols, briefs). Filter by client_id. Use to find an existing doc before creating a new one, or to answer questions about what deliverables exist.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Only docs for this client' },
        include_archived: { type: 'boolean' },
      },
    },
    handler: async (input) => {
      const docs = await listDocs({ clientId: (input as any)?.client_id ?? null, includeArchived: (input as any)?.include_archived === true });
      return { count: docs.length, docs };
    },
  },
  {
    name: 'get_doc',
    description: 'Read one doc by id — returns its full content as markdown plus its linkage (client, deal, recommendation).',
    ring: 1,
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (input) => {
      const id = (input as any)?.id;
      const doc = await getDoc(id);
      if (!doc) throw new Error('Doc not found');
      return { id: doc.id, title: doc.title, doc_type: doc.doc_type, client_id: doc.client_id, deal_id: doc.deal_id, recommendation_id: doc.recommendation_id, markdown: docToMarkdown(doc) };
    },
  },
  {
    name: 'get_published_doc',
    description:
      "Find the doc behind a LIVE published page by its slug or URL — use this the MOMENT Blue asks to fix/update/change a live page (e.g. 'the /jtgrease page', 'blvstack.com/jtgrease', 'the published grease-trap page'). Returns the EXACT doc that page renders (its id + full markdown), so you edit the doc the page actually uses and never a same-titled duplicate. Editing that returned id with update_doc is what changes the live page. If nothing is published at the slug, it says so — do NOT then guess a doc by title.",
    ring: 1,
    input_schema: { type: 'object', properties: { slug: { type: 'string', description: 'Slug or full URL of the live page, e.g. "jtgrease" or "blvstack.com/jtgrease"' } }, required: ['slug'] },
    handler: async (input) => {
      const raw = String((input as any)?.slug ?? '').trim();
      if (!raw) throw new Error('Provide the slug or URL of the live page.');
      const slug = raw.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '').split(/[?#]/)[0].trim();
      const found = await getPublishedBySlug(slug);
      if (!found) return { published: false, slug, message: `Nothing is published at /${slug}. Check the slug, or the page may be unpublished — do not guess a doc by title.` };
      return { published: true, slug: found.page.slug, url: `/${found.page.slug}`, doc_id: found.doc.id, title: found.doc.title, markdown: docToMarkdown(found.doc) };
    },
  },
  {
    name: 'create_doc',
    description:
      "Create a new doc. Provide markdown for the body (headings ##, bullets -, checklists - [ ]). FORMATTING RENDERS on the live published page: **bold**, *italic*, `inline code`, [link text](https://url), and a line of `---` becomes a divider — use them for polish; they display correctly (they do NOT show raw). FILLABLE FORMS / QUESTIONNAIRES: a doc can be a real form clients fill in — write fields in markdown: `? question` = short answer, `?? question` = long answer, `?* question | Option A | Option B` = single choice (radio), `?+ question | A | B` = checkboxes; add ` *` at the end of the line to make a field required. When you publish a doc that has these fields, it renders as a live form at the public URL; clients submit, and their answers come back to you via get_form_responses (you then structure-and-file them). Optionally attach client_id/deal_id/recommendation_id and a doc_type (proposal|scope|campaign|protocol|audit|brief|questionnaire|notes|general). ALWAYS pass deal_id when the doc is a PROPOSAL for a deal (create the deal first with create_deal if it doesn't exist, then pass its id) — that link is what puts a Proposal button on the deal in the pipeline so Blue can review it before it is sent. A proposal with no deal_id is orphaned and Blue can't find it from the deal. Pass template + client_id instead of markdown to pre-fill from client context. IMPORTANT: client_id/deal_id must be a REAL id — get it from get_clients/get_deals or page context BEFORE calling; never guess an id. Omit client_id for a standalone doc.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        markdown: { type: 'string', description: 'Body as markdown (omit if using template)' },
        template: { type: 'string', enum: DOC_TYPES as unknown as string[], description: 'Pre-fill from a template using client context' },
        client_id: { type: 'string' },
        deal_id: { type: 'string' },
        recommendation_id: { type: 'string' },
        doc_type: { type: 'string', enum: DOC_TYPES as unknown as string[] },
      },
      required: ['title'],
    },
    handler: async (input) => {
      const i = input as any;
      // Duplicate guard: a doc with this exact title (+ same client) already exists?
      // Return it instead of minting a duplicate — three same-titled docs are exactly
      // what let an edit land on the wrong one and never reach the live page.
      {
        let dq = supabaseAdmin.from('janet_docs').select('id, title').eq('title', i.title);
        dq = i.client_id ? dq.eq('client_id', i.client_id) : dq.is('client_id', null);
        const { data: dup } = await dq.order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (dup) {
          return {
            id: dup.id, title: dup.title, url: `/admin/docs/${dup.id}`, existing: true,
            note: `A doc titled "${i.title}"${i.client_id ? ' for this client' : ''} already exists — returning it instead of creating a duplicate. Edit it with update_doc (call get_doc first), or use a distinct title if you truly need a separate doc.`,
          };
        }
      }
      const content = i.template
        ? await buildTemplate(i.template as DocType, i.client_id ?? null)
        : i.markdown
          ? markdownToBlocks(i.markdown)
          : [];
      const doc = await createDoc({
        title: i.title,
        client_id: i.client_id ?? null,
        deal_id: i.deal_id ?? null,
        recommendation_id: i.recommendation_id ?? null,
        doc_type: i.doc_type ?? i.template ?? 'general',
        content,
      });
      // A proposal with no deal attached is orphaned — Blue can't reach it from the
      // pipeline. Surface that immediately rather than letting it pass silently.
      const orphanProposal = (i.doc_type ?? i.template) === 'proposal' && !i.deal_id;
      return {
        id: doc.id,
        title: doc.title,
        url: `/admin/docs/${doc.id}`,
        preview_url: `/admin/docs/${doc.id}/preview`,
        ...(orphanProposal
          ? { warning: 'This proposal has NO deal_id, so it will not appear on any deal in the pipeline. Create/find the deal and set deal_id on this doc (update_doc or create_doc with deal_id) before telling Blue it is ready.' }
          : {}),
      };
    },
  },
  {
    name: 'update_doc',
    description:
      "Replace a doc's body with new markdown (prior version snapshotted first — you never silently overwrite Blue's writing). This replaces the WHOLE body, so to add or change just part of an existing doc, call get_doc FIRST, edit that exact markdown (keep everything else intact), then pass the complete edited markdown here — never regenerate a doc from memory or you will drop content. FORMATTING RENDERS on the live published page: **bold**, *italic*, `inline code`, [link text](https://url), and a `---` line becomes a divider (they display correctly, not raw). Use this to draft into a doc, revise it, or turn it into a FILLABLE FORM by adding field lines: `? short answer`, `?? long answer`, `?* choose one | A | B`, `?+ check any | A | B`; end a line with ` *` for required. Once published, a doc with fields becomes a live questionnaire and submissions return via get_form_responses.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        markdown: { type: 'string', description: 'New body as markdown' },
        title: { type: 'string' },
        deal_id: { type: 'string', description: 'Attach this doc to a deal (use to fix an orphaned proposal so it shows on the deal)' },
      },
      required: ['id', 'markdown'],
    },
    handler: async (input) => {
      const i = input as any;
      const doc = await updateDoc(
        i.id,
        { content: markdownToBlocks(i.markdown), ...(i.title ? { title: i.title } : {}), ...(i.deal_id ? { deal_id: i.deal_id } : {}) },
        { snapshot: { label: 'before JANET edit', created_by: 'janet' } }
      );
      // Tell the truth about whether this edit is LIVE. A doc that isn't published has
      // no public URL — never claim a live page changed for an unpublished (or wrong,
      // duplicate) doc. If it IS published, hand back the slug so it can be verified.
      const page = await getPageForDoc(doc.id);
      const isPub = !!(page && page.published);
      return {
        id: doc.id,
        title: doc.title,
        url: `/admin/docs/${doc.id}`,
        published: isPub ? { is_published: true, slug: page!.slug, url: `/${page!.slug}` } : { is_published: false },
        note: isPub
          ? `This doc is LIVE at /${page!.slug} — your edit is now what that page renders. If it matters, confirm by loading /${page!.slug} before telling Blue it's done.`
          : `This doc is NOT published to a public page — editing it changes no live URL. If Blue meant a live page, find the right doc with get_published_doc(slug) and edit THAT one.`,
      };
    },
  },
  {
    name: 'search_threads_and_docs',
    description:
      'Search across all conversation threads and all docs for a phrase. Use when Blue asks "where did we discuss X" or you need to find prior context. Returns snippets with their source (which thread or doc).',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        client_id: { type: 'string', description: 'Restrict to one client' },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const i = input as any;
      const res = await searchThreadsAndDocs(i.query, { clientId: i.client_id ?? null });
      return { docs: res.docs, threads: res.threads, total: res.docs.length + res.threads.length };
    },
  },
  {
    name: 'file_records',
    description:
      'Structure-and-file (Mode B): take information Blue collected in a doc and file it as real records — create/update a deal, record a memory, log a recommendation, or add to the graveyard. Bundle everything you propose to write into `records`. This surfaces as an approval card; nothing is written until Blue approves.',
    ring: 3,
    input_schema: {
      type: 'object',
      properties: {
        records: {
          type: 'array',
          description: 'The records to write on approval',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create_deal', 'update_deal', 'add_memory', 'log_recommendation', 'add_to_graveyard'] },
              input: { type: 'object', description: 'The input for that action' },
              summary: { type: 'string', description: 'One line describing this record for the approval card' },
            },
            required: ['action', 'input'],
          },
        },
      },
      required: ['records'],
    },
    handler: async (input, ctx: JanetContext) => {
      const records = ((input as any)?.records ?? []) as { action: string; input: unknown; summary?: string }[];
      const results: { action: string; ok: boolean; summary: string }[] = [];
      for (const r of records) {
        const res = await executeJanetTool(r.action, r.input, ctx);
        results.push({ action: r.action, ok: res.ok, summary: res.ok ? (r.summary ?? 'filed') : res.error });
      }
      return { filed: results.filter((r) => r.ok).length, total: records.length, results };
    },
  },
];
