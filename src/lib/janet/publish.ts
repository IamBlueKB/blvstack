// JANET Published proposals (Feature 3) — publish a proposal doc to a live URL
// on blvstack.com, track engagement, feed the ledger. noindex by default. The
// [slug] route must never shadow an existing BLVSTACK route, so publishing a
// reserved slug is refused here and the route double-checks.

import { randomBytes } from 'node:crypto';
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
  let page: PublishedRow;
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('janet_published_pages')
      .update({ slug, published: true, indexable: input.indexable ?? existing.indexable, template: input.template ?? existing.template, published_at: existing.published_at ?? now, unpublished_at: null })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    page = data as PublishedRow;
  } else {
    const { data, error } = await supabaseAdmin
      .from('janet_published_pages')
      .insert({ doc_id: input.docId, slug, published: true, indexable: input.indexable ?? false, template: input.template ?? 'proposal', published_at: now })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    page = data as PublishedRow;
  }
  // Auto-generate a tokened link for the doc's linked client (once), so a
  // per-recipient link is ready the moment the page goes live.
  await ensureClientRecipientLink(page.id, doc);
  return page;
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

// ─── Per-recipient tokened links + session-level attribution ─────────────────

/** URL-safe, unguessable token for a per-recipient link (?v=<token>). */
function makeToken(): string {
  return randomBytes(8).toString('base64url');
}

/** Create a tokened link for a specific recipient of a page. */
export async function createRecipientLink(input: {
  pageId: string;
  recipientName?: string | null;
  leadId?: string | null;
  clientId?: string | null;
}): Promise<{ id: string; token: string }> {
  const token = makeToken();
  const { data, error } = await supabaseAdmin
    .from('janet_page_recipient_links')
    .insert({ page_id: input.pageId, token, recipient_name: input.recipientName ?? null, lead_id: input.leadId ?? null, client_id: input.clientId ?? null })
    .select('id, token')
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string; token: string };
}

/** On publish, make sure the doc's linked client has a tokened link ready (once).
 *  Best-effort — never blocks publishing. Uses the client's contact name. */
async function ensureClientRecipientLink(pageId: string, doc: { client_id?: string | null }): Promise<void> {
  try {
    if (!doc.client_id) return;
    const { data: existing } = await supabaseAdmin
      .from('janet_page_recipient_links')
      .select('id')
      .eq('page_id', pageId)
      .eq('client_id', doc.client_id)
      .maybeSingle();
    if (existing) return; // already have one for this client
    const { data: client } = await supabaseAdmin.from('janet_clients').select('name, contact_name').eq('id', doc.client_id).maybeSingle();
    await createRecipientLink({ pageId, recipientName: client?.contact_name || client?.name || null, clientId: doc.client_id });
  } catch (e) {
    console.error('[janet] auto recipient link failed:', (e as Error).message);
  }
}

export async function getRecipientLinks(pageId: string) {
  const { data } = await supabaseAdmin
    .from('janet_page_recipient_links')
    .select('id, token, recipient_name, lead_id, client_id, created_at')
    .eq('page_id', pageId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

/** Resolve a ?v=token to its recipient link for a page (used by view ingest). */
export async function resolveRecipientToken(pageId: string, token: string) {
  if (!token) return null;
  const { data } = await supabaseAdmin
    .from('janet_page_recipient_links')
    .select('id, recipient_name, lead_id, client_id')
    .eq('page_id', pageId)
    .eq('token', token)
    .maybeSingle();
  return data ?? null;
}

/** Coarse device label from a user-agent — for "same device" grouping context.
 *  NEVER treated as identity (see honest-confidence rule in the tool). */
export function parseDevice(ua: string | null): string {
  if (!ua) return 'unknown device';
  const s = ua.toLowerCase();
  const kind = /ipad|tablet/.test(s) ? 'tablet' : /mobi|iphone|android/.test(s) ? 'mobile' : 'desktop';
  const browser = /edg\//.test(s) ? 'Edge' : /chrome|crios/.test(s) ? 'Chrome' : /firefox|fxios/.test(s) ? 'Firefox' : /safari/.test(s) ? 'Safari' : 'browser';
  const os = /iphone|ipad|ios/.test(s) ? 'iOS' : /android/.test(s) ? 'Android' : /windows/.test(s) ? 'Windows' : /mac os/.test(s) ? 'Mac' : /linux/.test(s) ? 'Linux' : '';
  return `${kind}${os ? ` · ${os}` : ''} · ${browser}`;
}

type ViewRow = {
  viewed_at: string;
  duration_seconds: number | null;
  section_engagement: Record<string, number> | null;
  viewer_type: string | null;
  recipient_link_id: string | null;
  session_id: string | null;
  user_agent: string | null;
  ip: string | null;
  referrer: string | null;
};

export type PageSession = {
  session_id: string | null;
  viewer_type: 'recipient' | 'anonymous';
  recipient_name: string | null;
  attribution: 'tokened-link' | 'anonymous'; // evidence tag — NOT proof of identity
  device: string;
  referrer: string | null;
  opens: number; // page loads grouped into this session
  days: number; // distinct calendar days spanned
  first_at: string;
  last_at: string;
  total_seconds: number;
  top_sections: { section: string; seconds: number }[];
};

/**
 * Aggregate engagement for a page — session-level, with OWNER (your own proofing)
 * views excluded from everything reported, and recipient attribution only where a
 * tokened link (?v=) was actually used. Repeat opens from one browser group into a
 * single session via the first-party session cookie.
 */
export async function getPageStats(pageId: string) {
  const { data: rows } = await supabaseAdmin
    .from('janet_page_views')
    .select('viewed_at, duration_seconds, section_engagement, viewer_type, recipient_link_id, session_id, user_agent, ip, referrer')
    .eq('page_id', pageId)
    .order('viewed_at', { ascending: false })
    .limit(1000);
  const all = (rows ?? []) as ViewRow[];

  const owner_views = all.filter((r) => r.viewer_type === 'owner').length;
  const real = all.filter((r) => r.viewer_type !== 'owner'); // owner is never reported as a client view

  // Resolve recipient names for attributed views.
  const linkIds = [...new Set(real.map((r) => r.recipient_link_id).filter(Boolean))] as string[];
  const nameById = new Map<string, string | null>();
  if (linkIds.length) {
    const { data: links } = await supabaseAdmin.from('janet_page_recipient_links').select('id, recipient_name').in('id', linkIds);
    for (const l of links ?? []) nameById.set(l.id, l.recipient_name);
  }

  // Group into sessions (by session cookie; fall back to ip+ua when absent).
  const groups = new Map<string, ViewRow[]>();
  for (const r of real) {
    const key = r.session_id || `noc:${r.ip ?? '?'}:${r.user_agent ?? '?'}`;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(r);
  }

  const sessions: PageSession[] = [];
  for (const g of groups.values()) {
    const link = g.map((r) => r.recipient_link_id).find(Boolean) ?? null;
    const times = g.map((r) => r.viewed_at).sort();
    const sec: Record<string, number> = {};
    let total = 0;
    for (const r of g) {
      if (r.duration_seconds) total += r.duration_seconds;
      for (const [k, v] of Object.entries(r.section_engagement ?? {})) sec[k] = (sec[k] ?? 0) + (Number(v) || 0);
    }
    sessions.push({
      session_id: g[0].session_id,
      viewer_type: link ? 'recipient' : 'anonymous',
      recipient_name: link ? nameById.get(link) ?? null : null,
      attribution: link ? 'tokened-link' : 'anonymous',
      device: parseDevice(g[0].user_agent),
      referrer: g.map((r) => r.referrer).find(Boolean) ?? null,
      opens: g.length,
      days: new Set(times.map((t) => t.slice(0, 10))).size,
      first_at: times[0],
      last_at: times[times.length - 1],
      total_seconds: total,
      top_sections: Object.entries(sec).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([section, seconds]) => ({ section, seconds })),
    });
  }
  sessions.sort((a, b) => (a.last_at < b.last_at ? 1 : -1));

  // Back-compat aggregate fields (now owner-excluded).
  const sectionTotals: Record<string, number> = {};
  let totalTime = 0;
  for (const r of real) {
    if (r.duration_seconds) totalTime += r.duration_seconds;
    for (const [k, v] of Object.entries(r.section_engagement ?? {})) sectionTotals[k] = (sectionTotals[k] ?? 0) + (Number(v) || 0);
  }
  const orderedTimes = real.map((r) => r.viewed_at).sort();
  return {
    views: real.length,
    sessions: sessions.length,
    owner_views, // your proofing views — excluded from everything above
    unique_recipients: new Set(sessions.filter((s) => s.recipient_name).map((s) => s.recipient_name)).size,
    first_viewed: orderedTimes[0] ?? null,
    last_viewed: orderedTimes[orderedTimes.length - 1] ?? null,
    total_seconds: totalTime,
    avg_seconds: real.length ? Math.round(totalTime / real.length) : 0,
    top_sections: Object.entries(sectionTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([section, seconds]) => ({ section, seconds })),
    session_detail: sessions,
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
