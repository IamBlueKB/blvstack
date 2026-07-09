// JANET v1 — janet_actions audit-trail plumbing (spec §2, §3)
//
// Append-only. JANET has no tool that writes here — only this module does,
// called by the execution layer around every Ring 2/3 tool call (and Ring 1
// failures, for debuggability). Logging failures never break the action
// itself; they log to console and move on.

import { supabaseAdmin } from '../supabase';
import type { JanetActionLog } from './types';

export async function logJanetAction(entry: JanetActionLog): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('janet_actions').insert({
      tool_name: entry.tool_name,
      ring: entry.ring,
      input: entry.input ?? {},
      output_summary: entry.output_summary ?? null,
      approved_by_user: entry.approved_by_user ?? null,
      status: entry.status ?? 'completed',
    });
    if (error) console.error('[janet] action log failed:', error.message);
  } catch (err) {
    console.error('[janet] action log failed:', err);
  }
}
