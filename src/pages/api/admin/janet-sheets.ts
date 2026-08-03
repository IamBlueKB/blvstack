import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';

// Manage JANET's Google Sheets allowlist from the admin panel.
// POST { action:'add', sheet_url, label } | { action:'toggle', sheet_id, enabled } | { action:'remove', sheet_id }
export const prerender = false;

function sheetIdFrom(s: string): string | null {
  const t = (s || '').trim();
  const m = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9\-_]{20,}$/.test(t)) return t;
  return null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!(locals as any).adminEmail) return json({ error: 'Unauthorized' }, 401);
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  try {
    if (b.action === 'add') {
      const id = sheetIdFrom(b.sheet_url || '');
      if (!id) return json({ error: 'Could not read a Google Sheet id from that URL.' }, 400);
      await supabaseAdmin.from('janet_sheets').upsert({ sheet_id: id, label: (b.label || 'Sheet').trim() || 'Sheet', enabled: true }, { onConflict: 'sheet_id' });
      return json({ ok: true, sheet_id: id });
    }
    if (b.action === 'toggle') {
      if (!b.sheet_id) return json({ error: 'sheet_id required' }, 400);
      await supabaseAdmin.from('janet_sheets').update({ enabled: b.enabled === true }).eq('sheet_id', b.sheet_id);
      return json({ ok: true });
    }
    if (b.action === 'remove') {
      if (!b.sheet_id) return json({ error: 'sheet_id required' }, 400);
      await supabaseAdmin.from('janet_sheets').delete().eq('sheet_id', b.sheet_id);
      return json({ ok: true });
    }
    return json({ error: `Unknown action: ${b.action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
