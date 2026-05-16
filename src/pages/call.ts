import type { APIRoute } from 'astro';

export const prerender = false;

const CALENDAR_URL = 'https://calendar.app.google/vgSAfcJ9BXho8CEY9';

/** GET /call — redirects to the BLVSTACK booking calendar */
export const GET: APIRoute = () => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: CALENDAR_URL,
      'Cache-Control': 'public, max-age=300',
    },
  });
};
