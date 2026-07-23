-- OCF-1 (full-system audit 2026-07-22): the idempotency index shipped in
-- 20260721230000_dream_two_phase.sql was PARTIAL (WHERE idempotency_key IS NOT NULL).
-- PostgREST cannot use a partial unique index as an ON CONFLICT arbiter, so
-- createProposal's .upsert(row,{onConflict:'idempotency_key'}) threw 42P10 on the
-- FIRST proposal ever produced — the dream's entire output path was dead on arrival.
--
-- Fix: a plain (non-partial) unique index. A btree unique index allows multiple NULLs,
-- so pre-two-phase rows with a NULL idempotency_key stay exempt exactly as before —
-- identical semantics for NULLs, but now usable as a conflict arbiter for real keys.
-- Same fix already applied to janet_conversions on the PSRX side.
--
-- Applied to production (krrezgghzooecufeghul) via the Supabase Management API on
-- 2026-07-23; this file records it for repo/schema parity. Verified by
-- scripts/dream-verify.test.ts (section D now upserts on idempotency_key with a fresh id).
DROP INDEX IF EXISTS janet_dream_proposals_idem_idx;
CREATE UNIQUE INDEX IF NOT EXISTS janet_dream_proposals_idem_idx
  ON janet_dream_proposals (idempotency_key);
