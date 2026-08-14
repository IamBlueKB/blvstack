import type { APIRoute } from 'astro';
import { createProject, updateProject } from '../../../../lib/janet/clearear/projects';
import { assertBusiness } from '../../../../lib/janet/clearear/expenses';

// POST /api/admin/clearear/projects — create a project, or update one with `id`.
export const prerender = false;

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  if (!(locals as any).adminEmail) return json({ error: 'Unauthorized' }, 401);
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  try {
    if (b.action === 'update' && b.id) {
      const p = await updateProject(b.id, {
        name: b.name, total_value: b.total_value != null ? Number(b.total_value) : undefined,
        status: b.status, start_date: b.start_date, target_date: b.target_date, notes: b.notes,
      });
      return json({ ok: true, project: p });
    }
    const p = await createProject({
      business: assertBusiness(b.business),
      contact_id: b.contact_id,
      name: b.name,
      total_value: b.total_value != null && b.total_value !== '' ? Number(b.total_value) : null,
      status: b.status,
      start_date: b.start_date || null,
      target_date: b.target_date || null,
      notes: b.notes || null,
      actor: (locals as any).adminEmail,
    });
    return json({ ok: true, project: p });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};
