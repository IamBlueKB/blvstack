// Phase 3 — prompt-injection taint model (pure, unit-testable; no imports).
//
// JANET ingests attacker-controllable text every turn: inbound contact messages
// and leads render into the snapshot with no tool call, and web-facing tools pull
// arbitrary page/site content into context. A single poisoned inbound could steer
// her to write durable state (memory / reasoning patterns / graveyard / PSRx
// suppression) that is then injected as TRUSTED context every future turn —
// persistent compromise from one message. This module defines the taint flag and
// the escalation rule; brain.ts wires them (so these tests exercise the real path).

// A turn is tainted only by FRESH untrusted ingestion THIS turn — not by ambient
// leads/messages sitting in the snapshot (those are defended by the «untrusted:…»
// fence + SECURITY header, line one). Ambient-taint would gate nearly every memory
// write and pattern update, taxing the judgment layer exactly where it must stay
// fluid. So taint fires when an attacker-controllable body actually enters context
// via a tool call: a web-facing tool, or a read of an inbound message/lead body.

// Tools that pull ATTACKER-CONTROLLABLE WEB content into context.
export const WEB_FACING_TOOLS = new Set([
  'research_prospect',
  'scrape_prospects',
  'run_url_audit',
  'run_site_scan',
  'booker_find_gigs',
  'booker_find_venues',
  'booker_scrape_gigs',
  'booker_research_venue',
]);

// Reads that pull an inbound message / lead / form BODY (attacker- or client-authored
// free text) into context this turn. Reading one taints the turn — that's the moment
// untrusted instructions could be acting on her.
export const INBOUND_UNTRUSTED_READS = new Set([
  'get_messages',
  'get_message',
  'get_leads',
  'get_lead',
  'get_psrx_leads',
  'get_psrx_lead',
  'get_form_responses',
]);

// Writes to DURABLE state she'll later re-read as TRUSTED context (or that gates
// safety). Under taint these escalate from inline Ring-2 writes to approval-gated
// proposals, so an injected instruction can't silently poison future turns (3.2).
export const TAINT_ESCALATED_TOOLS = new Set([
  'add_memory',
  'update_memory',
  'deactivate_memory',
  'record_reasoning_pattern',
  'reinforce_pattern',
  'add_to_graveyard',
  'add_psrx_suppression',
]);

/** Does running this batch of tools taint the turn — did FRESH untrusted content
 *  (web-facing tool, or an inbound message/lead/form body read) enter context? */
export function batchTaints(toolNames: readonly string[]): boolean {
  return toolNames.some((n) => WEB_FACING_TOOLS.has(n) || INBOUND_UNTRUSTED_READS.has(n));
}

/** Under taint, is this a durable-state write that must be escalated to approval? */
export function escalatesUnderTaint(toolName: string, tainted: boolean): boolean {
  return tainted && TAINT_ESCALATED_TOOLS.has(toolName);
}

/** Fence untrusted free text (3.3) so injected instructions inside it read as DATA,
 *  never commands. Strips the fence chars from the body so it can't break out. */
export function delimitUntrusted(s: string): string {
  return `«untrusted:${String(s).replace(/[«»]/g, '')}»`;
}
