// JANET Published proposals (Feature 3) — publish a proposal doc to a live URL
// on blvstack.com, track engagement, feed the ledger. noindex by default. The
// [slug] route must never shadow an existing BLVSTACK route, so publishing a
// reserved slug is refused here and the route double-checks.

import { supabaseAdmin } from '../supabase';
import { getDoc, type DocRow } from './docs';

// Single-segment paths that already resolve to a real page/asset (Astro serves
// static routes before the [slug] catch-all, but we refuse these at publish time
// so a published page is never created unreachable or confusing).
export const RESERVED_SLUGS = new Set([
  '', 'index', 'about', 'services', 'contact', 'start', 'terms', 'privacy', 'work', 'blog',
  'admin', 'api', 'booker', '404', 'robots.txt', 'sitemap.xml', 'sitemap-index.xml',
  'favicon.svg', 'favicon.ico', 'p', 'og',
]);

export function normalizeSlug(input: string): string {
  return (input ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

export type PublishedRow = {
  id: string;
  doc_id: string;
  slug: string;
  published: boolean;
  indexable: boolean;
  template: string | null;
  published_at: string | null;
  unpublished_at: string | null;
  created_at: string;
};

/** The published-page row for a doc (one page per doc), if any. */
export async function getPageForDoc(docId: string): Promise<PublishedRow | null> {
  const { data } = await supabaseAdmin.from('janet_published_pages').select('*').eq('doc_id', docId).maybeSingle();
  return (data as PublishedRow) ?? null;
}

/** Publish (or re-publish / re-slug) a doc's page. Validates the slug. */
export async function publishPage(input: { docId: string; slug: string; indexable?: boolean; template?: string }): Promise<PublishedRow> {
  const doc = await getDoc(input.docId);
  if (!doc) throw new Error('Doc not found');
  const slug = normalizeSlug(input.slug);
  if (!slug) throw new Error('Provide a slug (letters, numbers, dashes).');
  if (isReservedSlug(slug)) throw new Error(`"${slug}" is a reserved path — pick another slug.`);

  // Slug must be unique across pages (except this doc's own page).
  const { data: clash } = await supabaseAdmin.from('janet_published_pages').select('id, doc_id').eq('slug', slug).maybeSingle();
  if (clash && clash.doc_id !== input.docId) throw new Error(`The slug "${slug}" is already taken.`);

  const existing = await getPageForDoc(input.docId);
  const now = new Date().toISOString();
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('janet_published_pages')
      .update({ slug, published: true, indexable: input.indexable ?? existing.indexable, template: input.template ?? existing.template, published_at: existing.published_at ?? now, unpublished_at: null })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as PublishedRow;
  }
  const { data, error } = await supabaseAdmin
    .from('janet_published_pages')
    .insert({ doc_id: input.docId, slug, published: true, indexable: input.indexable ?? false, template: input.template ?? 'proposal', published_at: now })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as PublishedRow;
}

export async function unpublishPage(docId: string): Promise<{ ok: boolean }> {
  const existing = await getPageForDoc(docId);
  if (!existing) return { ok: false };
  const { error } = await supabaseAdmin
    .from('janet_published_pages')
    .update({ published: false, unpublished_at: new Date().toISOString() })
    .eq('id', existing.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Resolve a live page by slug → its doc. Returns null unless published. */
export async function getPublishedBySlug(slug: string): Promise<{ page: PublishedRow; doc: DocRow } | null> {
  const s = normalizeSlug(slug);
  if (!s || isReservedSlug(s)) return null;
  const { data: page } = await supabaseAdmin.from('janet_published_pages').select('*').eq('slug', s).eq('published', true).maybeSingle();
  if (!page) return null;
  const doc = await getDoc(page.doc_id);
  if (!doc) return null;
  return { page: page as PublishedRow, doc };
}

// ─── Fillable form responses (client PII — service-role only) ──────────

export async function recordFormResponse(input: {
  pageId: string; docId: string | null; clientId: string | null;
  answers: Record<string, unknown>; respondentName?: string | null; respondentEmail?: string | null;
  referrer?: string | null; userAgent?: string | null;
}) {
  const { data, error } = await supabaseAdmin.from('janet_form_responses').insert({
    page_id: input.pageId, doc_id: input.docId, client_id: input.clientId,
    answers: input.answers, respondent_name: input.respondentName ?? null, respondent_email: input.respondentEmail ?? null,
    referrer: input.referrer ?? null, user_agent: input.userAgent ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getFormResponses(docId: string, limit = 100) {
  const { data } = await supabaseAdmin
    .from('janet_form_responses')
    .select('id, answers, respondent_name, respondent_email, submitted_at')
    .eq('doc_id', docId)
    .order('submitted_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listClientFormResponses(clientId: string) {
  const { data } = await supabaseAdmin
    .from('janet_form_responses')
    .select('id, doc_id, respondent_name, submitted_at, janet_docs(title)')
    .eq('client_id', clientId)
    .order('submitted_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((r: any) => ({ id: r.id, doc_id: r.doc_id, respondent_name: r.respondent_name, submitted_at: r.submitted_at, doc_title: r.janet_docs?.title ?? 'Form' }));
}

/** Snapshot one-liners: docs with form responses in the last 14 days. */
export async function getFormResponseSummary(): Promise<string[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from('janet_form_responses')
    .select('doc_id, submitted_at, janet_docs(title)')
    .gte('submitted_at', since)
    .order('submitted_at', { ascending: false })
    .limit(200);
  const byDoc = new Map<string, { title: string; count: number; last: string }>();
  for (const r of (data ?? []) as any[]) {
    if (!r.doc_id) continue;
    const g = byDoc.get(r.doc_id) ?? { title: r.janet_docs?.title ?? 'a form', count: 0, last: r.submitted_at };
    g.count++;
    byDoc.set(r.doc_id, g);
  }
  return [...byDoc.values()].slice(0, 5).map((g) => `${g.title}: ${g.count} form response${g.count === 1 ? '' : 's'} (last 14d) — review + file`);
}

export async function recordView(pageId: string, v: { duration?: number | null; sections?: Record<string, number> | null; referrer?: string | null; userAgent?: string | null }) {
  await supabaseAdmin.from('janet_page_views').insert({
    page_id: pageId,
    duration_seconds: v.duration ?? null,
    section_engagement: v.sections ?? null,
    referrer: v.referrer ?? null,
    user_agent: v.userAgent ?? null,
  });
}

/** Aggregate engagement for a page (for the editor panel + tools). */
export async function getPageStats(pageId: string) {
  const { data: views } = await supabaseAdmin
    .from('janet_page_views')
    .select('viewed_at, duration_seconds, section_engagement')
    .eq('page_id', pageId)
    .order('viewed_at', { ascending: false })
    .limit(500);
  const rows = views ?? [];
  const sectionTotals: Record<string, number> = {};
  let totalTime = 0;
  for (const r of rows) {
    if (r.duration_seconds) totalTime += r.duration_seconds;
    for (const [k, v] of Object.entries((r.section_engagement as Record<string, number>) ?? {})) sectionTotals[k] = (sectionTotals[k] ?? 0) + (Number(v) || 0);
  }
  const topSections = Object.entries(sectionTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([section, seconds]) => ({ section, seconds }));
  return {
    views: rows.length,
    first_viewed: rows.length ? rows[rows.length - 1].viewed_at : null,
    last_viewed: rows.length ? rows[0].viewed_at : null,
    total_seconds: totalTime,
    avg_seconds: rows.length ? Math.round(totalTime / rows.length) : 0,
    top_sections: topSections,
  };
}

/** Published pages for a client's docs, with view counts (client hub). */
export async function listPublishedForClient(clientId: string) {
  const { data: docs } = await supabaseAdmin.from('janet_docs').select('id, title').eq('client_id', clientId);
  const docIds = (docs ?? []).map((d) => d.id);
  if (!docIds.length) return [];
  const { data: pages } = await supabaseAdmin.from('janet_published_pages').select('*').in('doc_id', docIds);
  const titleOf = new Map((docs ?? []).map((d) => [d.id, d.title]));
  const out = [];
  for (const p of pages ?? []) {
    const stats = await getPageStats(p.id);
    out.push({ ...p, title: titleOf.get(p.doc_id) ?? 'Doc', views: stats.views, last_viewed: stats.last_viewed });
  }
  return out;
}

/** Engagement one-liners for the business snapshot — the sales signal she
 *  surfaces unprompted ("Aurora opened it twice, 4 min on pricing, no reply").
 *
 *  Cost: this runs inside the business snapshot, which is rebuilt on EVERY chat
 *  turn. So it must be cheap: ONE embedded round-trip (pages + their doc title +
 *  their views, joined by PostgREST), aggregated in JS — never a per-page query
 *  loop — and a short in-memory cache so a burst of turns doesn't re-run it. */
let _engagementCache: { at: number; lines: string[] } | null = null;
const ENGAGEMENT_TTL_MS = 120_000;

export async function getPublishedEngagementSummary(): Promise<string[]> {
  if (_engagementCache && Date.now() - _engagementCache.at < ENGAGEMENT_TTL_MS) return _engagementCache.lines;
  const { data } = await supabaseAdmin
    .from('janet_published_pages')
    .select('slug, janet_docs(title), janet_page_views(viewed_at, section_engagement)')
    .eq('published', true)
    .limit(20);

  const lines: string[] = [];
  for (const p of (data ?? []) as any[]) {
    const views = (p.janet_page_views ?? []) as { viewed_at: string; section_engagement: Record<string, number> | null }[];
    if (!views.length) continue;
    const sectionTotals: Record<string, number> = {};
    let lastViewed = '';
    for (const v of views) {
      if (!lastViewed || v.viewed_at > lastViewed) lastViewed = v.viewed_at;
      for (const [k, s] of Object.entries(v.section_engagement ?? {})) sectionTotals[k] = (sectionTotals[k] ?? 0) + (Number(s) || 0);
    }
    const top = Object.entries(sectionTotals).sort((a, b) => b[1] - a[1])[0];
    const topStr = top && top[1] > 0 ? `, most time on "${top[0]}" (${Math.round(top[1] / 60)}m)` : '';
    const days = lastViewed ? Math.floor((Date.now() - new Date(lastViewed).getTime()) / 86_400_000) : null;
    const title = (p.janet_docs as any)?.title ?? p.slug;
    lines.push(`${title} (/${p.slug}): opened ${views.length}×${topStr}${days != null ? `, last viewed ${days === 0 ? 'today' : `${days}d ago`}` : ''}`);
  }
  const out = lines.slice(0, 5);
  _engagementCache = { at: Date.now(), lines: out };
  return out;
}
