// JANET The Doc (Feature 2) — data layer for the full-page writing workspace.
// Docs are block-based, optionally client/deal/recommendation-scoped, and
// versioned: every AI edit snapshots the prior state first (non-negotiable #3).
// janet_memory is shared across every doc and thread — never touched here.

import { supabaseAdmin } from '../supabase';
import { type DocBlock, type DocType, DOC_TYPES, blockId, docToMarkdown, docToText, markdownToBlocks } from './doc-blocks';

// Re-export the client-safe block helpers so server callers have one import.
export { DOC_TYPES, blockId, docToMarkdown, docToText, markdownToBlocks };
export type { DocBlock, DocType };

export type DocRow = {
  id: string;
  title: string;
  client_id: string | null;
  deal_id: string | null;
  recommendation_id: string | null;
  doc_type: string | null;
  content: DocBlock[];
  status: string;
  thread_id: string | null;
  updated_at: string;
  created_at: string;
};

// ─── CRUD ──────────────────────────────────────────────────────────────

export async function listDocs(opts: { clientId?: string | null; includeArchived?: boolean } = {}) {
  let q = supabaseAdmin
    .from('janet_docs')
    .select('id, title, client_id, deal_id, doc_type, status, updated_at, created_at')
    .order('updated_at', { ascending: false })
    .limit(300);
  if (!opts.includeArchived) q = q.eq('status', 'active');
  if (opts.clientId) q = q.eq('client_id', opts.clientId);
  const { data } = await q;
  const docs = data ?? [];
  const clientIds = [...new Set(docs.map((d) => d.client_id).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (clientIds.length) {
    const { data: cs } = await supabaseAdmin.from('janet_clients').select('id, name').in('id', clientIds);
    for (const c of cs ?? []) names[c.id] = c.name;
  }
  return docs.map((d) => ({ ...d, client_name: d.client_id ? names[d.client_id] ?? null : null }));
}

export async function getDoc(id: string): Promise<DocRow | null> {
  const { data } = await supabaseAdmin.from('janet_docs').select('*').eq('id', id).maybeSingle();
  return (data as DocRow) ?? null;
}

export async function createDoc(input: {
  title: string;
  client_id?: string | null;
  deal_id?: string | null;
  recommendation_id?: string | null;
  doc_type?: string | null;
  content?: DocBlock[];
}): Promise<DocRow> {
  const title = (input.title ?? '').trim() || 'Untitled';
  // Resolve/validate FKs up front so a wrong id gives an actionable message
  // instead of a raw foreign-key violation (and never silently attaches to the
  // wrong client). Get the real id right the first time.
  if (input.client_id) {
    const { data: c } = await supabaseAdmin.from('janet_clients').select('id').eq('id', input.client_id).maybeSingle();
    if (!c) throw new Error(`client_id "${input.client_id}" does not exist — call get_clients to get the real id (or omit client_id for a standalone doc). Do not guess it.`);
  }
  if (input.deal_id) {
    const { data: d } = await supabaseAdmin.from('janet_deals').select('id').eq('id', input.deal_id).maybeSingle();
    if (!d) throw new Error(`deal_id "${input.deal_id}" does not exist — call get_deals to get the real id (or omit it).`);
  }
  const { data, error } = await supabaseAdmin
    .from('janet_docs')
    .insert({
      title,
      client_id: input.client_id ?? null,
      deal_id: input.deal_id ?? null,
      recommendation_id: input.recommendation_id ?? null,
      doc_type: input.doc_type ?? 'general',
      content: input.content ?? [],
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as DocRow;
}

/** Update a doc. When `snapshot` is set, the CURRENT content is versioned first
 *  — this is how "version before every AI edit" is enforced (non-negotiable #3). */
export async function updateDoc(
  id: string,
  patch: { title?: string; content?: DocBlock[]; doc_type?: string | null; deal_id?: string | null; recommendation_id?: string | null; status?: string },
  opts: { snapshot?: { label: string; created_by: string } } = {}
): Promise<DocRow> {
  if (opts.snapshot) {
    const current = await getDoc(id);
    if (current) await snapshotVersion(id, current.content, opts.snapshot.label, opts.snapshot.created_by);
  }
  const { data, error } = await supabaseAdmin
    .from('janet_docs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as DocRow;
}

export async function archiveDoc(id: string, archived = true) {
  const { error } = await supabaseAdmin.from('janet_docs').update({ status: archived ? 'archived' : 'active' }).eq('id', id);
  if (error) throw new Error(error.message);
  return { id, archived };
}

// ─── Versioning ────────────────────────────────────────────────────────

export async function snapshotVersion(docId: string, content: DocBlock[], label: string, createdBy: string) {
  const { error } = await supabaseAdmin.from('janet_doc_versions').insert({ doc_id: docId, content, label, created_by: createdBy });
  if (error) console.error('[janet] version snapshot failed:', error.message);
}

export async function listVersions(docId: string) {
  const { data } = await supabaseAdmin
    .from('janet_doc_versions')
    .select('id, label, created_by, created_at')
    .eq('doc_id', docId)
    .order('created_at', { ascending: false })
    .limit(100);
  return data ?? [];
}

export async function getVersion(versionId: string) {
  const { data } = await supabaseAdmin.from('janet_doc_versions').select('*').eq('id', versionId).maybeSingle();
  return data;
}

/** Restore a prior version: snapshot the current state, then set content to it. */
export async function restoreVersion(docId: string, versionId: string): Promise<DocRow> {
  const version = await getVersion(versionId);
  if (!version || version.doc_id !== docId) throw new Error('Version not found');
  return updateDoc(docId, { content: version.content }, { snapshot: { label: 'before restore', created_by: 'blue' } });
}

// ─── Thread linkage (doc-aware chat) ───────────────────────────────────

/** Ensure the doc has its own chat thread (created lazily, attached to the doc's
 *  client). Returns the thread id. */
export async function ensureDocThread(docId: string): Promise<string> {
  const doc = await getDoc(docId);
  if (!doc) throw new Error('Doc not found');
  if (doc.thread_id) return doc.thread_id;
  const { data: thread, error } = await supabaseAdmin
    .from('janet_threads')
    .insert({ title: `Doc · ${doc.title}`, client_id: doc.client_id, last_message_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await supabaseAdmin.from('janet_docs').update({ thread_id: thread.id }).eq('id', docId);
  return thread.id;
}

// ─── Context (doc-aware chat + prefill) ────────────────────────────────

/** Rich context for a doc's chat: the client it's for, the deal/recommendation
 *  it's linked to, and the doc's own body. She reads the whole doc as context. */
export async function getDocContext(docId: string): Promise<{ clientContext: string | null; docSummary: Record<string, unknown> } | null> {
  const doc = await getDoc(docId);
  if (!doc) return null;
  const lines: string[] = [];
  if (doc.client_id) {
    const { data: client } = await supabaseAdmin.from('janet_clients').select('*').eq('id', doc.client_id).maybeSingle();
    if (client) {
      lines.push(`THIS DOC IS FOR: ${client.name} (${client.status}). Center it on them.`);
      if (client.notes) lines.push(`Client notes: ${client.notes}`);
    }
  }
  if (doc.deal_id) {
    const { data: deal } = await supabaseAdmin.from('janet_deals').select('name, stage, value_estimate, next_action').eq('id', doc.deal_id).maybeSingle();
    if (deal) lines.push(`Linked deal: ${deal.name} [${deal.stage}]${deal.value_estimate ? ` ~$${Number(deal.value_estimate).toLocaleString()}` : ''}${deal.next_action ? ` — next: ${deal.next_action}` : ''}`);
  }
  if (doc.recommendation_id) {
    const { data: rec } = await supabaseAdmin.from('janet_recommendations').select('recommendation, subject_label').eq('id', doc.recommendation_id).maybeSingle();
    if (rec) lines.push(`This doc is the deliverable for your recommendation: "${rec.recommendation}"${rec.subject_label ? ` (${rec.subject_label})` : ''}`);
  }
  return {
    clientContext: lines.length ? lines.join('\n') : null,
    docSummary: { doc_id: doc.id, title: doc.title, doc_type: doc.doc_type, body: docToText(doc) },
  };
}

// ─── Cross-search (threads + docs) ─────────────────────────────────────

/** Full-text-ish search across doc bodies and thread messages. Returns ranked
 *  hits with a snippet and source so Blue (and she) can jump to them. */
export async function searchThreadsAndDocs(query: string, opts: { clientId?: string | null } = {}) {
  const q = query.trim();
  if (!q) return { docs: [], threads: [] };
  const like = `%${q}%`;

  // Docs — filter in JS on serialized body (content is JSONB block array).
  let docQ = supabaseAdmin.from('janet_docs').select('id, title, client_id, content, updated_at').eq('status', 'active').limit(300);
  if (opts.clientId) docQ = docQ.eq('client_id', opts.clientId);
  const { data: docRows } = await docQ;
  const docHits = (docRows ?? [])
    .map((d) => {
      const body = `${d.title}\n${docToText(d as any)}`;
      const idx = body.toLowerCase().indexOf(q.toLowerCase());
      if (idx < 0) return null;
      return { id: d.id, title: d.title, client_id: d.client_id, snippet: snippetAround(body, idx, q.length), updated_at: d.updated_at };
    })
    .filter(Boolean)
    .slice(0, 20);

  // Threads — search message text, then group hits by thread.
  const { data: msgRows } = await supabaseAdmin
    .from('janet_messages')
    .select('thread_id, content, created_at')
    .not('thread_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1500);
  const threadHitMap = new Map<string, { snippet: string; created_at: string }>();
  for (const m of msgRows ?? []) {
    const text = messageText(m.content);
    if (!text) continue;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) continue;
    if (!threadHitMap.has(m.thread_id)) threadHitMap.set(m.thread_id, { snippet: snippetAround(text, idx, q.length), created_at: m.created_at });
  }
  const threadIds = [...threadHitMap.keys()];
  let threadHits: any[] = [];
  if (threadIds.length) {
    let tQ = supabaseAdmin.from('janet_threads').select('id, title, client_id').in('id', threadIds);
    if (opts.clientId) tQ = tQ.eq('client_id', opts.clientId);
    const { data: ts } = await tQ;
    threadHits = (ts ?? []).map((t) => ({ id: t.id, title: t.title, client_id: t.client_id, ...threadHitMap.get(t.id)! })).slice(0, 20);
  }

  return { docs: docHits, threads: threadHits };
}

function snippetAround(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + len + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

function messageText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return '';
}

// ─── Templates ─────────────────────────────────────────────────────────

export const DOC_TEMPLATES: { key: DocType; label: string; hint: string }[] = [
  { key: 'proposal', label: 'Proposal', hint: 'a scoped, priced proposal for a deal' },
  { key: 'scope', label: 'Scope', hint: 'a statement of work' },
  { key: 'campaign', label: 'Campaign brief', hint: 'a marketing / outreach campaign' },
  { key: 'protocol', label: 'Protocol', hint: 'a clinical / operational protocol' },
  { key: 'audit', label: 'Audit summary', hint: 'findings + recommendations from a scan' },
  { key: 'brief', label: 'Meeting brief', hint: 'prep or recap for a meeting' },
];

const h = (level: 1 | 2 | 3, text: string): DocBlock => ({ id: blockId(), type: 'heading', level, text });
const t = (text = ''): DocBlock => ({ id: blockId(), type: 'text', text });
const li = (text = ''): DocBlock => ({ id: blockId(), type: 'bullet', text });

/** Build a template pre-filled from client context where possible. Leaves the
 *  rest for Blue. Pulls the client's audit findings, scope, and pricing hints. */
export async function buildTemplate(docType: DocType, clientId: string | null): Promise<DocBlock[]> {
  let clientName = 'the client';
  let findingsBlocks: DocBlock[] = [];
  if (clientId) {
    const { data: client } = await supabaseAdmin.from('janet_clients').select('name').eq('id', clientId).maybeSingle();
    if (client?.name) clientName = client.name;
    // Latest audit findings for this client's sites → seed the audit/proposal.
    const { data: sites } = await supabaseAdmin.from('janet_sites').select('id, name').eq('client_id', clientId);
    const siteIds = (sites ?? []).map((s) => s.id);
    if (siteIds.length) {
      const { data: scans } = await supabaseAdmin
        .from('janet_site_scans')
        .select('site_id, score, results, created_at')
        .in('site_id', siteIds)
        .order('created_at', { ascending: false })
        .limit(siteIds.length);
      const fbs: DocBlock[] = [];
      for (const scan of scans ?? []) {
        const findings = (scan.results as any)?.audit?.findings ?? [];
        for (const f of findings.slice(0, 6)) fbs.push(li(`${f.title ?? f.issue ?? 'finding'}${f.severity ? ` (${f.severity})` : ''}`));
      }
      findingsBlocks = fbs;
    }
  }

  switch (docType) {
    case 'proposal':
      return [
        h(1, `Proposal — ${clientName}`),
        t(`Prepared for ${clientName}.`),
        h(2, 'The opportunity'),
        t(''),
        h(2, 'What we found'),
        ...(findingsBlocks.length ? findingsBlocks : [li('')]),
        h(2, 'Scope of work'),
        li(''),
        h(2, 'Timeline'),
        t(''),
        h(2, 'Investment'),
        t(''),
        h(2, 'Next step'),
        t(''),
      ];
    case 'scope':
      return [h(1, `Scope of work — ${clientName}`), h(2, 'Deliverables'), li(''), h(2, 'Out of scope'), li(''), h(2, 'Timeline'), t(''), h(2, 'Terms'), t('')];
    case 'campaign':
      return [h(1, `Campaign — ${clientName}`), h(2, 'Objective'), t(''), h(2, 'Audience'), t(''), h(2, 'Message'), t(''), h(2, 'Channels & cadence'), li(''), h(2, 'Success metrics'), li('')];
    case 'protocol':
      return [h(1, `Protocol — ${clientName}`), h(2, 'Purpose'), t(''), h(2, 'Steps'), li(''), h(2, 'Cautions'), li('')];
    case 'audit':
      return [h(1, `Audit summary — ${clientName}`), h(2, 'Findings'), ...(findingsBlocks.length ? findingsBlocks : [li('')]), h(2, 'Recommendations'), li(''), h(2, 'Priority'), t('')];
    case 'brief':
      return [h(1, `Brief — ${clientName}`), h(2, 'Context'), t(''), h(2, 'Key points'), li(''), h(2, 'Decisions needed'), li(''), h(2, 'Next actions'), li('')];
    default:
      return [h(1, clientName === 'the client' ? 'Untitled' : clientName), t('')];
  }
}
