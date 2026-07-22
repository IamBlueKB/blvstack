// Two-phase dream loop — verification harness. Runs the REAL pure.ts logic under
// tsx, and the REAL Postgres ON CONFLICT semantics via supabase-js against a
// tagged temp row (real tables + the migration are untouched; the row is deleted).
//
// Run: node_modules/.bin/tsx scripts/dream-verify.test.ts
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  assembleJournal,
  nextCollectState,
  dreamBriefLine,
  proposalIdempotencyKey,
  wouldBreachCap,
  estimateTokens,
  type ConsolidateFacts,
  type SynthesizeFacts,
  type ReconcileFacts,
} from '../src/lib/janet/dream/pure';

let pass = 0, fail = 0;
const ck = (name: string, cond: boolean, got?: unknown) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, got !== undefined ? '-> ' + JSON.stringify(got) : ''); }
};

const REC: ReconcileFacts = { flagged: 1, closed: 2, staged: 0 };
const consOk: ConsolidateFacts = { status: 'ok', auto_merged: 1, proposed: { merge: 0, deprecate: 1, promote: 0 } };
const synOk: SynthesizeFacts = { status: 'ok', proposed: { pattern: 1, graveyard: 0, strategy: 0 } };

console.log('\n=== A. inconsistent-guard (185c376) from the collector inputs ===');
// The collector calls exactly this: assembleJournal(reconcile, consFacts, synFacts, dreamSpent(), cap).
const jZero = assembleJournal(REC, consOk, synOk, 0, 1.0); // both ok, $0 spent
ck('ok jobs + $0 spend -> INCONSISTENT', jZero.status === 'inconsistent', jZero.status);
ck('inconsistent carries a note naming both causes', /budget accounting|without actually calling/.test(jZero.note ?? ''), jZero.note?.slice(0, 40));
const jSpent = assembleJournal(REC, consOk, synOk, 0.0123, 1.0); // both ok, real spend
ck('ok jobs + real spend -> ok', jSpent.status === 'ok', jSpent.status);
const jPartial = assembleJournal(REC, { ...consOk, status: 'incomplete', note: 'x' }, synOk, 0, 1.0);
ck('partial run + $0 -> partial (guard NOT tripped; $0 expected)', jPartial.status === 'partial', jPartial.status);
const jIdle = assembleJournal(REC, { ...consOk, status: 'skipped_no_input' }, { ...synOk, status: 'skipped_no_input' }, 0, 1.0);
ck('idle run + $0 -> idle (guard NOT tripped)', jIdle.status === 'idle', jIdle.status);

console.log('\n=== B. four-state dry-run: nextCollectState + brief line ===');
const ended = { ended: true, errored: false };
const err = { ended: true, errored: true };
const running = { ended: false, errored: false };
ck('both ended, no error, 1h -> collected', nextCollectState(ended, ended, 1) === 'collected');
ck('a batch errored -> failed', nextCollectState(err, ended, 1) === 'failed');
ck('still running, 3h -> submitted (hold)', nextCollectState(running, ended, 3) === 'submitted');
ck('still running, 25h -> expired', nextCollectState(running, ended, 25) === 'expired');
ck('both ended even at 30h -> collected (finished result never discarded)', nextCollectState(ended, ended, 30) === 'collected');

const collectedJournal = assembleJournal(REC, consOk, synOk, 0.02, 1.0);
collectedJournal.dream_run_at = '2026-07-21T09:00:00.000Z';
collectedJournal.proposals_pending = 3;
const lineSubmitted = dreamBriefLine({ state: 'submitted', submitted_at: '2026-07-21T09:00:00.000Z' });
const lineCollected = dreamBriefLine({ state: 'collected', journal: collectedJournal });
const lineFailed = dreamBriefLine({ state: 'failed', submitted_at: '2026-07-21T09:00:00.000Z', note: 'batch errored: request expired' });
const lineExpired = dreamBriefLine({ state: 'expired', submitted_at: '2026-07-21T09:00:00.000Z' });
console.log('    submitted:', lineSubmitted);
console.log('    collected:', lineCollected);
console.log('    failed   :', lineFailed);
console.log('    expired  :', lineExpired);
ck('submitted line reads IN FLIGHT (never zero/silent)', /IN FLIGHT/.test(lineSubmitted));
ck('collected line folds the journal headline (3 proposals)', /3 proposal/.test(lineCollected));
ck('failed line flags failure + reason', /FAILED/.test(lineFailed) && /request expired/.test(lineFailed));
ck('expired line flags expiry, not a quiet night', /EXPIRED/.test(lineExpired) && /not a quiet night/.test(lineExpired));

console.log('\n=== C. idempotency key + pre-submit cap gate ===');
const base = { dream_run_at: '2026-07-21T09:00:00.000Z', job: 'consolidate', kind: 'deprecate', target_id: 'm1', summary: 'Deprecate stale metric', payload: { a: 1 }, provenance: [{ table: 'janet_memory', id: 'm1' }] };
ck('same proposal -> same key (a re-collect will conflict)', proposalIdempotencyKey(base) === proposalIdempotencyKey({ ...base }));
ck('different summary -> different key', proposalIdempotencyKey(base) !== proposalIdempotencyKey({ ...base, summary: 'Deprecate something else' }));
ck('different run -> different key', proposalIdempotencyKey(base) !== proposalIdempotencyKey({ ...base, dream_run_at: '2026-07-22T09:00:00.000Z' }));
// Cap gate: the pre-submit control.
ck('projected under cap -> no breach', wouldBreachCap(0.4, 0.4, 1.0) === false);
ck('projected over cap -> BREACH (second submit refused)', wouldBreachCap(0.8, 0.4, 1.0) === true);
ck('null cap -> never breaches', wouldBreachCap(999, 999, null) === false);
ck('estimateTokens over-counts (conservative for a spend control)', estimateTokens('a'.repeat(350)) === 100);

console.log('\n=== D. review decision survives a second collect (real Postgres ON CONFLICT) ===');
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const sb = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TAG = '2001-01-01T00:00:00.000Z'; // synthetic dream_run_at — clearly not a real run
const GID = '00000000-0000-4000-8000-00000000dead'; // fixed id = the conflict key stand-in for idempotency_key
try {
  await sb.from('janet_dream_proposals').delete().eq('dream_run_at', TAG); // clean slate
  // First collect creates the proposal.
  await sb.from('janet_dream_proposals').insert({ id: GID, dream_run_at: TAG, job: 'consolidate', kind: 'deprecate', summary: 'TEST proposal', provenance: [{ table: 'janet_memory', id: 'x' }], status: 'proposed', auto_apply: false });
  // Blue reviews it between ticks.
  await sb.from('janet_dream_proposals').update({ status: 'accepted', resolved_by: 'blue' }).eq('id', GID);
  // Second collect re-creates the SAME proposal: INSERT ... ON CONFLICT DO NOTHING
  // (the exact shape createProposal ships: .upsert(row,{onConflict,ignoreDuplicates:true})).
  const { data: reins } = await sb.from('janet_dream_proposals').upsert({ id: GID, dream_run_at: TAG, job: 'consolidate', kind: 'deprecate', summary: 'TEST proposal (reworded by a later run)', provenance: [{ table: 'janet_memory', id: 'x' }], status: 'proposed', auto_apply: false }, { onConflict: 'id', ignoreDuplicates: true }).select();
  ck('second collect inserts NOTHING (conflict absorbed)', (reins ?? []).length === 0, reins);
  const { data: after } = await sb.from('janet_dream_proposals').select('status, summary').eq('id', GID).single();
  ck("reviewed status SURVIVES (still 'accepted', not reset to proposed)", after?.status === 'accepted', after?.status);
  ck('summary NOT overwritten by the later run', after?.summary === 'TEST proposal', after?.summary);
  const { count } = await sb.from('janet_dream_proposals').select('id', { count: 'exact', head: true }).eq('dream_run_at', TAG);
  ck('exactly ONE row for the run (no duplicate)', count === 1, count);

  // Journal upsert (DO UPDATE) — updates the run row, never duplicates it.
  const RID = '00000000-0000-4000-8000-00000000beef';
  await sb.from('janet_dream_runs').delete().eq('id', RID);
  await sb.from('janet_dream_runs').insert({ id: RID, dream_run_at: TAG, proposals_pending: 2, status: 'ok' });
  await sb.from('janet_dream_runs').upsert({ id: RID, dream_run_at: TAG, proposals_pending: 1, status: 'ok' }, { onConflict: 'id' });
  const { data: runAfter } = await sb.from('janet_dream_runs').select('proposals_pending').eq('id', RID).single();
  const { count: runCount } = await sb.from('janet_dream_runs').select('id', { count: 'exact', head: true }).eq('id', RID);
  ck('journal upsert UPDATES (pending 2 -> 1)', runAfter?.proposals_pending === 1, runAfter?.proposals_pending);
  ck('journal upsert does not duplicate (1 row)', runCount === 1, runCount);
  await sb.from('janet_dream_runs').delete().eq('id', RID);
} finally {
  await sb.from('janet_dream_proposals').delete().eq('dream_run_at', TAG);
  console.log('    (temp rows cleaned up)');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
