// JANET — id integrity (code-enforced; no model belief is load-bearing).
//
// The failure this closes: JANET passing ids she never received. The ledger
// showed a short id zero-padded into UUID shape ("2ba7caf0-0000-0000-0000-
// 000000000000" — and 2ba7caf0 was a DIFFERENT deal than the one she wanted),
// slugs invented from names ("kuumba-soul-eugene-lockhart", "ryan-baggett-lead"),
// and truncated prefixes ("075dcb8e"). Prompt rules ("ids verbatim only") did not
// stop it, because the cause is structural: history replay is text-only
// (brain.ts), so every real id from a PAST turn's tool results is gone from her
// context — when Blue refers back to something, she has nothing to copy.
//
// Two halves:
//   1. CARRY — the labeled records (kind · label · id) from past tool results are
//      re-surfaced as a compact list, so the real id is there to copy.
//   2. VET — before a tool runs, every id-shaped input must be a full UUID she was
//      actually shown (tool result, page, Blue's message, or her instructions).
//      A guessed id gets an instructive refusal instead of an opaque DB error
//      ("Cannot coerce the result to a single JSON object") she can't act on.

const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** A short id padded into UUID shape — the exact fabrication observed in the ledger. */
const ZERO_FILLED = /-0000-0000-0000-000000000000$/;
/** Input keys that carry a record id (every one in the registry is a DB UUID). */
const ID_KEY = /^(?:id|[a-z0-9_]+_id)$/;
const ID_LIST_KEY = /^[a-z0-9_]+_ids$/;

/** Every UUID appearing anywhere in a value (stringified), lowercased. */
export function collectUuids(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (value == null) return into;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  for (const m of s.matchAll(UUID_ANY)) into.add(m[0].toLowerCase());
  return into;
}

// ── 1. CARRY ────────────────────────────────────────────────────────────────

/** `linked` = known only as a foreign key on another record (e.g. a doc's deal_id). */
export type KnownEntity = { kind: string; label: string; id: string; linked?: boolean };

const LABEL_KEYS = ['name', 'title', 'invoice_number', 'subject', 'vendor', 'email', 'recommendation'];
/** Container keys that describe the payload, not the record kind — inherit the parent's. */
const GENERIC_KEYS = new Set(['result', 'results', 'data', 'rows', 'items', 'matches', 'candidates', 'records', 'list', 'top', 'recent']);

const singular = (k: string) => (k.endsWith('ies') ? `${k.slice(0, -3)}y` : k.endsWith('s') && !k.endsWith('ss') ? k.slice(0, -1) : k);

/** The record kind a tool returns, from its name: get_clearear_contacts → contact. */
function kindOfTool(name: string | undefined): string | null {
  if (!name) return null;
  const core = name
    .replace(/^(get|create|update|delete|set|log|record|draft|find|list|run|search)_/, '')
    .replace(/^(clearear|psrx|booker|janet)_/, '');
  return singular(core.split('_')[0] || core) || null;
}

function walk(node: unknown, kind: string | null, out: Map<string, KnownEntity>, depth = 0): void {
  if (depth > 6 || node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, kind, out, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  if (typeof o.id === 'string' && UUID_ONLY.test(o.id)) {
    const label = LABEL_KEYS.map((k) => o[k]).find((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (label) {
      const id = o.id.toLowerCase();
      // Books records carry their business — two same-named contacts on different
      // books must not look identical (an invoice can only bill its own books' contact).
      const biz = typeof o.business === 'string' ? ` [${o.business}]` : '';
      const own = label.replace(/\s+/g, ' ').trim().slice(0, 70) + biz;
      const kindHere = kind ?? 'record';
      out.delete(id); // re-seen → move to most-recent
      out.set(id, { kind: kindHere, label: own, id });
      // Its foreign keys too: the real 8/11 miss was a deal known ONLY as the doc's
      // deal_id — she needed exactly that id next, and guessed instead.
      for (const [k, v] of Object.entries(o)) {
        const fk = /^([a-z]+)_id$/.exec(k);
        if (!fk || typeof v !== 'string' || !UUID_ONLY.test(v)) continue;
        const fid = v.toLowerCase();
        const prior = out.get(fid);
        if (prior && !prior.linked) continue; // a record's own label always wins
        out.delete(fid);
        out.set(fid, { kind: fk[1], label: `(linked to ${kindHere} "${own.slice(0, 50)}")`, id: fid, linked: true });
      }
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') walk(v, GENERIC_KEYS.has(k) ? kind : singular(k), out, depth + 1);
  }
}

/** Index the labeled records (and their foreign keys) in one fresh tool result. */
export function indexEntities(result: unknown, toolName: string, into: Map<string, KnownEntity>): void {
  walk(result, kindOfTool(toolName), into);
}

/** A persisted tool_result body is JSON, optionally followed by a "\n\n[observation_id…]" stamp. */
function parseToolBody(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  const cut = content.indexOf('\n\n[');
  try {
    return JSON.parse(cut >= 0 ? content.slice(0, cut) : content);
  } catch {
    return null;
  }
}

/**
 * Walk persisted history rows (oldest first) and collect the labeled records her
 * past tool results showed her. tool_use ids on assistant rows name the tool, so
 * a bare `{id, name}` row still gets its kind.
 */
export function extractKnownEntities(rows: Array<{ role: string; content: unknown }>, cap = 40): KnownEntity[] {
  const toolNameById = new Map<string, string>();
  const out = new Map<string, KnownEntity>();
  for (const row of rows) {
    if (!Array.isArray(row.content)) continue;
    for (const b of row.content as any[]) {
      if (row.role === 'assistant' && b?.type === 'tool_use' && typeof b.id === 'string') toolNameById.set(b.id, b.name);
      if (row.role === 'tool' && b?.type === 'tool_result' && !b.is_error) {
        walk(parseToolBody(b.content), kindOfTool(toolNameById.get(b.tool_use_id)), out);
      }
    }
  }
  return [...out.values()].slice(-cap);
}

export function formatKnownEntities(entities: KnownEntity[]): string {
  if (entities.length === 0) return '';
  return (
    `\n\n## IDs you've already been shown in this thread\n` +
    `Tool results from earlier turns are NOT replayed to you — these are the real ids from them (oldest first). ` +
    `Copy ids VERBATIM from this list or from a tool result. Never shorten, pad, or build an id from a name. ` +
    `If what you need isn't here, look it up with the matching get_ tool before using it — a guessed id is refused before anything runs.\n` +
    entities.map((e) => `- ${e.kind} · ${e.label} · ${e.id}`).join('\n')
  );
}

// ── 2. VET ──────────────────────────────────────────────────────────────────

/** Kinds whose `<kind>_id` field name reliably names the table it points at
 *  (verified against the FKs: every client_id → janet_clients, contact_id →
 *  clearear_contacts, deal_id → janet_deals, …). */
const CORE_KINDS = new Set(['deal', 'client', 'contact', 'doc', 'site', 'invoice', 'lead', 'prospect']);

/**
 * Refuse a tool call whose id inputs she was never shown — or that are the wrong
 * KIND of id for the field. `known` = every UUID in her instructions, Blue's
 * messages, the page, and all tool results (past and this turn); `kinds` = what
 * each id she's been shown actually is. Pass null to check shape only.
 * Returns the refusal text for the tool_result, or null when the ids are sound.
 */
export function vetToolIds(input: unknown, known: Set<string> | null, kinds?: Map<string, KnownEntity>): string | null {
  if (!input || typeof input !== 'object') return null;
  const problems: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const vals = ID_KEY.test(k) ? [v] : ID_LIST_KEY.test(k) && Array.isArray(v) ? v : [];
    // contractor_contact_id → contact, client_id → client, session_ids → session
    const fieldKind = /(?:^|_)([a-z]+)_ids?$/.exec(k)?.[1] ?? null;
    for (const raw of vals) {
      if (typeof raw !== 'string' || raw.trim() === '') continue;
      const val = raw.trim();
      if (!UUID_ONLY.test(val)) problems.push(`${k} "${val}" is not an id — real ids are full 36-character UUIDs.`);
      else if (ZERO_FILLED.test(val)) problems.push(`${k} "${val}" is a short id padded with zeros — not a real id.`);
      else if (known && !known.has(val.toLowerCase())) problems.push(`${k} "${val}" doesn't appear in any tool result, the page, or Blue's messages in this thread — it was guessed or misremembered.`);
      else if (fieldKind && CORE_KINDS.has(fieldKind) && kinds) {
        // Wrong-type id (ledger 08-13: a DEAL id passed as client_id → empty result →
        // "no tracked page exists", which was false).
        const actual = kinds.get(val.toLowerCase());
        if (actual && actual.kind !== fieldKind && CORE_KINDS.has(actual.kind)) {
          problems.push(`${k} "${val}" is a ${actual.kind} id (${actual.label}), not a ${fieldKind} id — wrong record type.`);
        }
      }
    }
  }
  if (problems.length === 0) return null;
  return (
    `ID CHECK FAILED — nothing ran. ${problems.join(' ')} ` +
    `Ids are copied VERBATIM from a tool result or the known-ids list in your instructions — never shortened, padded, or made from a name. ` +
    `Look it up first with the matching read (get_deals, get_docs, get_clients, get_clearear_contacts, get_leads, get_clearear_invoices …), then retry with the exact id it returns. ` +
    `If a call in this same batch will return the id, wait for its result instead of calling in parallel.`
  );
}

/**
 * An 8-hex-char id FRAGMENT not part of a full UUID. The seed of the zero-padding
 * fabrications: a 2026-07-23 memory said "deal id=2ba7caf0", and she later padded that
 * into "2ba7caf0-0000-0000-0000-000000000000" (08-11, 08-19). Requires a digit AND a
 * letter so ordinary numbers (a check # like 00161641) and words never trip it.
 */
export function findShortIdFragment(text: string): string | null {
  for (const m of text.matchAll(/\b[0-9a-f]{8}\b/gi)) {
    const frag = m[0];
    if (!/[a-f]/i.test(frag) || !/[0-9]/.test(frag)) continue;
    const i = m.index ?? 0;
    if (/^-[0-9a-f]{4}-/i.test(text.slice(i + 8, i + 14))) continue; // head of a full UUID
    return frag;
  }
  return null;
}

/** Turn opaque DB errors into something she can act on (and won't mistake for an outage). */
export function explainToolError(error: string): string {
  if (/Cannot coerce the result to a single JSON object|PGRST116/i.test(error)) {
    return `${error} — no record has that id. The id is wrong, not the system: look it up with the matching read instead of retrying it.`;
  }
  if (/invalid input syntax for type uuid/i.test(error)) {
    return `${error} — that isn't a real id. Look it up first and pass the full id the read returns.`;
  }
  return error;
}
