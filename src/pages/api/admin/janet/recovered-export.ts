import type { APIRoute } from 'astro';
import { getRecoveredRevenue } from '../../../../lib/janet/psrx/recovered';

export const prerender = false;
export const maxDuration = 60;

/** GET /api/admin/janet/recovered-export?days=90 — CSV of attributed recoveries
 *  (the PSRx proof deck). Admin-gated. */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.adminEmail) return new Response('Unauthorized', { status: 401 });
  const days = Math.max(1, Number(url.searchParams.get('days') ?? '90') || 90);
  const r = await getRecoveredRevenue(days);

  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(`# PSRx recovered revenue — last ${days} days`);
  lines.push(`# re-engaged (sent),${r.reengaged}`);
  lines.push(`# engaged,${r.engaged}`);
  lines.push(`# converted (attributed),${r.converted}`);
  lines.push(`# recovered revenue (known $),${r.recovered_revenue}`);
  lines.push(`# conversions with known value,${r.known_value_count} of ${r.converted}`);
  lines.push('');
  lines.push(['name', 'converted_at', 'treatment_value', 'confidence', 'source', 'lead_id', 'credited_draft_id'].join(','));
  for (const c of r.conversions) {
    lines.push([c.name, c.converted_at, c.treatment_value ?? 'unknown', c.confidence, c.source, c.lead_id, c.credited_draft_id ?? ''].map(esc).join(','));
  }
  const csv = '﻿' + lines.join('\r\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="psrx-recovered-${days}d.csv"`,
    },
  });
};
