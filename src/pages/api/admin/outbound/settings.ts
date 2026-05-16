import type { APIRoute } from 'astro';
import { getAllSettings, setSetting } from '../../../../lib/outbound-email';

export const prerender = false;

export const GET: APIRoute = async () => {
  const settings = await getAllSettings();
  return j({ settings });
};

export const PUT: APIRoute = async ({ request }) => {
  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const allowed = ['daily_cap', 'follow_up_days', 'outbound_from_email', 'outbound_from_name', 'outbound_calendar_link'];

  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) continue;

    if (key === 'daily_cap') {
      const num = parseInt(body[key], 10);
      if (isNaN(num) || num < 1 || num > 100) {
        return j({ error: 'daily_cap must be 1-100' }, 400);
      }
    }

    if (key === 'follow_up_days') {
      const days = body[key].split(',').map(Number);
      if (days.length !== 3 || days.some(isNaN) || days.some((d) => d < 1)) {
        return j({ error: 'follow_up_days must be 3 comma-separated numbers' }, 400);
      }
    }

    await setSetting(key, body[key]);
  }

  return j({ ok: true });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
