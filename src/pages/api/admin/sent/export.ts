import type { APIRoute } from 'astro';
import { listSentForExport } from '../../../../lib/janet/sent';

export const prerender = false;

// GET /api/admin/sent/export?type=&source=&q= → CSV of the (non-trashed) sent
// log matching the current filters. Gated by admin middleware.
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.adminEmail) return new Response('Unauthorized', { status: 401 });

  const rows = await listSentForExport({
    type: url.searchParams.get('type'),
    source: url.searchParams.get('source'),
    q: url.searchParams.get('q'),
  });

  const cols = ['sent_at', 'source', 'type', 'status', 'to_name', 'to_email', 'from_email', 'actor', 'subject', 'body', 'related', 'resend_id'];
  const relatedOf = (r: (typeof rows)[number]) =>
    r.message_name ? `contact: ${r.message_name}` :
    r.lead_name ? `lead: ${r.lead_name}` :
    r.deal_name ? `deal: ${r.deal_name}` :
    r.client_name ? `client: ${r.client_name}` : '';

  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push([
      r.sent_at, r.source, r.type, r.status, r.to_name ?? '', r.to_email, r.from_email ?? '',
      r.actor ?? '', r.subject, r.body, relatedOf(r), r.resend_id ?? '',
    ].map(esc).join(','));
  }
  const csv = '﻿' + lines.join('\r\n'); // BOM so Excel reads UTF-8

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="blvstack-sent.csv"',
    },
  });
};
