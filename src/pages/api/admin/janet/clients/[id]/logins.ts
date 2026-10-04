import type { APIRoute } from 'astro';
import { listLogins, saveLogin, deleteLogin, revealSecret, SECRET_FIELDS, type SecretField } from '../../../../../../lib/client-logins';

// /api/admin/janet/clients/[id]/logins — a client's logins vault (founder-only via middleware; never JANET).
//   GET                                   list (no secrets — only whether each is set)
//   POST { action: 'save', ...login }     add / update (secrets blank = keep)
//   POST { action: 'delete', id }         remove
//   POST { action: 'reveal', id, field }  decrypt one secret (logged)
export const prerender = false;

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ params, locals }) => {
  if (!(locals as any).adminEmail) return j({ error: 'Unauthorized' }, 401);
  try { return j({ ok: true, logins: await listLogins(params.id as string) }); }
  catch (e) { return j({ error: (e as Error).message }, 400); }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const actor = (locals as any).adminEmail as string | undefined;
  if (!actor) return j({ error: 'Unauthorized' }, 401);
  const clientId = params.id as string;
  let b: any;
  try { b = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  try {
    if (b.action === 'reveal') {
      if (!SECRET_FIELDS.includes(b.field)) return j({ error: 'Unknown field.' }, 400);
      const value = await revealSecret(String(b.id), b.field as SecretField, actor);
      return j({ ok: true, value });
    }
    if (b.action === 'delete') {
      await deleteLogin(String(b.id), clientId, actor);
      return j({ ok: true });
    }
    if (b.action === 'save') {
      const id = await saveLogin({
        id: b.id || null, client_id: clientId, site_id: b.site_id || null,
        service: b.service, login_url: b.login_url, username: b.username, notes: b.notes,
        password: b.password, api_key: b.api_key, secret_notes: b.secret_notes,
      }, actor);
      return j({ ok: true, id });
    }
    return j({ error: "action must be 'save', 'delete' or 'reveal'" }, 400);
  } catch (e) {
    return j({ error: (e as Error).message }, 400);
  }
};
