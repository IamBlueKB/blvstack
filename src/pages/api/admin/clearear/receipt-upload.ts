import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../lib/supabase';

// Upload a receipt image/PDF to the PRIVATE clearear-receipts bucket. Returns the
// storage path to store on the expense (receipt_url). Never public — display goes
// through a short-lived signed URL (receipt.ts).
export const prerender = false;
const BUCKET = 'clearear-receipts';
const MAX = 10 * 1024 * 1024;
const OK = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']);

export const POST: APIRoute = async ({ request, locals }) => {
  if (!(locals as any).adminEmail) return json({ error: 'Unauthorized' }, 401);
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'Expected multipart form data' }, 400); }
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file provided' }, 400);
  if (file.size === 0) return json({ error: 'Empty file' }, 400);
  if (file.size > MAX) return json({ error: 'File too large (max 10MB)' }, 400);
  if (!OK.has(file.type)) return json({ error: `Unsupported type ${file.type} — use an image or PDF` }, 400);

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  const rand = crypto.randomUUID();
  const y = new Date().getUTCFullYear();
  const path = `${y}/${rand}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, path });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
