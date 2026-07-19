/**
 * Outbound engine — core logic for send batch, follow-ups, and reply detection.
 * Uses Resend for sending via tryblvstack.com, Supabase for state.
 */

import { supabaseAdmin } from '../supabase';
import { sendOutboundEmail, getAllSettings } from '../outbound-email';
import { composeFollowUp } from './composer';
import { queuePendingApproval, queuedProposalKeys } from '../janet/pending';
import { validateOutboundDraft } from '../janet/consequential';

/** Source text a draft's figures must trace to (number-consistency, 2.8). */
function prospectSource(p: any): string {
  return [p?.ai_research, p?.pain_points, p?.company_name, p?.notes]
    .map((x) => (typeof x === 'string' ? x : x == null ? '' : JSON.stringify(x)))
    .join(' ');
}

// ─── Send Batch ───────────────────────────────────────────────────

export async function runSendBatch(): Promise<{ sent: number; errors: any[]; message?: string }> {
  const settings = await getAllSettings();
  const dailyCap = parseInt(settings.daily_cap ?? '10', 10);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: sentToday } = await supabaseAdmin
    .from('outbound_emails')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString());

  const remaining = dailyCap - (sentToday ?? 0);
  if (remaining <= 0) return { sent: 0, errors: [], message: 'Daily cap reached' };

  const { data: queued } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .eq('status', 'queued')
    .eq('approved', true)
    .eq('disqualified', false) // defense in depth — compose refuses these, but skip if any slip through
    .not('contact_email', 'is', null)
    .not('draft_email', 'is', null)
    .not('draft_subject', 'is', null)
    .order('created_at', { ascending: true })
    .limit(remaining);

  if (!queued || queued.length === 0) return { sent: 0, errors: [], message: 'No queued prospects' };

  const followUpDays = (settings.follow_up_days ?? '4,10,21').split(',').map(Number);
  let sent = 0;
  const errors: any[] = [];

  for (const prospect of queued) {
    try {
      // Outbound validator (2.8): last gate before a cold draft leaves — forbidden
      // claims + number-consistency vs the prospect's own research. A violation is
      // NOT silently sent; it's skipped and surfaced so Blue can fix the draft.
      const validation = validateOutboundDraft(prospect.draft_email, { sourceText: prospectSource(prospect) });
      if (!validation.ok) {
        errors.push({ id: prospect.id, error: `outbound validator blocked: ${validation.violations.join('; ')}` });
        continue;
      }

      const result = await sendOutboundEmail({
        to: prospect.contact_email,
        subject: prospect.draft_subject,
        body: prospect.draft_email,
        headers: { 'X-Prospect-Id': prospect.id },
        approvalRef: `prospect:${prospect.id}`, // queued+approved prospect IS the approval
        idempotencyKey: `outbound_initial:${prospect.id}`,
      });

      await supabaseAdmin.from('outbound_emails').insert({
        prospect_id: prospect.id,
        type: 'initial',
        subject: prospect.draft_subject,
        body: prospect.draft_email,
        gmail_message_id: result.messageId,
        status: 'sent',
      });

      const nextFollowUp = new Date();
      nextFollowUp.setDate(nextFollowUp.getDate() + followUpDays[0]);

      await supabaseAdmin
        .from('prospects')
        .update({
          status: 'sent',
          gmail_message_id: result.messageId,
          last_sent_at: new Date().toISOString(),
          next_follow_up_at: nextFollowUp.toISOString(),
          follow_up_count: 0,
        })
        .eq('id', prospect.id);

      sent++;
    } catch (err: any) {
      errors.push({ id: prospect.id, error: err?.message ?? 'Unknown' });
    }
  }

  return { sent, errors };
}

// ─── Process Follow-ups ───────────────────────────────────────────

/**
 * Trust-stack (2.1, option A): follow-ups NO LONGER auto-send at cron time.
 * For each due prospect this composes the follow-up and DRAFTS it into
 * janet_pending_approvals for one-click review. The send happens only when Blue
 * approves — /api/janet/approve runs the send_outbound_followup tool through the
 * executor (which advances the prospect + writes the ledger). Dedup against
 * already-queued follow-ups so repeated cron runs don't pile up duplicates.
 */
export async function runFollowUps(): Promise<{ queued: number; skipped_already_queued: number; errors: any[]; message?: string }> {
  const settings = await getAllSettings();
  // Batch cap on how many to draft per run (keeps the approval queue sane). This
  // no longer gates SENDS — sends are individually approved.
  const batchCap = parseInt(settings.daily_cap ?? '10', 10);

  const now = new Date().toISOString();
  const { data: due } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .in('status', ['sent', 'follow_up_1', 'follow_up_2'])
    .eq('disqualified', false) // skip if prospect was disqualified after sending initial
    .lte('next_follow_up_at', now)
    .not('contact_email', 'is', null)
    .order('next_follow_up_at', { ascending: true })
    .limit(batchCap);

  if (!due || due.length === 0) return { queued: 0, skipped_already_queued: 0, errors: [], message: 'No follow-ups due' };

  const alreadyQueued = await queuedProposalKeys('send_outbound_followup', 'prospect_id');

  let queued = 0;
  let skipped = 0;
  const errors: any[] = [];

  for (const prospect of due) {
    const followUpNumber = prospect.follow_up_count + 1;
    if (followUpNumber > 3) continue;
    if (alreadyQueued.has(prospect.id)) { skipped++; continue; }

    try {
      const { data: prevEmails } = await supabaseAdmin
        .from('outbound_emails')
        .select('body')
        .eq('prospect_id', prospect.id)
        .order('created_at', { ascending: true });

      const previousBodies = (prevEmails ?? []).map((e: any) => e.body);

      const followUpBody = await composeFollowUp(
        {
          contact_name: prospect.contact_name,
          company_name: prospect.company_name,
          pain_points: prospect.pain_points,
          ai_research: prospect.ai_research,
        },
        previousBodies,
        followUpNumber
      );

      const subject = `Re: ${prospect.draft_subject ?? 'Following up'}`;
      const summary = `Send follow-up #${followUpNumber} to ${prospect.contact_name ?? prospect.contact_email}${prospect.company_name ? ` (${prospect.company_name})` : ''}`;

      await queuePendingApproval({
        tool: 'send_outbound_followup',
        input: { prospect_id: prospect.id, follow_up_number: followUpNumber, subject, body: followUpBody },
        summary,
      });
      queued++;
    } catch (err: any) {
      errors.push({ id: prospect.id, error: err?.message ?? 'Unknown' });
    }
  }

  return { queued, skipped_already_queued: skipped, errors };
}

// ─── Process Inbound Reply ────────────────────────────────────────

/**
 * Called when an inbound email arrives (via webhook from Resend or Cloudflare).
 * Matches by sender email against active prospects.
 */
export async function processInboundReply(
  senderEmail: string,
  subject: string,
  body: string
): Promise<{ matched: boolean; prospectId?: string; action?: string }> {
  const email = senderEmail.toLowerCase().trim();

  // Check if this is a stop/unsubscribe
  const bodyLower = body.toLowerCase().trim();
  const isStop = /^stop$|^unsubscribe$|^remove me$|not interested/i.test(bodyLower.split('\n')[0]);

  // Find matching prospect by email
  const activeStatuses = ['sent', 'follow_up_1', 'follow_up_2', 'follow_up_3'];
  const { data: prospects } = await supabaseAdmin
    .from('prospects')
    .select('id, contact_email, gmail_thread_id, notes')
    .in('status', activeStatuses)
    .ilike('contact_email', email);

  if (!prospects || prospects.length === 0) {
    return { matched: false };
  }

  const prospect = prospects[0];

  if (isStop) {
    await supabaseAdmin.from('suppression_list').upsert(
      { email, reason: 'unsubscribed' },
      { onConflict: 'email' }
    );
    await supabaseAdmin
      .from('prospects')
      .update({
        status: 'suppressed',
        replied_at: new Date().toISOString(),
        next_follow_up_at: null,
        notes: (prospect.notes ?? '') + `\n\n[Auto] Unsubscribed: "${body.slice(0, 100)}"`,
      })
      .eq('id', prospect.id);

    return { matched: true, prospectId: prospect.id, action: 'suppressed' };
  }

  // Regular reply
  await supabaseAdmin
    .from('prospects')
    .update({
      status: 'replied',
      replied_at: new Date().toISOString(),
      next_follow_up_at: null,
      notes: (prospect.notes ?? '') + `\n\n[Auto] Reply received ${new Date().toISOString()}:\n${body.slice(0, 500)}`,
    })
    .eq('id', prospect.id);

  // Update outbound email records
  await supabaseAdmin
    .from('outbound_emails')
    .update({ status: 'replied' })
    .eq('prospect_id', prospect.id)
    .eq('status', 'sent');

  return { matched: true, prospectId: prospect.id, action: 'replied' };
}

// ─── Process Bounce ───────────────────────────────────────────────

export async function processBounce(email: string): Promise<void> {
  const addr = email.toLowerCase().trim();

  // Add to suppression list
  await supabaseAdmin.from('suppression_list').upsert(
    { email: addr, reason: 'bounced' },
    { onConflict: 'email' }
  );

  // Resolve the prospect(s) for this address so every write is scoped to them.
  const { data: hits } = await supabaseAdmin.from('prospects').select('id').eq('contact_email', addr);
  const prospectIds = (hits ?? []).map((p) => p.id);

  // Mark prospect as dead
  await supabaseAdmin
    .from('prospects')
    .update({
      status: 'dead',
      next_follow_up_at: null,
    })
    .eq('contact_email', addr)
    .in('status', ['sent', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'queued']);

  // Mark ONLY this prospect's sent emails as bounced. (Previously this ran
  // unscoped — .eq('status','sent') with no prospect filter — so a single bounce
  // flipped every 'sent' row in the table to 'bounced'.)
  if (prospectIds.length) {
    await supabaseAdmin
      .from('outbound_emails')
      .update({ status: 'bounced' })
      .in('prospect_id', prospectIds)
      .eq('status', 'sent');
  }
}
