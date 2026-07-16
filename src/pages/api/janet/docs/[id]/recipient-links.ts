import type { APIRoute } from 'astro';
import { getPageForDoc, createRecipientLink, getRecipientLinks } from '../../../../../lib/janet/publish';

export const prerender = false;

/**
 * Per-recipient tokened links for a published doc's page (publish panel).
 *  GET  → list existing links (recipient + url)
 *  POST { recipient_name, lead_id?, client_id? } → create one, returns its url
 * Auth: founder session (middleware gates /api/janet/*).
 */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.adminEmail) return j({ error: 'Unauthorized' }, 401);
  const page = await getPageForDoc(params.id!);
  if (!page) return j({ links: [] });
  const links = await getRecipientLinks(page.id);
  return j({ links: links.map((l: any) => ({ id: l.id, recipient: l.recipient_name, url: `https://blvstack.com/${page.slug}?v=${l.token}`, created_at: l.created_at })) });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.adminEmail) return j({ error: 'Unauthorized' }, 401);
  const page = await getPageForDoc(params.id!);
  if (!page?.published) return j({ error: 'Publish the page first, then generate recipient links.' }, 400);

  let body: { recipient_name?: string; lead_id?: string; client_id?: string };
  try {
    body = await request.json();
  } catch {
    return j({ error: 'Invalid JSON' }, 400);
  }
  const name = body.recipient_name?.trim();
  if (!name) return j({ error: 'Recipient name required' }, 400);

  const link = await createRecipientLink({ pageId: page.id, recipientName: name, leadId: body.lead_id ?? null, clientId: body.client_id ?? null });
  return j({ recipient: name, url: `https://blvstack.com/${page.slug}?v=${link.token}` });
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
