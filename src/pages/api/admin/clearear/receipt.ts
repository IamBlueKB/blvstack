import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

// View a receipt: mints a short-lived signed URL for the private object and
// redirects to it. Admin-gated — the bucket stays private (receipts carry vendor
// and account detail).
export const prerender = false;
const BUCKET = 'clearear-receipts';

export const GET: APIRoute = async ({ url, locals }) => {
  if (!(locals as any).adminEmail) return new Response('Unauthorized', { status: 401 });
  const path = url.searchParams.get('path');
  if (!path) return new Response('Missing path', { status: 400 });
  // Guard against path traversal / cross-bucket paths.
  if (path.includes('..') || path.startsWith('/')) return new Response('Bad path', { status: 400 });
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return new Response('Not found', { status: 404 });
  return new Response(null, { status: 302, headers: { Location: data.signedUrl } });
};
