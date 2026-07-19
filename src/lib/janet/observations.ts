// Phase 2.5 — the observation store (DB layer over the pure core in consequential.ts).
// Persists consequential tool results keyed by tool-call id so citations survive
// history compaction, and answers "is there a fresh observation of class X?" for the
// grounding read (2.7). Best-effort: a store failure never breaks a turn.

import { supabaseAdmin } from '../supabase';
import type { ClaimClass } from './consequential';

export type ObservationInput = {
  threadId: string | null;
  toolCallId: string | null;
  toolName: string;
  source?: 'tool' | 'ledger' | 'snapshot';
  claimClasses: ClaimClass[];
  payload: unknown;
};

const MAX_PAYLOAD = 8000;
function capPayload(p: unknown): unknown {
  try {
    const s = JSON.stringify(p);
    return s.length > MAX_PAYLOAD ? { _truncated: true, preview: s.slice(0, MAX_PAYLOAD) } : p;
  } catch {
    return { _unserializable: true };
  }
}

/** Persist one consequential observation. Returns its id (for citation), or null. */
export async function recordObservation(input: ObservationInput): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('janet_observations')
      .insert({
        thread_id: input.threadId,
        tool_call_id: input.toolCallId,
        tool_name: input.toolName,
        source: input.source ?? 'tool',
        claim_classes: input.claimClasses,
        payload: capPayload(input.payload),
      })
      .select('id')
      .single();
    if (error) {
      console.error('[janet] observation insert failed:', error.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (e) {
    console.error('[janet] observation insert threw:', (e as Error).message);
    return null;
  }
}

export type StoredObservation = { id: string; tool_name: string; observed_at: string; payload: unknown };

/**
 * Fresh observations of a class for a thread, younger than ttlSeconds (2.5/2.7 —
 * grounding that survives compaction). ttl 0 → nothing qualifies (must be this-turn
 * / live), which is exactly what "published?/sent?" require.
 */
export async function getFreshObservations(threadId: string, cls: ClaimClass, ttlSeconds: number): Promise<StoredObservation[]> {
  if (ttlSeconds <= 0) return [];
  try {
    const cutoff = new Date(Date.now() - ttlSeconds * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('janet_observations')
      .select('id, tool_name, observed_at, payload')
      .eq('thread_id', threadId)
      .contains('claim_classes', [cls])
      .gte('observed_at', cutoff)
      .order('observed_at', { ascending: false })
      .limit(5);
    if (error) {
      console.error('[janet] observation read failed:', error.message);
      return [];
    }
    return (data ?? []) as StoredObservation[];
  } catch (e) {
    console.error('[janet] observation read threw:', (e as Error).message);
    return [];
  }
}
