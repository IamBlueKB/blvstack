import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { resolveVercelProject, suspendSite, restoreSite } from '../../../../../../lib/janet/clearear/site-suspension';

// POST /api/admin/janet/sites/[id]/hosting — a site's hosting & billing controls (admin only, via middleware):
//   { action: 'save', vercel_project, billing_retainer_id, auto_suspend, suspend_grace_days }  link + policy
//   { action: 'suspend', reason? }  pause it now (BLVSTACK holding page) — a manual pause is never auto-restored
//   { action: 'restore' }           bring it back
export const prerender = false;

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, request, locals }) => {
  const admin = (locals as any).adminEmail as string | undefined;
  if (!admin) return j({ error: 'Unauthorized' }, 401);
  const id = params.id as string;
  let b: any;
  try { b = await request.json(); } catch { return j({ error: 'Invalid JSON' }, 400); }
  try {
    if (b.action === 'suspend') {
      const why = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 140) : 'paused from the admin';
      const r = await suspendSite(id, { reason: `manual: ${why}`, actor: admin });
      return j({ ok: true, already: r.already, site: r.site });
    }
    if (b.action === 'restore') {
      const r = await restoreSite(id, { actor: admin, why: 'restored from the admin' });
      return j({ ok: true, already: r.already, site: r.site });
    }
    if (b.action === 'save') {
      const patch: Record<string, unknown> = {};
      if (b.vercel_project !== undefined) {
        const v = String(b.vercel_project ?? '').trim();
        patch.vercel_project_id = v ? (await resolveVercelProject(v)).id : null;
      }
      if (b.billing_retainer_id !== undefined) {
        const rid = b.billing_retainer_id ? String(b.billing_retainer_id) : null;
        if (rid) {
          const { data: ret } = await supabaseAdmin.from('clearear_retainers').select('id').eq('id', rid).maybeSingle();
          if (!ret) return j({ error: 'That retainer doesn’t exist.' }, 400);
        }
        patch.billing_retainer_id = rid;
      }
      if (b.suspend_grace_days !== undefined) {
        const d = Math.round(Number(b.suspend_grace_days));
        if (!(d >= 1 && d <= 60)) return j({ error: 'Grace period must be 1–60 days.' }, 400);
        patch.suspend_grace_days = d;
      }
      if (b.auto_suspend !== undefined) patch.auto_suspend = !!b.auto_suspend;
      const { data: cur } = await supabaseAdmin.from('janet_sites').select('vercel_project_id, billing_retainer_id').eq('id', id).maybeSingle();
      if (!cur) return j({ error: 'Site not found.' }, 404);
      const next = { ...cur, ...patch } as any;
      if (patch.auto_suspend && (!next.vercel_project_id || !next.billing_retainer_id)) {
        return j({ error: 'Auto-pause needs both the Vercel project and the billing retainer linked.' }, 400);
      }
      const { data, error } = await supabaseAdmin.from('janet_sites').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return j({ ok: true, site: data });
    }
    return j({ error: "action must be 'save', 'suspend' or 'restore'" }, 400);
  } catch (e) {
    return j({ error: (e as Error).message }, 400);
  }
};
