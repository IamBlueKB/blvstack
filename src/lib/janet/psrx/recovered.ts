// Recovered-revenue report (Phase 1.3) — the number the PSRx proof deck rests on.
// Reads the attribution chain from PSRx (read-only role): cold → JANET qualified
// + drafted → staff approved → sent → engaged (Brevo opens/clicks) → converted +
// attributed (janet_conversions, written by the webhook OR the staff surface).
// Honest confidence throughout: staff_confirmed vs auto_matched vs correlated;
// unknowns marked unknown; never inferred.

import { psrxSql, psrxConnected } from './client';

export type RecoveredConversion = {
  lead_id: string;
  name: string;
  converted_at: string;
  treatment_value: number | null;
  confidence: string; // staff_confirmed | auto_matched | correlated
  source: string; // staff | aestheticspro_webhook
  credited_draft_id: string | null;
};

export type RecoveredReport = {
  connected: boolean;
  period_days: number;
  reengaged: number; // distinct leads JANET actually SENT a re-engagement to in the period
  engaged: number; // of those, how many opened/clicked (Brevo)
  converted: number; // attributed recoveries in the period
  recovered_revenue: number; // sum of treatment_value where known
  known_value_count: number; // conversions with a $ value entered (vs unknown)
  by_confidence: Record<string, number>;
  conversions: RecoveredConversion[];
  note?: string;
};

const empty = (periodDays: number, note?: string): RecoveredReport => ({
  connected: false, period_days: periodDays, reengaged: 0, engaged: 0, converted: 0,
  recovered_revenue: 0, known_value_count: 0, by_confidence: {}, conversions: [], note,
});

export async function getRecoveredRevenue(periodDays = 90): Promise<RecoveredReport> {
  if (!psrxConnected()) return empty(periodDays, 'PSRx not connected');
  const sql = psrxSql();
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();
  try {
    // Sequential (the transaction pooler deadlocks on concurrent queries).
    const reengaged = (await sql`
      select count(distinct lead_id)::int as n
      from janet_lead_drafts where status = 'sent' and sent_at >= ${since}`) as Array<{ n: number }>;

    const engaged = (await sql`
      select count(distinct d.lead_id)::int as n
      from janet_lead_drafts d
      join lead_messages m on m.lead_id = d.lead_id
      where d.status = 'sent' and d.sent_at >= ${since}
        and (m.opened_at is not null or m.clicked_at is not null)`) as Array<{ n: number }>;

    const conv = (await sql`
      select c.lead_id, c.converted_at, c.treatment_value, c.confidence, c.source, c.credited_draft_id,
             coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.email, 'lead') as name
      from janet_conversions c
      join assessment_leads l on l.id = c.lead_id
      where c.recovered_via_reengagement = true and c.converted_at >= ${since}
      order by c.converted_at desc`) as Array<any>;

    const recovered_revenue = conv.reduce((s, r) => s + (Number(r.treatment_value) || 0), 0);
    const known_value_count = conv.filter((r) => r.treatment_value != null).length;
    const by_confidence: Record<string, number> = {};
    for (const r of conv) by_confidence[r.confidence] = (by_confidence[r.confidence] ?? 0) + 1;

    return {
      connected: true,
      period_days: periodDays,
      reengaged: reengaged[0]?.n ?? 0,
      engaged: engaged[0]?.n ?? 0,
      converted: conv.length,
      recovered_revenue,
      known_value_count,
      by_confidence,
      conversions: conv.map((r) => ({
        lead_id: String(r.lead_id),
        name: r.name,
        converted_at: new Date(r.converted_at).toISOString(),
        treatment_value: r.treatment_value != null ? Number(r.treatment_value) : null,
        confidence: r.confidence,
        source: r.source,
        credited_draft_id: r.credited_draft_id ? String(r.credited_draft_id) : null,
      })),
    };
  } catch (e: any) {
    // Table not yet created / query failed → degrade honestly, don't fabricate.
    return { ...empty(periodDays, `recovered-revenue query failed: ${e?.message ?? 'error'}`), connected: true };
  }
}
