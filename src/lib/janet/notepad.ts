// JANET discovery notepad — the intelligence layer (JANET_ADMIN_NOTEPAD_SPEC Task 3)
//
// Three Claude-backed helpers, all model-optional (degrade to the standard bank /
// empty extraction rather than throwing, so the notepad always works):
//   1. buildPreppedQuestions — prospect-specific + deal-type + standard baseline
//   2. extractFields         — quiet background structuring of freeform notes
//   3. buildRecap            — "here's what I heard" in JANET's voice + next step

import { anthropic } from '../anthropic';
import { JANET_MODEL } from './config';
import { supabaseAdmin } from '../supabase';

export type QuestionKind = 'prospect' | 'type' | 'standard';
export type PreppedQuestion = { q: string; kind: QuestionKind; topic: string };
export type DealType = 'refresh' | 'new_build' | 'rescue' | null;

/** A prepped question Blue ticked as covered during the call. */
export type CoverageItem = { topic: string; question: string; detail?: string | null };

/** Covered-but-thin flag: a topic marked covered where no concrete detail
 *  landed in the notes. Distinct from a field being blank because it was never
 *  discussed — surfaced so Blue fills it rather than JANET guessing/omitting. */
export type Gap = { topic: string; note: string };

export type PendingFields = {
  contact_name?: string | null;
  contact_email?: string | null;
  value_estimate?: number | null;
  timeline?: string | null;
  decision_maker?: string | null;
  scope?: string | null;
  pain_points?: string[] | null;
  next_action?: string | null;
  next_action_due?: string | null; // ISO date (YYYY-MM-DD)
  stage?: string | null;
  summary?: string | null;
  gaps?: Gap[] | null;
};

/** Scan out the first complete, balanced JSON value (object or array) starting
 *  at the first bracket — tolerant of trailing prose after the JSON. Returns
 *  null if it never balances (e.g. token-limit truncation). String-aware so
 *  brackets inside string literals don't throw off the depth count. */
function extractBalanced(s: string): string | null {
  const start = s.search(/[[{]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Pull JSON out of a model reply that may be fenced or padded with prose.
 *  Extracts the first balanced value so a trailing sentence doesn't nuke the
 *  whole parse; falls back to a naive slice only if balancing fails. */
function parseJson<T>(text: string, fallback: T): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const balanced = extractBalanced(raw) ?? extractBalanced(text);
  if (balanced) {
    try {
      return JSON.parse(balanced) as T;
    } catch {
      /* fall through */
    }
  }
  const start = raw.search(/[[{]/);
  if (start !== -1) {
    try {
      return JSON.parse(raw.slice(start)) as T;
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

async function ask(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await anthropic.messages.create({
    model: JANET_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return res.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
}

// ─── 1. Prepped questions ──────────────────────────────────────────────

type BankRow = { text: string; topic: string };

/** Derive a short topic when a bank row has none (e.g. added before topics). */
function fallbackTopic(text: string): string {
  return text.replace(/[—:(].*$/, '').trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase() || 'topic';
}

async function loadBank(dealType: DealType): Promise<{ standard: BankRow[]; template: BankRow[] }> {
  const { data } = await supabaseAdmin
    .from('janet_question_bank')
    .select('text, topic, deal_type, sort')
    .eq('active', true)
    .order('sort', { ascending: true });
  const rows = data ?? [];
  const toRow = (r: any): BankRow => ({ text: r.text, topic: r.topic || fallbackTopic(r.text) });
  return {
    standard: rows.filter((r) => !r.deal_type).map(toRow),
    template: dealType ? rows.filter((r) => r.deal_type === dealType).map(toRow) : [],
  };
}

const PROSPECT_Q_SYSTEM = `You are JANET, BLVSTACK's internal operator, prepping Blue for a discovery call.
From what is known about this prospect, generate 4-6 SHARP, prospect-SPECIFIC discovery questions Blue should ask.

RULES (critical):
- Every question must reference a specific detail from THIS prospect — their site, their business, an audit finding, the context Blue gave you. If a question would apply to any random lead, DROP it.
- No generic openers ("what's your goal", "what's your budget", "who's involved", "what does success look like") — those are already covered by a standard set. You add the ones only knowledge of THIS prospect makes possible.
- Frame each as something Blue would actually ask to determine scope, fit, or risk.
- If you genuinely know little, return fewer questions (even zero) rather than padding with generic ones.

Each question gets a "topic": a 1-3 word lowercase tag Blue will see as a coverage marker (e.g. "wix conversion", "booking flow", "mobile speed"). Keep topics distinct from each other.

Output ONLY a JSON array of objects: [{ "q": string, "topic": string }]. No prose, no markdown.`;

async function prospectQuestions(opts: {
  deal?: any;
  context?: string | null;
  dealType?: DealType;
  latestFindings?: any[];
}): Promise<{ q: string; topic: string }[]> {
  const { deal, context, dealType, latestFindings } = opts;
  if (!deal && !context) return [];
  const parts: string[] = [];
  if (deal) {
    parts.push(
      `Deal: ${deal.name}` +
        (deal.contact_name ? ` · contact ${deal.contact_name}` : '') +
        (deal.source ? ` · source ${deal.source}` : '') +
        (deal.value_estimate ? ` · est $${deal.value_estimate}` : '') +
        (deal.stage ? ` · stage ${deal.stage}` : '')
    );
    if (deal.notes) parts.push(`What Blue already noted: ${deal.notes}`);
  }
  if (context) parts.push(`Context Blue gave about this person/opportunity:\n${context}`);
  if (dealType) parts.push(`Engagement type: ${dealType.replace('_', ' ')}`);
  if (latestFindings?.length) {
    parts.push(
      'Recent audit of their site found:\n' +
        latestFindings
          .slice(0, 8)
          .map((f: any) => `- [${f.severity}] ${f.issue}`)
          .join('\n')
    );
  }
  const text = await ask(PROSPECT_Q_SYSTEM, parts.join('\n\n'), 800);
  return parseJson<{ q: string; topic: string }[]>(text, [])
    .filter((o) => o && typeof o.q === 'string' && o.q.trim())
    .map((o) => ({ q: o.q.trim(), topic: (o.topic || fallbackTopic(o.q)).toString().trim().toLowerCase() }))
    .slice(0, 6);
}

/** Layered prepped set: prospect-specific first (most valuable), then deal-type
 *  template, then the standard baseline. Prospect layer degrades to empty.
 *  Topics are deduped so coverage markers stay unambiguous. */
export async function buildPreppedQuestions(opts: {
  deal?: any;
  context?: string | null;
  dealType?: DealType;
  latestFindings?: any[];
}): Promise<PreppedQuestion[]> {
  const { standard, template } = await loadBank(opts.dealType ?? null);
  let prospect: { q: string; topic: string }[] = [];
  try {
    prospect = await prospectQuestions(opts);
  } catch (e) {
    console.error('[notepad] prospect questions failed:', (e as Error).message);
  }
  const seenQ = new Set<string>();
  const seenTopic = new Set<string>();
  const out: PreppedQuestion[] = [];
  const push = (q: string, topic: string, kind: QuestionKind) => {
    const key = q.trim().toLowerCase();
    if (!key || seenQ.has(key)) return;
    seenQ.add(key);
    // Keep topics unique so a "✓ topic — covered" marker maps to one question.
    let t = topic.trim().toLowerCase() || fallbackTopic(q);
    if (seenTopic.has(t)) {
      let n = 2;
      while (seenTopic.has(`${t} ${n}`)) n++;
      t = `${t} ${n}`;
    }
    seenTopic.add(t);
    out.push({ q: q.trim(), kind, topic: t });
  };
  prospect.forEach((o) => push(o.q, o.topic, 'prospect'));
  template.forEach((r) => push(r.text, r.topic, 'type'));
  standard.forEach((r) => push(r.text, r.topic, 'standard'));
  return out;
}

// ─── 2. Background field extraction ────────────────────────────────────

const EXTRACT_SYSTEM = `You are JANET quietly structuring rough discovery-call notes into deal fields while Blue types.
Extract ONLY what the notes actually support. Never invent. Leave a field null if the notes don't say.

You are also given COVERAGE: topics Blue ticked as covered during the call. Coverage changes how you treat a blank field:
- A field blank because the topic was NEVER covered → just leave it null. Not a gap.
- A field blank BUT its topic was ticked covered → this is a GAP: Blue discussed it but no concrete detail landed in the notes. Do NOT silently leave it blank — add a { topic, note } to "gaps" (e.g. { "topic": "budget", "note": "covered but no number captured" }). Still leave the field itself null; the gap tells Blue to fill it.
- If a covered topic DOES have detail in the notes, extract it normally and do not add a gap.

Output ONLY this JSON object (no prose, no markdown):
{
  "contact_name": string|null,
  "contact_email": string|null,
  "value_estimate": number|null,      // budget as a single number in dollars if stated/impliable
  "timeline": string|null,            // e.g. "wants live by Sept", "no rush"
  "decision_maker": string|null,
  "scope": string|null,               // one line: what's in / out
  "pain_points": string[]|null,       // the real problems, not stated wants
  "next_action": string|null,         // the concrete next step this call implies
  "next_action_due": string|null,     // ISO date YYYY-MM-DD if a date is derivable, else null
  "stage": "inquiry"|"discovery_scheduled"|"discovery_done"|"proposal_sent"|"negotiating"|null,
  "summary": string|null,             // one tight sentence of the opportunity
  "gaps": [{ "topic": string, "note": string }]|null  // covered-but-thin topics only
}`;

function coverageBlock(coverage?: CoverageItem[]): string {
  if (!coverage?.length) return 'COVERAGE: (nothing was ticked covered — treat all blanks as simply not discussed)';
  const lines = coverage.map((c) => `- ${c.topic}${c.detail ? ` (Blue noted: ${c.detail})` : ''}`).join('\n');
  return `COVERAGE — topics Blue ticked covered during the call:\n${lines}`;
}

export async function extractFields(notes: string, deal?: any, coverage?: CoverageItem[]): Promise<PendingFields> {
  if (!notes.trim()) return {};
  const ctx = deal ? `Existing deal context: ${deal.name}${deal.stage ? ` (stage ${deal.stage})` : ''}\n\n` : '';
  const today = new Date().toISOString().slice(0, 10);
  const text = await ask(
    EXTRACT_SYSTEM,
    `${ctx}Today is ${today}.\n\n${coverageBlock(coverage)}\n\nCall notes:\n\n${notes}`,
    1000
  );
  return parseJson<PendingFields>(text, {});
}

// ─── 3. Recap + next step, in JANET's voice ────────────────────────────

const RECAP_SYSTEM = `You are JANET, BLVSTACK's internal operator, playing back a discovery call to Blue.
Write a short "here's what I heard" recap — 3-5 sentences, plain text, JANET's voice: direct, competent, no filler, no emojis, no markdown. Capture the real opportunity and the problem underneath the stated want. Then, on its own, state the single most sensible next step.

Factor COVERAGE:
- If a topic was ticked covered but you have no concrete detail for it, name it in the recap as an open item ("You covered budget but I didn't catch a number"). Do not pretend it's resolved.
- If a topic was never covered, do NOT flag it as missing — it simply wasn't part of this call.

Output ONLY this JSON (no prose, no markdown):
{ "recap": string, "next_action": string, "next_action_due": string|null }
next_action_due is an ISO date (YYYY-MM-DD) if a sensible one is derivable, else null.`;

export async function buildRecap(
  notes: string,
  fields: PendingFields,
  deal?: any,
  coverage?: CoverageItem[]
): Promise<{ recap: string; next_action: string | null; next_action_due: string | null }> {
  const today = new Date().toISOString().slice(0, 10);
  const dealLine = deal ? `Deal: ${deal.name}\n` : 'New opportunity (no deal record yet)\n';
  const text = await ask(
    RECAP_SYSTEM,
    `${dealLine}Today is ${today}.\n\n${coverageBlock(coverage)}\n\nStructured so far: ${JSON.stringify(fields)}\n\nRaw call notes:\n${notes}`,
    800
  );
  const parsed = parseJson<{ recap?: string; next_action?: string; next_action_due?: string | null }>(text, {});
  return {
    recap: parsed.recap ?? '',
    next_action: parsed.next_action ?? fields.next_action ?? null,
    next_action_due: parsed.next_action_due ?? fields.next_action_due ?? null,
  };
}
