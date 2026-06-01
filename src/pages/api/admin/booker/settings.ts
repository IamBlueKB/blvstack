import type { APIRoute } from 'astro';
import { getAllBookerSettings, setBookerSetting } from '../../../../lib/booker/booker-email';
import { requireActor, requireRole } from '../../../../lib/booker/access';
import type { BookerSettingKey } from '../../../../lib/booker/types';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;
  const settings = await getAllBookerSettings();
  return j({ settings });
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const actor = requireActor(locals);
  const denied = requireRole(actor, 'owner');
  if (denied) return denied;

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const allowed: BookerSettingKey[] = [
    'booker_from_email',
    'booker_from_name',
    'default_monthly_rate',
    'default_success_fee_pct',
    'match_threshold',
    'venue_daily_cap',
    'artist_send_signature',
  ];
  for (const k of Object.keys(body) as BookerSettingKey[]) {
    if (!allowed.includes(k)) continue;
    if (k === 'match_threshold' || k === 'venue_daily_cap' || k === 'default_monthly_rate') {
      const n = parseInt(body[k], 10);
      if (isNaN(n) || n < 0) return j({ error: `${k} must be a positive number` }, 400);
    }
    await setBookerSetting(k, body[k]);
  }
  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
