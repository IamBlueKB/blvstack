import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { runUrlAudit } from '../../../../../../lib/janet/audit';
import { evaluateStandard } from '../../../../../../lib/janet/standard';

export const prerender = false;
export const maxDuration = 120;

/** POST /api/admin/janet/sites/[id]/scan — run the Build Standard scan now.
 *  Same engine + storage as run_site_scan / the heartbeat. */
export const POST: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return j({ error: 'Missing id' }, 400);
  const { data: site, error } = await supabaseAdmin.from('janet_sites').select('id, production_url').eq('id', id).single();
  if (error) return j({ error: error.message }, 404);
  if (!site?.production_url) return j({ error: 'Site has no production_url' }, 400);
  try {
    const audit = await runUrlAudit(site.production_url);
    const standard = evaluateStandard(audit);
    await supabaseAdmin.from('janet_site_scans').insert({
      site_id: id,
      scan_type: 'standard',
      results: { standard, audit },
      passed: standard.passed,
      failed: standard.failed,
      score: standard.score,
    });
    return j({ ok: true, score: standard.score, passed: standard.passed, failed: standard.failed });
  } catch (e: any) {
    return j({ error: e?.message ?? 'scan failed' }, 500);
  }
};

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
