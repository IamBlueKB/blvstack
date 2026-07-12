// JANET v2 Phase 3 — judgment tools (Ring 2). Reversible internal writes to her
// model of Blue: the graveyard (killed ideas + why), reasoning patterns (how he
// thinks), and predictions (her guesses at his calls, scored to measure her model).
// All logged to janet_actions like any Ring 2 act. Nothing here reaches a person.

import { supabaseAdmin } from '../../supabase';
import type { JanetTool } from '../types';

function reqString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required input: ${key}`);
  return v;
}
function optString(input: unknown, key: string): string | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}
function optNumber(input: unknown, key: string): number | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}
const clamp = (n: number) => Math.min(Math.max(n, 0.05), 0.99);

const GRAVE_CATS = ['business_model', 'product', 'channel', 'feature', 'pricing', 'client', 'other'];
const PATTERN_DOMAINS = ['pricing', 'clients', 'product', 'risk', 'style', 'strategy', 'general'];

export const judgmentTools: JanetTool[] = [
  // ── The graveyard (3.1) ───────────────────────────────────────────────
  {
    name: 'add_to_graveyard',
    description:
      "Record an idea that was tried and killed, with the REASONING behind the kill — this is what stops you re-suggesting dead ideas forever. Do this whenever Blue kills something ('kill that — here's why'). The why_killed is the valuable part; capture the principle, and note revisit_conditions (what would have to change for it to become viable again). Returns the created entry.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        idea: { type: 'string', description: 'What was considered' },
        why_killed: { type: 'string', description: 'The reasoning — why it was killed (the valuable part)' },
        category: { type: 'string', enum: GRAVE_CATS },
        revisit_conditions: { type: 'string', description: 'What would have to change for this to become viable again' },
        killed_by: { type: 'string', description: "Who made the call (default 'blue')" },
      },
      required: ['idea', 'why_killed'],
    },
    handler: async (input) => {
      const row = {
        idea: reqString(input, 'idea'),
        why_killed: reqString(input, 'why_killed'),
        category: optString(input, 'category') ?? null,
        revisit_conditions: optString(input, 'revisit_conditions') ?? null,
        killed_by: optString(input, 'killed_by') ?? 'blue',
      };
      const { data, error } = await supabaseAdmin.from('janet_graveyard').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { buried: true, entry: data };
    },
  },
  {
    name: 'update_graveyard',
    description:
      'Edit a graveyard entry — its reasoning, revisit conditions, category, or active state. Set active=false to resurrect an idea (revisit conditions met); only the fields you pass change. Returns the updated entry.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Graveyard UUID' },
        idea: { type: 'string' },
        why_killed: { type: 'string' },
        category: { type: 'string', enum: GRAVE_CATS },
        revisit_conditions: { type: 'string' },
        active: { type: 'boolean', description: 'false = no longer dead (revisit conditions met)' },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const patch: Record<string, unknown> = {};
      for (const key of ['idea', 'why_killed', 'category', 'revisit_conditions'] as const) {
        const v = optString(input, key);
        if (v !== undefined) patch[key] = v;
      }
      const active = (input as any)?.active;
      if (typeof active === 'boolean') patch.active = active;
      if (Object.keys(patch).length === 0) throw new Error('Nothing to update.');
      const { data, error } = await supabaseAdmin.from('janet_graveyard').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { updated: true, entry: data };
    },
  },

  // ── Reasoning patterns (3.2) ──────────────────────────────────────────
  {
    name: 'record_reasoning_pattern',
    description:
      "Record a PRINCIPLE of how Blue thinks — not the instance. When he corrects you, rejects a draft, kills an idea, or approves something notable, ask yourself WHY and record the transferable principle. Not 'Blue rejected this email' — rather 'Blue rejects copy that invents specifics we can't back — he'd rather be plainly honest than persuasive.' Include the evidence (what he did/said) and your confidence 0-1. If a very similar pattern already exists, reinforce_pattern it instead. Returns the created pattern.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The principle, stated generally' },
        evidence: { type: 'string', description: 'What he did/said that established this' },
        domain: { type: 'string', enum: PATTERN_DOMAINS },
        confidence: { type: 'number', description: 'How sure you are this is a real pattern, 0-1 (default 0.5)' },
      },
      required: ['pattern', 'evidence'],
    },
    handler: async (input) => {
      const confidenceRaw = optNumber(input, 'confidence');
      const row = {
        pattern: reqString(input, 'pattern'),
        evidence: reqString(input, 'evidence'),
        domain: optString(input, 'domain') ?? 'general',
        confidence: confidenceRaw === undefined ? 0.5 : clamp(confidenceRaw),
      };
      const { data, error } = await supabaseAdmin.from('janet_reasoning_patterns').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { recorded: true, pattern: data };
    },
  },
  {
    name: 'reinforce_pattern',
    description:
      "Confirm or contradict an existing reasoning pattern based on a fresh signal, adjusting its confidence. direction='confirmed' when Blue acts consistent with it (confidence rises); 'contradicted' when he acts against it (confidence falls). A contradicted high-confidence pattern is important — it means your model of him is off. Returns the updated pattern.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Pattern UUID' },
        direction: { type: 'string', enum: ['confirmed', 'contradicted'] },
        note: { type: 'string', description: 'Optional evidence to append' },
      },
      required: ['id', 'direction'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const direction = reqString(input, 'direction');
      const { data: cur, error: readErr } = await supabaseAdmin.from('janet_reasoning_patterns').select('*').eq('id', id).single();
      if (readErr) throw new Error(readErr.message);
      const c = typeof cur.confidence === 'number' ? cur.confidence : 0.5;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (direction === 'confirmed') {
        patch.confidence = clamp(c + (1 - c) * 0.2);
        patch.times_confirmed = (cur.times_confirmed ?? 0) + 1;
      } else {
        patch.confidence = clamp(c * 0.6);
        patch.times_contradicted = (cur.times_contradicted ?? 0) + 1;
      }
      const note = optString(input, 'note');
      if (note) patch.evidence = `${cur.evidence}\n· ${direction}: ${note}`;
      const { data, error } = await supabaseAdmin.from('janet_reasoning_patterns').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { updated: true, pattern: data };
    },
  },
  {
    name: 'update_reasoning_pattern',
    description:
      'Edit a reasoning pattern (its wording, domain, evidence) or deactivate it (active=false) when it turns out to be wrong. Use when Blue corrects the model of him directly. Returns the updated pattern.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Pattern UUID' },
        pattern: { type: 'string' },
        evidence: { type: 'string' },
        domain: { type: 'string', enum: PATTERN_DOMAINS },
        active: { type: 'boolean' },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const key of ['pattern', 'evidence', 'domain'] as const) {
        const v = optString(input, key);
        if (v !== undefined) patch[key] = v;
      }
      const active = (input as any)?.active;
      if (typeof active === 'boolean') patch.active = active;
      if (Object.keys(patch).length === 1) throw new Error('Nothing to update.');
      const { data, error } = await supabaseAdmin.from('janet_reasoning_patterns').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return { updated: true, pattern: data };
    },
  },

  // ── Predictions — she tests her model (3.4) ───────────────────────────
  {
    name: 'log_prediction',
    description:
      "Record a prediction of what Blue will decide, BEFORE he decides — 'based on how you think, I'd expect you to X here'. Link the reasoning pattern that drove it (pattern_id) if there is one. When Blue then decides, call score_prediction. Tracking these is how you measure — and improve — how well you model him. Returns the logged prediction.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: 'The decision being predicted' },
        predicted: { type: 'string', description: 'What you expect Blue to do' },
        pattern_id: { type: 'string', description: 'The reasoning pattern that drove this prediction (optional)' },
        subject_type: { type: 'string', enum: ['lead', 'deal', 'site', 'client', 'prospect'] },
        subject_id: { type: 'string' },
      },
      required: ['context', 'predicted'],
    },
    handler: async (input) => {
      const row = {
        context: reqString(input, 'context'),
        predicted: reqString(input, 'predicted'),
        pattern_id: optString(input, 'pattern_id') ?? null,
        subject_type: optString(input, 'subject_type') ?? null,
        subject_id: optString(input, 'subject_id') ?? null,
      };
      const { data, error } = await supabaseAdmin.from('janet_predictions').insert(row).select().single();
      if (error) throw new Error(error.message);
      return { predicted: true, prediction: data };
    },
  },
  {
    name: 'score_prediction',
    description:
      "Score a past prediction once Blue has actually decided — outcome 'correct', 'incorrect', or 'partial', with what he actually did. This automatically moves the linked reasoning pattern's confidence (correct confirms it, incorrect contradicts it). This is the loop that makes you better on your own. Returns the scored prediction.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Prediction UUID' },
        outcome: { type: 'string', enum: ['correct', 'incorrect', 'partial'] },
        actual: { type: 'string', description: 'What Blue actually did' },
      },
      required: ['id', 'outcome'],
    },
    handler: async (input) => {
      const id = reqString(input, 'id');
      const outcome = reqString(input, 'outcome');
      const { data: pred, error: readErr } = await supabaseAdmin.from('janet_predictions').select('*').eq('id', id).single();
      if (readErr) throw new Error(readErr.message);
      const { data: scored, error } = await supabaseAdmin
        .from('janet_predictions')
        .update({ outcome, actual: optString(input, 'actual') ?? null, resolved_at: new Date().toISOString(), resolved_by: 'blue' })
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);

      // Move the driving pattern's confidence, if one was linked.
      let pattern_adjusted = null;
      if (pred.pattern_id && outcome !== 'partial') {
        const { data: pat } = await supabaseAdmin.from('janet_reasoning_patterns').select('*').eq('id', pred.pattern_id).single();
        if (pat) {
          const c = typeof pat.confidence === 'number' ? pat.confidence : 0.5;
          const patch =
            outcome === 'correct'
              ? { confidence: clamp(c + (1 - c) * 0.2), times_confirmed: (pat.times_confirmed ?? 0) + 1, updated_at: new Date().toISOString() }
              : { confidence: clamp(c * 0.6), times_contradicted: (pat.times_contradicted ?? 0) + 1, updated_at: new Date().toISOString() };
          const { data: up } = await supabaseAdmin.from('janet_reasoning_patterns').update(patch).eq('id', pred.pattern_id).select('id, pattern, confidence').single();
          pattern_adjusted = up;
        }
      }
      return { scored: true, prediction: scored, pattern_adjusted };
    },
  },
];
