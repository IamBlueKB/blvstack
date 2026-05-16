/**
 * Outbound engine — core logic for send batch, follow-ups, and reply detection.
 * Uses Resend for sending via tryblvstack.com, Supabase for state.
 */

import { supabaseAdmin } from '../supabase';
import { sendOutboundEmail, getAllSettings } from '../outbound-email';
import { composeFollowUp } from './composer';

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
      const result = await sendOutboundEmail({
        to: prospect.contact_email,
        subject: prospect.draft_subject,
        body: prospect.draft_email,
        headers: { 'X-Prospect-Id': prospect.id },
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

export async function runFollowUps(): Promise<{ sent: number; errors: any[]; message?: string }> {
  const settings = await getAllSettings();
  const dailyCap = parseInt(settings.daily_cap ?? '10', 10);
  const followUpDays = (settings.follow_up_days ?? '4,10,21').split(',').map(Number);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: sentToday } = await supabaseAdmin
    .from('outbound_emails')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString());

  const remaining = dailyCap - (sentToday ?? 0);
  if (remaining <= 0) return { sent: 0, errors: [], message: 'Daily cap reached' };

  const now = new Date().toISOString();
  const { data: due } = await supabaseAdmin
    .from('prospects')
    .select('*')
    .in('status', ['sent', 'follow_up_1', 'follow_up_2'])
    .lte('next_follow_up_at', now)
    .not('contact_email', 'is', null)
    .order('next_follow_up_at', { ascending: true })
    .limit(remaining);

  if (!due || due.length === 0) return { sent: 0, errors: [], message: 'No follow-ups due' };

  let sent = 0;
  const errors: any[] = [];

  for (const prospect of due) {
    const followUpNumber = prospect.follow_up_count + 1;
    if (followUpNumber > 3) continue;

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

      const result = await sendOutboundEmail({
        to: prospect.contact_email,
        subject: `Re: ${prospect.draft_subject ?? 'Following up'}`,
        body: followUpBody,
        headers: { 'X-Prospect-Id': prospect.id },
      });

      const typeMap: Record<number, string> = { 1: 'follow_up_1', 2: 'follow_up_2', 3: 'follow_up_3' };

      await supabaseAdmin.from('outbound_emails').insert({
        prospect_id: prospect.id,
        type: typeMap[followUpNumber] ?? 'follow_up_3',
        subject: `Re: ${prospect.draft_subject ?? 'Following up'}`,
        body: followUpBody,
        gmail_message_id: result.messageId,
        status: 'sent',
      });

      const updates: Record<string, unknown> = {
        status: followUpNumber >= 3 ? 'dead' : (typeMap[followUpNumber] ?? 'follow_up_3'),
        follow_up_count: followUpNumber,
        last_sent_at: new Date().toISOString(),
        gmail_message_id: result.messageId,
      };

      if (followUpNumber < 3 && followUpDays[followUpNumber]) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + followUpDays[followUpNumber]);
        updates.next_follow_up_at = nextDate.toISOString();
      } else {
        updates.next_follow_up_at = null;
      }

      await supabaseAdmin.from('prospects').update(updates).eq('id', prospect.id);
      sent++;
    } catch (err: any) {
      errors.push({ id: prospect.id, error: err?.message ?? 'Unknown' });
    }
  }

  return { sent, errors };
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

  // Mark prospect as dead
  await supabaseAdmin
    .from('prospects')
    .update({
      status: 'dead',
      next_follow_up_at: null,
    })
    .eq('contact_email', addr)
    .in('status', ['sent', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'queued']);

  // Update outbound email records
  await supabaseAdmin
    .from('outbound_emails')
    .update({ status: 'bounced' })
    .eq('status', 'sent');
}
