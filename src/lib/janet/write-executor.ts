// THE WRITE EXECUTOR — the state-mutation twin of sendVerified (executor.ts).
//
// Root-cause fix for the duplicated-books incident. The architecture had exactly
// ONE governed path: sends. Every durable state write went straight to
// supabaseAdmin from a tool handler, inheriting nothing. So each new capability
// started unguarded, and correctness depended on the MODEL remembering whether it
// had already run — a model belief that was load-bearing.
//
// Governing principle: NO MODEL BELIEF MAY BE LOAD-BEARING.
//
// Every create routed through here is:
//   • IDEMPOTENT on a natural key — a repeat returns the EXISTING row with
//     dedup:true. It does not matter whether the model thinks it already ran;
//     running again is a no-op. Her uncertainty is made non-destructive.
//   • LEDGERED — one janet_action_ledger row per write (actor, key, payload,
//     result, state), so "did that happen?" is answerable from the system.
//   • READ-BACK — returns the PERSISTED row, never the intent.
//
// The unique constraint on idempotency_key makes this race-safe: two concurrent
// identical creates cannot both insert.

import { supabaseAdmin } from '../supabase';

export type GuardedCreateResult<T> = { row: T; dedup: boolean; ledger_id: string | null };

export type GuardedCreateInput<T> = {
  /** e.g. 'clearear_session' | 'clearear_invoice' | 'clearear_payment' */
  actionType: string;
  /** Natural key — same business fact ⇒ same key. THIS is the guard. */
  idempotencyKey: string;
  lane?: string;
  actor?: string;
  payload: Record<string, unknown>;
  /** Performs the insert and returns the persisted row (must include `id`). */
  create: () => Promise<T>;
  /** Re-reads the row by id, for the dedup path. */
  reread: (id: string) => Promise<T | null>;
};

/**
 * Run a create exactly once per natural key. On a repeat, the stored row is
 * re-read and returned with dedup:true — never a second insert.
 */
export async function guardedCreate<T extends { id?: string }>(input: GuardedCreateInput<T>): Promise<GuardedCreateResult<T>> {
  const { actionType, idempotencyKey, payload, create, reread } = input;
  const lane = input.lane ?? 'chat';
  const actor = input.actor ?? 'janet';

  // 1. Has this exact business fact already been written?
  const { data: existing } = await supabaseAdmin
    .from('janet_action_ledger')
    .select('id, state, result')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing && existing.state === 'executed') {
    const priorId = (existing.result as any)?.id as string | undefined;
    if (priorId) {
      const row = await reread(priorId);
      if (row) return { row, dedup: true, ledger_id: existing.id };
    }
    // Ledger says executed but the row is gone (deleted/voided since) — fall
    // through and create again, honestly, rather than returning a phantom.
  }

  // 2. Record intent, then execute. The unique key is the race guard.
  let ledgerId: string | null = existing?.id ?? null;
  if (!ledgerId) {
    const { data: led, error: ledErr } = await supabaseAdmin
      .from('janet_action_ledger')
      .insert({ action_type: actionType, lane, state: 'proposed', approval_ref: `system:${actor}`, idempotency_key: idempotencyKey, payload })
      .select('id')
      .single();
    if (ledErr) {
      // Someone else won the race on the unique key — re-read theirs.
      const { data: raced } = await supabaseAdmin.from('janet_action_ledger').select('id, result').eq('idempotency_key', idempotencyKey).maybeSingle();
      const racedId = (raced?.result as any)?.id as string | undefined;
      if (racedId) {
        const row = await reread(racedId);
        if (row) return { row, dedup: true, ledger_id: raced!.id };
      }
      throw new Error(`Write refused: ${ledErr.message}`);
    }
    ledgerId = led.id;
  }

  try {
    const row = await create();
    await supabaseAdmin
      .from('janet_action_ledger')
      .update({ state: 'executed', result: { id: (row as any)?.id ?? null }, executed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', ledgerId);
    return { row, dedup: false, ledger_id: ledgerId };
  } catch (e) {
    await supabaseAdmin
      .from('janet_action_ledger')
      .update({ state: 'failed', error: (e as Error).message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', ledgerId);
    throw e;
  }
}

/** Build a stable natural key. Values are normalized so trivial formatting
 *  differences (case, spacing, 2 vs 2.00) don't defeat the guard. */
export function naturalKey(kind: string, parts: (string | number | null | undefined)[]): string {
  const norm = parts.map((p) => {
    if (p == null) return '~';
    if (typeof p === 'number') return String(Math.round(p * 100) / 100);
    const s = String(p).trim().toLowerCase();
    return /^-?\d+(\.\d+)?$/.test(s) ? String(Math.round(Number(s) * 100) / 100) : s.replace(/\s+/g, ' ');
  });
  return `${kind}:${norm.join('|')}`;
}

/** Money floor. An explicit 0 is NOT a valid amount — the original guard only
 *  checked for null, which is why a whole batch of $0.00 session lines shipped. */
export function requirePositiveAmount(amount: unknown, what = 'amount'): number {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) throw new Error(`A real ${what} is required — none was given, and it is never guessed.`);
  if (n <= 0) throw new Error(`${what} must be greater than zero (got ${n}). A $0 record is a defect, not a fact — if the work was free, say so explicitly rather than recording zero.`);
  return Math.round(n * 100) / 100;
}
