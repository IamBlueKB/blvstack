// Phase 2.8 — the entailment gate. A cheap (Haiku) NLI check that each consequential
// claim in her reply is actually ENTAILED by the tool result she's citing. This
// catches the case grounding can't: she called the RIGHT tool but MISREAD it
// ("get_page_views returned 2 opens" → she says "they opened it 5 times"). Non-entailed
// claims are returned for the brain to block + flag. Fail-open: a checker outage must
// never block a turn (better a missed check than a stuck operator).

import { anthropic } from '../anthropic';
import { JANET_MODEL_LIGHT, usdCostOf } from './config';
import { detectConsequentialClaims } from './consequential';

export type TurnObservation = { id: string; toolName: string; classes: string[]; payload: unknown };
export type UnsupportedClaim = { claim: string; reason: string };

const SYSTEM =
  'You are a strict fact-checker. You are given OBSERVATIONS (real tool results — the ground truth) and CLAIM_TEXT (an assistant message to its user). ' +
  'List every CONSEQUENTIAL factual claim in CLAIM_TEXT that is CONTRADICTED by, or NOT SUPPORTED by, the OBSERVATIONS — specifically claims about: whether something is published, was sent/delivered, whether or how much someone viewed a page, whether a lead is real, or a recovered-revenue amount. ' +
  'Numbers must match. Ignore opinions, plans, questions, offers to do something, and clearly hedged/uncertain statements. ' +
  'Respond with ONLY JSON: {"unsupported":[{"claim":"<verbatim snippet>","reason":"<why not supported>"}]}. If every consequential claim is supported, respond {"unsupported":[]}.';

function cap(p: unknown): unknown {
  try {
    const s = JSON.stringify(p);
    return s.length > 4000 ? s.slice(0, 4000) + '…' : p;
  } catch {
    return String(p).slice(0, 2000);
  }
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Returns the consequential claims in `text` NOT entailed by `observations`.
 * Runs the model ONLY when there is at least one consequential observation AND the
 * text makes a consequential claim — so ordinary turns pay nothing.
 */
export async function checkEntailment(
  text: string,
  observations: TurnObservation[],
  onCost?: (usd: number) => void
): Promise<UnsupportedClaim[]> {
  const relevant = observations.filter((o) => (o.classes?.length ?? 0) > 0);
  if (relevant.length === 0) return [];
  if (detectConsequentialClaims(text).length === 0) return [];

  const obsJson = JSON.stringify(relevant.map((o) => ({ tool: o.toolName, result: cap(o.payload) })));
  try {
    const resp = await anthropic.messages.create({
      model: JANET_MODEL_LIGHT,
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: 'user', content: `OBSERVATIONS:\n${obsJson}\n\nCLAIM_TEXT:\n${text}` }],
    });
    if (onCost) onCost(usdCostOf(resp.usage as any, JANET_MODEL_LIGHT));
    const txt = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const parsed = extractJson(txt);
    const arr = Array.isArray(parsed?.unsupported) ? parsed.unsupported : [];
    return arr
      .filter((x: any) => x && typeof x.claim === 'string')
      .map((x: any) => ({ claim: String(x.claim).slice(0, 200), reason: String(x.reason ?? 'not supported by the tool result').slice(0, 200) }));
  } catch (e) {
    console.error('[janet] entailment check failed (fail-open):', (e as Error).message);
    return [];
  }
}
