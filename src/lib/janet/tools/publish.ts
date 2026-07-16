// JANET Published proposals (Feature 3) — tools. Publishing is Ring 2: internal,
// reversible, on Blue's own domain. She can publish/unpublish on command
// ("publish the Aurora proposal") and read engagement to surface the sales signal.

import type { JanetTool } from '../types';
import { publishPage, unpublishPage, getPageForDoc, getPageStats, normalizeSlug, getFormResponses, createRecipientLink, getRecipientLinks } from '../publish';
import { listDocs } from '../docs';

export const publishTools: JanetTool[] = [
  {
    name: 'publish_page',
    description:
      'Propose publishing a doc to a LIVE PUBLIC URL at blvstack.com/[slug]. Give the doc id and a slug (e.g. "aurora-refresh"). Works for a designed PROPOSAL page or, if the doc has form fields (? / ?? / ?* / ?+), a FILLABLE QUESTIONNAIRE clients submit (answers return via get_form_responses). BEFORE proposing, ALWAYS call get_page_views for this doc_id first: if it already has a published page (published:true), it is ALREADY LIVE — do NOT propose publishing again; just tell Blue it is already live at the URL. Only propose publish_page when the doc is not yet published (or you are deliberately changing the slug). This is EXTERNAL and GATED (Ring 3): calling it does NOT publish — it surfaces an approve/reject card and waits for Blue. Never claim a page is published unless a real publish result came back after approval. noindex by default (set indexable:true only for a public case study). Reversible with unpublish_page.',
    ring: 3,
    input_schema: {
      type: 'object',
      properties: {
        doc_id: { type: 'string' },
        slug: { type: 'string', description: 'URL slug, e.g. "aurora-refresh"' },
        indexable: { type: 'boolean', description: 'Allow search engines (default false)' },
      },
      required: ['doc_id', 'slug'],
    },
    handler: async (input) => {
      const i = input as any;
      const page = await publishPage({ docId: i.doc_id, slug: i.slug, indexable: i.indexable === true });
      return { slug: page.slug, url: `https://blvstack.com/${page.slug}`, published: page.published, indexable: page.indexable };
    },
  },
  {
    name: 'unpublish_page',
    description: 'Take a published proposal offline. Give the doc id. The URL returns 404 until re-published; nothing is deleted.',
    ring: 2,
    input_schema: { type: 'object', properties: { doc_id: { type: 'string' } }, required: ['doc_id'] },
    handler: async (input) => {
      const res = await unpublishPage((input as any).doc_id);
      if (!res.ok) throw new Error('That doc has no published page.');
      return { unpublished: true };
    },
  },
  {
    name: 'get_page_views',
    description:
      'Read SESSION-LEVEL engagement for a published page — grouped so repeat opens from one browser are ONE session, not many "views". Blue\'s own proofing views (owner) are already excluded. `session_detail` gives, per session: attribution ("tokened-link" = opened via a specific recipient\'s ?v= link, or "anonymous"), recipient_name, device, opens, days spanned, total_seconds, top_sections, first/last. HONEST CONFIDENCE — attribution is evidence, NOT proof of identity: a tokened-link/device match means "opened from a device using Roni\'s link", NEVER "Roni definitely read it" (links get forwarded; VPN/shared networks happen). Report it that way. Give the doc id, or omit to list all published pages.',
    ring: 1,
    input_schema: { type: 'object', properties: { doc_id: { type: 'string' } } },
    handler: async (input) => {
      const docId = (input as any)?.doc_id;
      if (docId) {
        const page = await getPageForDoc(docId);
        if (!page) throw new Error('That doc has no published page.');
        const stats = await getPageStats(page.id);
        return { slug: page.slug, url: `https://blvstack.com/${page.slug}`, published: page.published, ...stats };
      }
      // No doc_id → summarize all published docs.
      const docs = await listDocs({});
      const out: any[] = [];
      for (const d of docs) {
        const page = await getPageForDoc(d.id);
        if (!page?.published) continue;
        const stats = await getPageStats(page.id);
        out.push({ doc_id: d.id, title: d.title, slug: page.slug, views: stats.views, sessions: stats.sessions, last_viewed: stats.last_viewed, top_sections: stats.top_sections });
      }
      return { published: out.length, pages: out };
    },
  },
  {
    name: 'create_recipient_link',
    description:
      'Generate a unique per-recipient link for a published page — blvstack.com/[slug]?v=<token> — so a view on it attributes to THAT person ("give me Roni\'s link for this proposal"). Give the doc id and the recipient name; optionally attach lead_id/client_id so the view ties to their record. The doc must already be published. Returns the link to send. This does NOT prove identity — links can be forwarded — it just tags opens as coming through that recipient\'s link.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        doc_id: { type: 'string' },
        recipient_name: { type: 'string', description: 'Who this link is for, e.g. "Roni Bolton"' },
        lead_id: { type: 'string' },
        client_id: { type: 'string' },
      },
      required: ['doc_id', 'recipient_name'],
    },
    handler: async (input) => {
      const i = input as any;
      const page = await getPageForDoc(i.doc_id);
      if (!page?.published) throw new Error('That doc has no published page — publish it first, then generate recipient links.');
      const link = await createRecipientLink({ pageId: page.id, recipientName: i.recipient_name, leadId: i.lead_id ?? null, clientId: i.client_id ?? null });
      return { recipient: i.recipient_name, url: `https://blvstack.com/${page.slug}?v=${link.token}` };
    },
  },
  {
    name: 'get_recipient_links',
    description: 'List the per-recipient tokened links already generated for a published page (doc id). Returns each recipient name + their link.',
    ring: 1,
    input_schema: { type: 'object', properties: { doc_id: { type: 'string' } }, required: ['doc_id'] },
    handler: async (input) => {
      const page = await getPageForDoc((input as any).doc_id);
      if (!page) throw new Error('That doc has no published page.');
      const links = await getRecipientLinks(page.id);
      return { count: links.length, links: links.map((l: any) => ({ recipient: l.recipient_name, url: `https://blvstack.com/${page.slug}?v=${l.token}`, created_at: l.created_at })) };
    },
  },
  {
    name: 'get_form_responses',
    description:
      "Read client submissions to a published questionnaire/form doc. Give the doc id. Returns each response's answers, respondent name/email, and when. Use this to review what a client submitted, then structure-and-file it (create a deal/scope/next action via file_records, through the approval flow).",
    ring: 1,
    input_schema: { type: 'object', properties: { doc_id: { type: 'string' } }, required: ['doc_id'] },
    handler: async (input) => {
      const responses = await getFormResponses((input as any).doc_id);
      return { count: responses.length, responses };
    },
  },
];
