// JANET — The Dreaming Phase: the model transport seam.
//
// All dream model calls go through dreamComplete(). Today it is a direct,
// synchronous Sonnet call (the same transport the other crons use). D4 swaps
// the BODY of this one function to Anthropic's Batch API (overnight, ~half
// cost) and wires the dream's own budget cap around it — nothing else in the
// dreaming code changes, because everything routes through here.
//
// Ring discipline: this is analysis only. It returns text; it never acts.

import { anthropic } from '../../anthropic';
import { JANET_MODEL, usdCostOf } from '../config';
import { logTurnCost } from '../actions';

export interface DreamCompletion {
  text: string;
  cost: number;
}

/**
 * One dream analysis call. Deterministic-ish low temperature — we want stable,
 * grounded proposals, not creative drift. Cost is logged as a ringless audit row
 * so the dream's spend is visible even before D4's cap exists.
 */
export async function dreamComplete(system: string, user: string, maxTokens = 1500): Promise<DreamCompletion> {
  const resp = await anthropic.messages.create({
    model: JANET_MODEL,
    max_tokens: maxTokens,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();
  const cost = usdCostOf(resp.usage as any, JANET_MODEL);
  await logTurnCost(cost, `dream model call (${resp.usage?.input_tokens ?? 0}in/${resp.usage?.output_tokens ?? 0}out)`);
  return { text, cost };
}

/** Parse a JSON object/array out of a model reply that may be fenced or prefaced.
 *  Returns null on anything unparseable — the caller treats that as "no proposals",
 *  never as a silent failure that fabricates. */
export function parseDreamJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Fall back to the first {...} or [...] span if there's prose around it.
  if (s[0] !== '{' && s[0] !== '[') {
    const m = s.match(/[[{][\s\S]*[\]}]/);
    if (m) s = m[0];
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
