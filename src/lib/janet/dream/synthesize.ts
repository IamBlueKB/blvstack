// JANET — The Dreaming Phase, Job 3: Synthesize (the meta-insight layer).
//
// Reads the track record — resolved recommendations, scored predictions — plus
// the existing patterns/graveyard as context, and drafts CANDIDATE reasoning
// patterns, graveyard entries, and strategy notes. Example shape: "lead_triage
// recs are hitting 40% and my confidence on the failures matched the wins —
// proposing a calibration revision."
//
// These are PROPOSALS, never writes (Rail 2): synthesize auto-applies nothing.
// The model reads ONLY primary rows (outcomes + existing patterns) — never prior
// dream output (Rail 1) — and every proposal cites the primary evidence rows it
// is based on, validated against exactly what was passed in.

import { supabaseAdmin } from '../../supabase';
import { createProposal, type ProvRef, type DreamKind } from './proposals';
import { dreamComplete, parseDreamJson } from './model';

export interface SynthesizeSummary {
  dream_run_at: string;
  inputs: { resolved_recs: number; scored_predictions: number; patterns: number };
  proposed: { pattern: number; graveyard: number; strategy: number };
  proposal_ids: string[];
  // 'ok' = the model pass finished; 'incomplete' = it did NOT finish (proposed
  // counts are unknown, NOT zero). See consolidate.ts for the full contract.
  status: 'ok' | 'incomplete';
  note?: string;
}

const SINCE_DAYS = 60; // the window of outcomes synthesize reasons over

export async function runSynthesize(dreamRunAt?: string): Promise<SynthesizeSummary> {
  const dream_run_at = dreamRunAt ?? new Date().toISOString();
  const summary: SynthesizeSummary = {
    dream_run_at,
    inputs: { resolved_recs: 0, scored_predictions: 0, patterns: 0 },
    proposed: { pattern: 0, graveyard: 0, strategy: 0 },
    proposal_ids: [],
    status: 'ok',
  };

  const since = new Date(Date.now() - SINCE_DAYS * 86_400_000).toISOString();

  // ── Primary inputs ──────────────────────────────────────────────────────────
  const [recsRes, predsRes, patRes, graveRes] = await Promise.all([
    supabaseAdmin
      .from('janet_recommendations')
      .select('id, category, recommendation, outcome, outcome_value, blue_verdict, confidence, made_at')
      .not('outcome', 'is', null)
      .neq('outcome', 'unknown')
      .gte('made_at', since)
      .order('made_at', { ascending: false })
      .limit(400),
    supabaseAdmin
      .from('janet_predictions')
      .select('id, context, predicted, actual, outcome, pattern_id')
      .not('outcome', 'is', null)
      .order('resolved_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('janet_reasoning_patterns')
      .select('id, pattern, domain, confidence, times_confirmed, times_contradicted')
      .eq('active', true)
      .limit(100),
    supabaseAdmin.from('janet_graveyard').select('id, idea').eq('active', true).limit(100),
  ]);

  const recs = (recsRes.data ?? []) as any[];
  const preds = (predsRes.data ?? []) as any[];
  const patterns = (patRes.data ?? []) as any[];
  const graveyard = (graveRes.data ?? []) as any[];
  summary.inputs = { resolved_recs: recs.length, scored_predictions: preds.length, patterns: patterns.length };
  if (recs.length === 0 && preds.length === 0) return summary; // nothing resolved to learn from

  // Per-category hit-rate stats (deterministic — the model gets the math, not raw noise).
  const cat: Record<string, { total: number; worked: number; failed: number; partial: number }> = {};
  for (const r of recs) {
    const c = r.category ?? 'other';
    cat[c] ??= { total: 0, worked: 0, failed: 0, partial: 0 };
    cat[c].total++;
    if (r.outcome === 'worked') cat[c].worked++;
    else if (r.outcome === 'failed') cat[c].failed++;
    else if (r.outcome === 'partial') cat[c].partial++;
  }
  const catLines = Object.entries(cat).map(([c, s]) => {
    const d = s.worked + s.failed + s.partial;
    const hit = d > 0 ? Math.round((100 * (s.worked + s.partial * 0.5)) / d) : null;
    return `- ${c}: ${s.total} recs, hit_rate=${hit == null ? 'n/a' : hit + '%'} (worked ${s.worked}, failed ${s.failed}, partial ${s.partial})`;
  });

  const recIds = new Set(recs.map((r) => r.id));
  const predIds = new Set(preds.map((p) => p.id));
  const patIds = new Set(patterns.map((p) => p.id));

  const recLines = recs.slice(0, 120).map((r) => `- id=${r.id} [${r.category}] outcome=${r.outcome}${r.blue_verdict ? `/verdict=${r.blue_verdict}` : ''}${r.outcome_value ? ` $${r.outcome_value}` : ''} conf=${r.confidence ?? '?'} :: ${String(r.recommendation).slice(0, 100)}`);
  const predLines = preds.slice(0, 80).map((p) => `- id=${p.id} outcome=${p.outcome}${p.pattern_id ? ` pattern=${p.pattern_id}` : ''} :: predicted ${String(p.predicted).slice(0, 70)}`);
  const patLines = patterns.map((p) => `- id=${p.id} [${p.domain}] conf=${p.confidence} (+${p.times_confirmed}/-${p.times_contradicted}) :: ${String(p.pattern).slice(0, 100)}`);
  const graveLines = graveyard.map((g) => `- ${String(g.idea).slice(0, 90)}`);

  const system = [
    'You are JANET, synthesizing what your track record teaches, overnight. You are given: per-category hit rates, resolved recommendations, scored predictions, your existing reasoning patterns, and your existing graveyard.',
    'Draft CANDIDATE insights, grounded ONLY in the data provided. Never invent an outcome or a number. If the data does not support a candidate, propose nothing.',
    'Three kinds:',
    '- "pattern": a reasoning-pattern principle the outcomes support — a NEW one, or a REVISION of an existing pattern (set revise_id to its id, e.g. to recalibrate confidence when the win/loss confidence gap says you were overconfident). State the principle generally.',
    '- "graveyard": an idea/approach the record says to stop repeating (e.g. a category or framing that keeps failing), with why.',
    '- "strategy": a concrete strategy note worth remembering (e.g. "re-engagement framing A out-converts B").',
    'Every candidate MUST cite the primary evidence rows it is drawn from in "cite": recommendation or prediction ids from the lists provided. Do not cite anything not shown. Do not duplicate an existing pattern or graveyard entry.',
    'Output ONLY a JSON array. Item fields: {"kind","summary","rationale","cite":[{"table","id"}], and per kind: pattern -> "pattern","domain","confidence"(0-1),"revise_id"?(existing pattern id); graveyard -> "idea","why_killed","category","revisit_conditions"?; strategy -> "content"}.',
    'Be conservative and specific. A pattern needs a real signal in the numbers, not a hunch.',
  ].join('\n');

  const user = [
    `CATEGORY HIT RATES (last ${SINCE_DAYS}d):`,
    catLines.join('\n') || '(none)',
    '',
    'RESOLVED RECOMMENDATIONS:',
    recLines.join('\n') || '(none)',
    '',
    'SCORED PREDICTIONS:',
    predLines.join('\n') || '(none)',
    '',
    'EXISTING REASONING PATTERNS (revise by id; do not duplicate):',
    patLines.join('\n') || '(none)',
    '',
    'EXISTING GRAVEYARD (do not duplicate):',
    graveLines.join('\n') || '(none)',
  ].join('\n');

  let items: any[] = [];
  try {
    const { text } = await dreamComplete(system, user, 2200);
    const parsed = parseDreamJson<any[]>(text);
    if (Array.isArray(parsed)) {
      items = parsed;
    } else {
      summary.status = 'incomplete';
      summary.note = 'model output was unreadable';
      return summary;
    }
  } catch (e) {
    // Did NOT finish (batch timeout / budget / batch error) — reported as incomplete,
    // never as zero candidates.
    summary.status = 'incomplete';
    summary.note = (e as Error).name === 'DreamIncompleteError' ? (e as Error).message : `model pass errored: ${(e as Error).message}`;
    console.error('[dream] synthesize model pass incomplete:', summary.note);
    return summary;
  }

  for (const it of items) {
    const kind: DreamKind | undefined = it?.kind;
    if (kind !== 'pattern' && kind !== 'graveyard' && kind !== 'strategy') continue;
    const summaryText = typeof it.summary === 'string' && it.summary.trim() ? it.summary.trim() : `${kind} candidate`;

    // Validate cited provenance against the primary evidence rows we provided (Rail 1).
    const cites: ProvRef[] = Array.isArray(it.cite) ? it.cite.filter((c: any) => c && typeof c.table === 'string' && typeof c.id === 'string') : [];
    const validCites = cites.filter((c) => recIds.has(c.id) || predIds.has(c.id));
    if (validCites.length === 0) continue; // no verifiable evidence -> drop, don't fabricate

    const rationale = typeof it.rationale === 'string' ? it.rationale : null;
    let payload: Record<string, unknown> = {};
    if (kind === 'pattern') {
      const patternText = typeof it.pattern === 'string' && it.pattern.trim() ? it.pattern.trim() : summaryText;
      const reviseId = typeof it.revise_id === 'string' && patIds.has(it.revise_id) ? it.revise_id : undefined;
      const confidence = typeof it.confidence === 'number' && it.confidence >= 0 && it.confidence <= 1 ? it.confidence : 0.5;
      payload = {
        pattern: patternText,
        domain: typeof it.domain === 'string' ? it.domain : 'general',
        confidence,
        evidence: rationale || `Synthesized from ${validCites.length} outcome row(s) on ${dream_run_at.slice(0, 10)}.`,
        ...(reviseId ? { revise_id: reviseId } : {}),
      };
    } else if (kind === 'graveyard') {
      payload = {
        idea: typeof it.idea === 'string' && it.idea.trim() ? it.idea.trim() : summaryText,
        why_killed: typeof it.why_killed === 'string' && it.why_killed.trim() ? it.why_killed.trim() : (rationale || summaryText),
        category: typeof it.category === 'string' ? it.category : 'other',
        revisit_conditions: typeof it.revisit_conditions === 'string' ? it.revisit_conditions : null,
      };
    } else {
      payload = { content: typeof it.content === 'string' && it.content.trim() ? it.content.trim() : summaryText };
    }

    const proposal = await createProposal({
      dream_run_at,
      job: 'synthesize',
      kind,
      summary: summaryText,
      rationale,
      target_table: kind === 'graveyard' ? 'janet_graveyard' : kind === 'pattern' ? 'janet_reasoning_patterns' : 'janet_memory',
      target_id: (payload.revise_id as string) ?? null,
      payload,
      provenance: validCites,
      auto_apply: false, // Rail 2: synthesize never auto-applies
    });
    summary.proposed[kind]++;
    summary.proposal_ids.push(proposal.id);
  }

  return summary;
}
