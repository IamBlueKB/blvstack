import type { APIRoute } from 'astro';
import { runScrape } from '../../../../../lib/booker/engine';
import type { GigVertical } from '../../../../../lib/booker/types';

export const prerender = false;
export const maxDuration = 300;

const ALLOWED: GigVertical[] = ['dj', 'rapper', 'singer', 'band', 'musician', 'poet', 'visual_artist', 'any'];

/**
 * POST { vertical: GigVertical }
 * Scrapes all active sources for the vertical, normalizes results, inserts.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { vertical?: string; maxGigs?: number };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }

  const vertical = (body.vertical ?? '').toLowerCase();
  if (!ALLOWED.includes(vertical as GigVertical)) {
    return j({ error: 'Invalid vertical' }, 400);
  }

  const maxGigs = Math.min(Math.max(parseInt(String(body.maxGigs ?? 10), 10) || 10, 1), 200);

  try {
    const result = await runScrape(vertical as GigVertical, { maxGigs });
    return j({ ok: true, ...result });
  } catch (err: any) {
    return j({ error: err?.message ?? 'Scrape failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
