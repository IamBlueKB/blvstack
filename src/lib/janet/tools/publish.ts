// JANET Published proposals (Feature 3) — tools. Publishing is Ring 2: internal,
// reversible, on Blue's own domain. She can publish/unpublish on command
// ("publish the Aurora proposal") and read engagement to surface the sales signal.

import type { JanetTool } from '../types';
import { publishPage, unpublishPage, getPageForDoc, getPageStats, normalizeSlug } from '../publish';
import { listDocs } from '../docs';

export const publishTools: JanetTool[] = [
  {
    name: 'publish_page',
    description:
      'Publish a proposal doc to a live URL at blvstack.com/[slug]. Give the doc id and a slug (e.g. "aurora-refresh"). Rendered through the premium proposal template. noindex by default (set indexable:true only for a public case study). Reversible with unpublish_page.',
    ring: 2,
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
      'Read engagement for a published proposal — views, time on page, and which sections got attention. Use this to surface the sales signal ("Aurora opened it twice, 4 min on pricing, no reply — worth a nudge"). Give the doc id, or omit to list all published pages.',
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
        out.push({ doc_id: d.id, title: d.title, slug: page.slug, views: stats.views, last_viewed: stats.last_viewed, top_sections: stats.top_sections });
      }
      return { published: out.length, pages: out };
    },
  },
];
