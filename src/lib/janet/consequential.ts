// Phase 2.5/2.7/2.8 — the PURE core of the consequential-claim enforcement engine.
//
// Deliberately has NO imports (no supabase, no anthropic, no env), so every
// heuristic here is directly unit-testable in isolation. The DB layer
// (observations.ts) and the model layer (entailment.ts) build on top of this.
//
// A "consequential claim" is an assertion of a fact whose truth the system can
// and must check against a real observation: is it published, did it send/deliver,
// did they view it, is this lead real, how much revenue was recovered. The model
// may only assert these when grounded by an observation of the right type; an
// ungrounded consequential claim is inference by construction and must be blocked
// (2.5). A grounded one must still be ENTAILED by the observation (2.8).

export type ClaimClass = 'published' | 'sent' | 'viewed' | 'lead_real' | 'recovered_revenue';

export const CONSEQUENTIAL_CLASSES: ClaimClass[] = ['published', 'sent', 'viewed', 'lead_real', 'recovered_revenue'];

// How fresh an observation must be to ground a claim of this class (2.6/2.7).
// published/sent are effectively zero-TTL for a live assertion — must come from
// THIS turn's read/ledger, never a stale one. Within a single turn every
// this-turn observation is fresh; TTL governs cross-turn / post-compaction grounding.
export const CLASS_TTL_SECONDS: Record<ClaimClass, number> = {
  published: 0,
  sent: 0,
  viewed: 600,
  lead_real: 300,
  recovered_revenue: 300,
};

// Which consequential classes a tool's RESULT can ground (observation → provenance).
// 'sent' is deliberately absent from every read tool: there is no in-chat read that
// confirms a delivery, so a "it was delivered" claim is ungroundable here and must
// resolve to "unknown" (2.9) — delivery truth lives in the action ledger via webhook.
const TOOL_CLASSES: Record<string, ClaimClass[]> = {
  publish_page: ['published'],
  get_page_views: ['published', 'viewed'],
  get_recipient_links: ['published'],
  unpublish_page: ['published'],
  get_leads: ['lead_real'],
  get_lead: ['lead_real'],
  get_psrx_recovered_revenue: ['recovered_revenue'],
};

export function toolClaimClasses(name: string): ClaimClass[] {
  return TOOL_CLASSES[name] ?? [];
}

// ── Claim detection ────────────────────────────────────────────────────────
// Conservative, past/passive-tense regexes — we would rather MISS a claim than
// falsely retract a true statement (a false positive forces a needless correction).
// 'published' and 'sent (I sent it)' completion claims stay with the brain's existing
// detectFabrication (proven/tuned); this layer adds the state-assertion classes.
const CLAIM_PATTERNS: { cls: ClaimClass; re: RegExp }[] = [
  // "they viewed it", "opened the proposal", "3 opens", "spent 4 min reading"
  { cls: 'viewed', re: /\b(viewed it|opened it|opened the (?:proposal|page|doc|link)|they (?:viewed|opened|read) it|\d+\s+(?:views?|opens?)\b|spent\s+[\d.]+\s*(?:min|minutes|m)\s+(?:on|reading|viewing))\b/i },
  // "this lead is real/genuine/qualified/not spam", "it's a real lead"
  { cls: 'lead_real', re: /\b(?:this|the|that)\s+lead\s+is\s+(?:real|genuine|legit|legitimate|qualified|not\s+spam|not\s+a\s+bot)\b|\bit['’]?s\s+a\s+(?:real|genuine|legit|legitimate)\s+lead\b/i },
  // "recovered $X", "$X recovered / won back / brought back", "recovered revenue"
  { cls: 'recovered_revenue', re: /\b(?:recovered|won back|brought back|recouped)\b[^.\n]{0,24}\$[\d,]+|\$[\d,]+[^.\n]{0,24}\b(?:recovered|recovery|won back|brought back|recouped)\b|\brecovered revenue\b/i },
  // state assertion of delivery (distinct from "I sent it" which detectFabrication owns)
  { cls: 'sent', re: /\b(?:the\s+)?(?:email|reply|message|follow-?up|it)\s+(?:was|has been|got)\s+(?:delivered|sent)\b|\bdelivery\s+(?:confirmed|succeeded|is confirmed)\b/i },
  // grounded-for-entailment: publish state assertion (grounding stays with detectFabrication)
  { cls: 'published', re: /\b(?:it['’]?s|it is|the page is|now)\s+live\s+(?:at\b|now\b|\.)|\b(?:has been|was)\s+published\b/i },
];

/** Consequential claim classes ASSERTED in the text (deduped). */
export function detectConsequentialClaims(text: string): ClaimClass[] {
  const found = new Set<ClaimClass>();
  for (const { cls, re } of CLAIM_PATTERNS) if (re.test(text)) found.add(cls);
  return [...found];
}

// Classes whose GROUNDING this engine enforces (the rest — published, and the
// "I sent it" completion — stay with the brain's detectFabrication to avoid double
// handling). A claim of one of these with no matching observation this turn is a gap.
export const GROUNDING_CLASSES: ClaimClass[] = ['viewed', 'lead_real', 'recovered_revenue', 'sent'];

/** Consequential claims asserted with NO fresh observation of that class this turn.
 *  These must be blocked (forced re-read or "unknown"). */
export function groundingGaps(text: string, observedClasses: Iterable<ClaimClass>): ClaimClass[] {
  const claimed = detectConsequentialClaims(text);
  const grounded = new Set<ClaimClass>(observedClasses);
  return claimed.filter((c) => GROUNDING_CLASSES.includes(c) && !grounded.has(c));
}

// ── Citation flip (2.5, strongest form) ────────────────────────────────────
// Grounding asks "does an observation of this class EXIST this turn?". The flip is
// stricter: the model must CITE the observation it's asserting from — every
// consequential read is returned with an observation_id, and a consequential claim
// must carry [obs:obs_N] resolving to a this-turn observation of that class.
// Uncited = inference by construction = blocked. 'sent' has no read that grounds
// it (delivery lives in the ledger via webhook), so a delivery claim is uncitable
// here → always a gap → forces "unknown".

const CITATION_RE = /\[obs:\s*(obs_\d+)\s*\]/gi;

/** The observation ids the model cited in its text. */
export function parseCitations(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(CITATION_RE)) ids.add(m[1].toLowerCase());
  return ids;
}

// Citations are INTERNAL provenance: the trust layer reads them, then they're
// stripped from anything Blue sees (streamed text + persisted history). A complete
// tag, plus any single leading space, is removed.
const OBS_TAG_STRIP_RE = /[ \t]?\[obs:\s*obs_\d+\s*\]/gi;

export function stripObsTags(text: string): string {
  return text.replace(OBS_TAG_STRIP_RE, '');
}

// Streaming stripper — a tag can be split across token deltas, so we hold back a
// trailing substring that could still become a tag, and drop complete tags as they
// close. push() returns the safe-to-render text; flush() returns the remainder at
// stream end (a dangling partial that never completed is real text, so it's kept).
const _TAG = '[obs:obs_';
const _PARTIALS: string[] = [];
for (let i = 1; i <= _TAG.length; i++) _PARTIALS.push(_TAG.slice(0, i).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
// Hold back a trailing partial tag, a trailing "space + partial", OR a lone trailing
// space (a tag might follow it — the tag strip eats one leading space, so we must not
// emit that space early). A held space that turns out NOT to precede a tag is emitted
// on the next push, one delta late.
const _PARTIAL_RE = new RegExp('[ \\t]$|[ \\t]?(?:' + _PARTIALS.join('|') + '|\\[obs:obs_\\d+)$');

export function makeObsTagStripper() {
  let buf = '';
  return {
    push(delta: string): string {
      buf += delta;
      buf = buf.replace(OBS_TAG_STRIP_RE, ''); // drop any COMPLETE tags
      const m = buf.match(_PARTIAL_RE); // hold back a trailing PARTIAL tag
      const emitLen = m ? (m.index ?? buf.length) : buf.length;
      const out = buf.slice(0, emitLen);
      buf = buf.slice(emitLen);
      return out;
    },
    flush(): string {
      const out = buf.replace(OBS_TAG_STRIP_RE, '');
      buf = '';
      return out;
    },
  };
}

/** Consequential claim classes asserted WITHOUT a citation to a this-turn observation
 *  of that class. `observations` are this turn's, each with its turn-local id + classes. */
export function citationGaps(
  text: string,
  observations: { id: string; classes: readonly string[] }[],
  citedIds: Set<string>
): ClaimClass[] {
  const claimed = detectConsequentialClaims(text);
  if (claimed.length === 0) return [];
  const citedClasses = new Set<string>();
  for (const o of observations) {
    if (!citedIds.has(o.id.toLowerCase())) continue;
    for (const c of o.classes) citedClasses.add(c);
  }
  return claimed.filter((c) => !citedClasses.has(c));
}

export const CITATION_GAP_MESSAGE: Record<ClaimClass, string> = {
  published: 'a "published/live" claim not cited to an observation — read get_page_views and cite [obs:obs_N], or say you haven\'t confirmed it',
  viewed: 'a "they viewed/opened it" claim not cited to a get_page_views observation ([obs:obs_N]) — cite it or say "unknown"',
  lead_real: 'a "this lead is real/qualified" claim not cited to a get_lead/get_leads observation — cite it or say "unknown"',
  recovered_revenue: 'a recovered-revenue figure not cited to a get_psrx_recovered_revenue observation — cite it or say "unknown"',
  sent: 'a "sent/delivered" claim — delivery is confirmed only by the action ledger via the webhook, so there is no observation to cite here; say it fired but delivery is unconfirmed, never assert delivery',
};

export const GROUNDING_GAP_MESSAGE: Record<ClaimClass, string> = {
  viewed: 'a "they viewed/opened it" claim, but no engagement read (get_page_views) grounds it this turn',
  lead_real: 'a "this lead is real/qualified" claim, but no lead read (get_lead/get_leads) grounds it this turn',
  recovered_revenue: 'a recovered-revenue figure, but no get_psrx_recovered_revenue read grounds it this turn',
  sent: 'a "it was sent/delivered" claim, but delivery is only confirmed by the action ledger via the webhook — you cannot assert it from here',
  published: 'a "published/live" claim with no publish_page/get_page_views result this turn',
};

// ── Outbound validator (2.8) ───────────────────────────────────────────────
// Before any cold-outbound draft is sent, check it against forbidden claims +
// number-consistency. Pure + conservative: it should catch invented specifics
// and unbacked guarantees without tripping on ordinary copy.

// Phrases cold outbound must never assert (guarantees, invented familiarity,
// superlatives we can't back). Callers may extend/override per niche.
export const DEFAULT_FORBIDDEN_OUTBOUND: string[] = [
  'guarantee',
  'guaranteed',
  '100% guaranteed',
  'risk-free',
  'as we discussed',
  'per our (?:conversation|call)',
  'following up on our (?:call|meeting|conversation)',
  'as promised',
  'best in the (?:industry|business|world)',
  '#1 (?:in|choice|rated)',
  'double your (?:revenue|sales|traffic|leads)',
  'triple your (?:revenue|sales|traffic|leads)',
];

/** Money amounts, percentages, and multipliers stated in the draft. These are the
 *  claims most damaging to fabricate, so each must trace to the source material. */
export function extractClaimNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\$[\d,]+(?:\.\d+)?[km]?\b/gi)) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\s?%/g)) out.add(m[0].replace(/\s+/g, ''));
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?x\b/gi)) out.add(m[0].toLowerCase());
  return [...out];
}

// ── Structural fabrication detector (moved here, tightened) ─────────────────
// A COMPLETION claim for a mutating action ("I updated the doc", "it's live at…",
// "the reply was sent") is only truthful if a satisfying tool SUCCEEDED this turn.
// The previous version matched bare words on the whole message, so it fired on
// NEGATIONS ("not confirmed published"), QUESTIONS ("want me to check?"), and plain
// STATE reports ("the proposal is ready"). This version works CLAUSE-BY-CLAUSE and
// only considers affirmative, first-person / passive completion framing — a clause
// that is negated, interrogative, or about verification status is never a claim.

export type FabKind = 'doc' | 'publish' | 'send';
export const DOC_SATISFY = new Set(['update_doc', 'create_doc', 'get_doc', 'get_docs']);
export const PUBLISH_SATISFY = new Set(['publish_page', 'get_page_views']);
// Sends are Ring 3 (post-approval, never in-turn) — any in-turn "I sent it" is a fabrication.
export const SEND_SATISFY = new Set(['send_email', 'send_lead_reply', 'send_message_reply']);

function hasAny(used: Set<string>, allowed: Set<string>): boolean {
  for (const name of allowed) if (used.has(name)) return true;
  return false;
}

// Guards that disqualify a clause from being a COMPLETION claim (kill the false positives).
const NEGATION = /\b(?:not|never|without|un(?:confirmed|verified|published|sent)|no longer|yet to|have not|has not|had not|do not|does not|did not|cannot|can not|won['’]?t|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|haven['’]?t|hasn['’]?t|hadn['’]?t|didn['’]?t|don['’]?t|doesn['’]?t|won['’]?t)\b|n['’]t\b/i;
const META = /\b(?:not confirmed|unconfirmed|unverified|can['’]?t confirm|cannot confirm|by me this turn|i don['’]?t know|not sure|unsure|would need to|need to (?:check|verify|confirm|read|call)|let me (?:check|verify|confirm|read|pull|look)|going to (?:check|verify|read)|should i (?:check|verify)|to confirm)\b/i;
const INTERROGATIVE = /\b(?:want me to|should i|shall i|do you want|would you like|can i|may i|let me know if|should we|do you want me)\b/i;

function isCompletionClause(c: string): boolean {
  if (c.includes('?')) return false;
  if (INTERROGATIVE.test(c)) return false;
  if (META.test(c)) return false;
  if (NEGATION.test(c)) return false;
  return true;
}

/** First-person / passive COMPLETION claims of a mutating action that no satisfying
 *  tool backs this turn. Conservative by construction — misses before it over-fires. */
export function detectFabrication(text: string, used: Set<string>): FabKind[] {
  const out = new Set<FabKind>();
  // Per-clause: a negation/question in one sentence must not suppress a real claim
  // in another, and a trigger word must not fire from inside a negated clause.
  for (const raw of text.split(/(?<=[.!?\n;])\s+/)) {
    const c = raw.toLowerCase().trim();
    if (!c || !isCompletionClause(c)) continue;

    // DOC — first-person write, or "the doc is now updated/created/saved/fillable".
    // State words 'ready'/'live' are REMOVED — they describe status, not a write she did.
    const docDone =
      /\b(?:i['’]?ve|i have|i just)\s+(?:updated|revised|rewrote|rewritten|edited|added to|saved|created|built|filled in|turned)\b/.test(c) ||
      /\b(?:the|your|this)\s+(?:doc|document|questionnaire|form|proposal|scope|brief|protocol|campaign)\b[^.\n]{0,28}\b(?:is now|has been|now has|now includes)\b[^.\n]{0,20}\b(?:updated|revised|created|saved|a fillable form|fillable)\b/.test(c) ||
      /\bturned (?:it|this|the doc|the document)\b[^.\n]{0,30}\b(?:into|to)\b[^.\n]{0,30}\b(?:form|questionnaire)\b/.test(c);
    if (docDone && !hasAny(used, DOC_SATISFY)) out.add('doc');

    // PUBLISH — require COMPLETION framing, never the bare word "published".
    const publishDone =
      /\b(?:i['’]?ve|i have|i just)\s+published\b/.test(c) ||
      /\bit['’]?s (?:now )?live at\b/.test(c) ||
      /\b(?:is|it['’]?s) now live\b/.test(c) ||
      /\bwent live\b/.test(c) ||
      /\bhas been published\b/.test(c);
    if (publishDone && !hasAny(used, PUBLISH_SATISFY)) out.add('publish');

    // SEND — first-person send, or "the email/reply was sent" (affirmative clause).
    const sendDone =
      /\b(?:i['’]?ve|i have|i just)\s+(?:sent|emailed|fired off|shot over|messaged)\b/.test(c) ||
      /\b(?:the|your)?\s*(?:email|reply|message|follow-?up)\b[^.\n]{0,20}\b(?:has been|was|is)\s+sent\b/.test(c);
    if (sendDone && !hasAny(used, SEND_SATISFY)) out.add('send');
  }
  return [...out];
}

export type OutboundValidation = { ok: boolean; violations: string[] };

/**
 * Validate an outbound draft. `forbiddenClaims` are regex fragments (case-insensitive);
 * if `sourceText` is provided, every money/%/multiplier figure in the draft must appear
 * in it (number-consistency) — an unbacked figure is flagged, not silently sent.
 */
export function validateOutboundDraft(
  text: string,
  opts: { forbiddenClaims?: string[]; sourceText?: string } = {}
): OutboundValidation {
  const violations: string[] = [];
  const forbidden = opts.forbiddenClaims ?? DEFAULT_FORBIDDEN_OUTBOUND;
  for (const frag of forbidden) {
    try {
      if (new RegExp(`\\b${frag}\\b`, 'i').test(text)) violations.push(`forbidden claim: "${frag}"`);
    } catch {
      if (text.toLowerCase().includes(frag.toLowerCase())) violations.push(`forbidden claim: "${frag}"`);
    }
  }
  if (opts.sourceText != null) {
    const src = opts.sourceText.toLowerCase().replace(/\s+/g, '');
    for (const n of extractClaimNumbers(text)) {
      const needle = n.replace(/\s+/g, '');
      if (!src.includes(needle)) violations.push(`unverifiable figure not in source: ${n}`);
    }
  }
  return { ok: violations.length === 0, violations };
}
