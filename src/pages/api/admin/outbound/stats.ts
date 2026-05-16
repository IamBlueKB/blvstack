import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';
import { getAllSettings } from '../../../../lib/outbound-email';

export const prerender = false;

export const GET: APIRoute = async () => {
  const settings = await getAllSettings();

  // Pipeline counts
  const statuses = [
    'new', 'researched', 'composed', 'queued', 'sent',
    'follow_up_1', 'follow_up_2', 'follow_up_3',
    'replied', 'booked', 'dead', 'suppressed',
  ];

  const pipeline: Record<string, number> = {};
  for (const s of statuses) {
    const { count } = await supabaseAdmin
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .eq('status', s);
    pipeline[s] = count ?? 0;
  }

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { count: sentThisWeek } = await supabaseAdmin
    .from('outbound_emails')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', weekAgo.toISOString());

  const { count: bouncedThisWeek } = await supabaseAdmin
    .from('outbound_emails')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'bounced')
    .gte('created_at', weekAgo.toISOString());

  const { count: repliedThisWeek } = await supabaseAdmin
    .from('outbound_emails')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'replied')
    .gte('created_at', weekAgo.toISOString());

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: sentToday } = await supabaseAdmin
    .from('outbound_emails')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString());

  const dailyCap = parseInt(settings.daily_cap ?? '10', 10);
  const bounceRate = (sentThisWeek ?? 0) > 0
    ? ((bouncedThisWeek ?? 0) / (sentThisWeek ?? 1) * 100).toFixed(1)
    : '0.0';
  const replyRate = (sentThisWeek ?? 0) > 0
    ? ((repliedThisWeek ?? 0) / (sentThisWeek ?? 1) * 100).toFixed(1)
    : '0.0';

  const bounceRateNum = parseFloat(bounceRate);
  const health = bounceRateNum > 5 ? 'danger' : bounceRateNum > 2 ? 'warning' : 'good';

  return j({
    pipeline,
    week: {
      sent: sentThisWeek ?? 0,
      bounced: bouncedThisWeek ?? 0,
      replied: repliedThisWeek ?? 0,
      bounce_rate: bounceRate,
      reply_rate: replyRate,
    },
    today: {
      sent: sentToday ?? 0,
      cap: dailyCap,
      remaining: Math.max(0, dailyCap - (sentToday ?? 0)),
    },
    health,
    settings: {
      daily_cap: dailyCap,
      follow_up_days: settings.follow_up_days ?? '4,10,21',
      outbound_from_email: settings.outbound_from_email ?? 'blue@tryblvstack.com',
    },
  });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
