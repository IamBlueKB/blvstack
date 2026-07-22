#!/usr/bin/env node
// THE REGISTRY CONTRACT — a build gate, not a checklist.
//
// Root-cause fix for the recurring failure family: reliability invariants lived
// in ONE implementation (the send executor) instead of in a contract, so every
// new capability shipped without them. The invoicing module was written hours
// after its author described the send path's idempotency — and still shipped
// three bare inserts with no key, no ledger, no reversal.
//
// This refuses to let that happen again. Every Ring-2/3 tool must DECLARE whether
// it mutates durable state; every mutator must declare idempotency and a reversal.
// No declaration, no registration. Wired into `npm run build` — it fails the build.
//
// Static analysis on purpose: the registry can't be imported outside Astro
// (import.meta.env), and a source-level check can't be bypassed at runtime.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TOOLS_DIR = 'src/lib/janet/tools';

// Pre-contract tools. FROZEN: nothing may be added here. Every tool NOT on this
// list must declare the contract. Entries are debt to pay down, and the check
// fails if one disappears (keeps the list honest as it shrinks).
//
// PAYDOWN POLICY (Blue, 2026-07-21): pay these down DELIBERATELY, when the
// surface is next touched — not as a standalone project. If you're editing a
// tool on this list, declare its contract and remove it from the list in the
// same change. The list only ever shrinks.
const LEGACY_UNDECLARED = new Set([
  'add_memory',
  'add_psrx_suppression',
  'add_to_graveyard',
  'booker_draft_venue_pitch',
  'booker_find_gigs',
  'booker_find_venues',
  'booker_mark_booked',
  'booker_pitch_venue',
  'booker_research_venue',
  'booker_run_match',
  'booker_scrape_gigs',
  'booker_send_intake',
  'booker_send_to_artist',
  'booker_send_venue_followup',
  'compose_prospect_email',
  'create_client',
  'create_deal',
  'create_doc',
  'create_recipient_link',
  'create_site',
  'create_thread',
  'deactivate_memory',
  'delete_memory',
  'draft_email',
  'draft_lead_reply',
  'draft_message_reply',
  'draft_proposal',
  'file_records',
  'find_prospects',
  'generate_psrx_brief',
  'log_prediction',
  // 'log_recommendation' — PAID DOWN 2026-07-21: now declares the contract
  //   (idempotent dedup-before-insert + soft_delete reversal). Removed from the
  //   frozen list; the list only shrinks.
  'process_outbound_followups',
  'publish_page',
  'queue_psrx_lead_now',
  'record_outcome',
  'record_reasoning_pattern',
  'reinforce_pattern',
  'research_prospect',
  'run_psrx_nurture_sweep',
  'run_repo_audit',
  'run_site_scan',
  'run_url_audit',
  'score_prediction',
  'scrape_prospects',
  'send_email',
  'send_lead_reply',
  'send_message_reply',
  'send_outbound_batch',
  'send_outbound_followup',
  'unpublish_page',
  'update_client',
  'update_deal',
  'update_doc',
  'update_graveyard',
  'update_memory',
  'update_reasoning_pattern',
  'update_site',
]);

/** Split a tools file into per-tool blocks and read name/ring/contract flags. */
function parseTools(src, file) {
  const out = [];
  // Each tool literal starts with `name: '...'`. A block runs to the next one.
  const nameRe = /name:\s*'([a-z0-9_]+)'/gi;
  const marks = [];
  let m;
  while ((m = nameRe.exec(src))) marks.push({ name: m[1], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    const block = src.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : src.length);
    const ringM = /\bring:\s*(\d)/.exec(block);
    if (!ringM) continue; // not a tool literal (e.g. a schema property named `name`)
    out.push({
      file,
      name: marks[i].name,
      ring: Number(ringM[1]),
      mutates: /\bmutates:\s*(true|false)/.exec(block)?.[1],
      reversal: /\breversal:\s*'([a-z_]+)'/.exec(block)?.[1],
      idempotent: /\bidempotent:\s*(true|false)/.exec(block)?.[1],
    });
  }
  return out;
}

const VALID_REVERSALS = new Set(['void', 'soft_delete', 'hard_delete_guarded', 'compensating']);

const tools = readdirSync(TOOLS_DIR)
  .filter((f) => f.endsWith('.ts'))
  .flatMap((f) => parseTools(readFileSync(join(TOOLS_DIR, f), 'utf8'), f));

const violations = [];
const seen = new Set();

for (const t of tools) {
  seen.add(t.name);
  if (t.ring < 2) continue; // Ring 1 reads nothing to guard
  if (LEGACY_UNDECLARED.has(t.name)) continue; // frozen debt

  if (t.mutates === undefined) {
    violations.push(`${t.name} (${t.file}, ring ${t.ring}) — must declare \`mutates: true|false\`. No declaration, no registration.`);
    continue;
  }
  if (t.mutates === 'true') {
    if (t.idempotent !== 'true') {
      violations.push(`${t.name} (${t.file}) — mutates state but is not \`idempotent: true\`. Route its create through guardedCreate (write-executor.ts) so a repeat returns the existing row instead of duplicating.`);
    }
    if (!t.reversal || !VALID_REVERSALS.has(t.reversal)) {
      violations.push(`${t.name} (${t.file}) — mutates state but declares no valid \`reversal\` (${[...VALID_REVERSALS].join(' | ')}). A write with no defined undo is unfinished.`);
    }
  }
}

// Keep the legacy list shrinking and honest.
for (const name of LEGACY_UNDECLARED) {
  if (!seen.has(name)) violations.push(`LEGACY_UNDECLARED lists "${name}" but no such tool exists — remove it from the frozen list.`);
}

const governed = tools.filter((t) => t.ring >= 2 && !LEGACY_UNDECLARED.has(t.name));
if (violations.length) {
  console.error(`\n✖ TOOL CONTRACT VIOLATIONS (${violations.length}) — build refused:\n`);
  for (const v of violations) console.error(`  • ${v}`);
  console.error(`\n  Governing principle: NO MODEL BELIEF MAY BE LOAD-BEARING.`);
  console.error(`  A state-mutating tool must be idempotent on a natural key and declare its reversal.\n`);
  process.exit(1);
}

console.log(`✓ tool contract OK — ${governed.length} governed Ring-2/3 tool(s) declared; ${LEGACY_UNDECLARED.size} legacy exemptions outstanding.`);
