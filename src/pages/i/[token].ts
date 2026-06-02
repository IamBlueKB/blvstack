import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * GET /i/<token>
 * Short redirect to /booker/intake/<token>.
 * Used in outbound emails so artists see a clean URL.
 */
export const GET: APIRoute = ({ params, redirect }) => {
  const { token } = params;
  if (!token) return redirect('/404', 302);
  return redirect(`/booker/intake/${token}`, 302);
};
