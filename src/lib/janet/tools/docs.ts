// JANET The Doc (Feature 2) — tools. She can read/write docs, search across
// threads and docs, and — through the existing plan-approve-execute system —
// file structured records extracted from a doc (Mode B). Filing is Ring 3: she
// proposes, Blue approves, then it executes.

import type { JanetTool, JanetContext } from '../types';
import { listDocs, getDoc, createDoc, updateDoc, docToMarkdown, markdownToBlocks, searchThreadsAndDocs, buildTemplate, DOC_TYPES, type DocType } from '../docs';
import { executeJanetTool } from './registry';

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
    name: 'create_doc',
    description:
      "Create a new doc. Provide markdown for the body (headings ##, bullets -, checklists - [ ]). FORMATTING RENDERS on the live published page: **bold**, *italic*, `inline code`, [link text](https://url), and a line of `---` becomes a divider — use them for polish; they display correctly (they do NOT show raw). FILLABLE FORMS / QUESTIONNAIRES: a doc can be a real form clients fill in — write fields in markdown: `? question` = short answer, `?? question` = long answer, `?* question | Option A | Option B` = single choice (radio), `?+ question | A | B` = checkboxes; add ` *` at the end of the line to make a field required. When you publish a doc that has these fields, it renders as a live form at the public URL; clients submit, and their answers come back to you via get_form_responses (you then structure-and-file them). Optionally attach client_id/deal_id/recommendation_id and a doc_type (proposal|scope|campaign|protocol|audit|brief|questionnaire|notes|general). Pass template + client_id instead of markdown to pre-fill from client context. IMPORTANT: client_id/deal_id must be a REAL id — get it from get_clients/get_deals or page context BEFORE calling; never guess an id. Omit client_id for a standalone doc.",
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
      return { id: doc.id, title: doc.title, url: `/admin/docs/${doc.id}` };
    },
  },
  {
    name: 'update_doc',
    description:
      "Replace a doc's body with new markdown (prior version snapshotted first — you never silently overwrite Blue's writing). FORMATTING RENDERS on the live published page: **bold**, *italic*, `inline code`, [link text](https://url), and a `---` line becomes a divider (they display correctly, not raw). Use this to draft into a doc, revise it, or turn it into a FILLABLE FORM by adding field lines: `? short answer`, `?? long answer`, `?* choose one | A | B`, `?+ check any | A | B`; end a line with ` *` for required. Once published, a doc with fields becomes a live questionnaire and submissions return via get_form_responses.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        markdown: { type: 'string', description: 'New body as markdown' },
        title: { type: 'string' },
      },
      required: ['id', 'markdown'],
    },
    handler: async (input) => {
      const i = input as any;
      const doc = await updateDoc(
        i.id,
        { content: markdownToBlocks(i.markdown), ...(i.title ? { title: i.title } : {}) },
        { snapshot: { label: 'before JANET edit', created_by: 'janet' } }
      );
      return { id: doc.id, title: doc.title, url: `/admin/docs/${doc.id}` };
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
