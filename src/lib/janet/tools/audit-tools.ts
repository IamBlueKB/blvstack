// JANET v1 — audit engine tools (spec §7), Ring 2 (they trigger a scan and
// may store results; they read public URLs, nothing leaves the building).

import { supabaseAdmin } from '../../supabase';
import { runUrlAudit } from '../audit';
import { evaluateStandard } from '../standard';
import type { JanetTool } from '../types';

function reqString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required input: ${key}`);
  return v;
}

export const auditTools: JanetTool[] = [
  {
    name: 'run_url_audit',
    description:
      "Audit ANY public URL — a prospect's site, an inquiry's current site, or a competitor. Returns Lighthouse scores (when available), Core Web Vitals, security headers, SSL status, a basics sweep (title/meta/OG/favicon/robots/sitemap/404), and findings ranked by business impact. This is the sales-and-QA weapon — use it whenever Blue wants to know how a site is doing.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The URL to audit (with or without https://)' } },
      required: ['url'],
    },
    handler: async (input) => {
      const url = reqString(input, 'url');
      return await runUrlAudit(url);
    },
  },
  {
    name: 'run_site_scan',
    description:
      'Run the BLVSTACK Build Standard QA scan on a CONNECTED portfolio site (by site id). Evaluates the site against the standard checklist, stores the result in the scan history, and returns pass/fail per check. Use for delivery QA and monitoring regressions.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: { site_id: { type: 'string', description: 'janet_sites UUID' } },
      required: ['site_id'],
    },
    handler: async (input) => {
      const siteId = reqString(input, 'site_id');
      const { data: site, error } = await supabaseAdmin.from('janet_sites').select('*').eq('id', siteId).single();
      if (error) throw new Error(error.message);
      if (!site?.production_url) throw new Error('Site has no production_url to scan.');

      const audit = await runUrlAudit(site.production_url);
      const standard = evaluateStandard(audit);

      const { error: insErr } = await supabaseAdmin.from('janet_site_scans').insert({
        site_id: siteId,
        scan_type: 'standard',
        results: { standard, audit },
        passed: standard.passed,
        failed: standard.failed,
        score: standard.score,
      });
      if (insErr) throw new Error(insErr.message);

      return {
        site: { id: site.id, name: site.name, url: site.production_url },
        standard,
        top_findings: audit.findings.slice(0, 5),
      };
    },
  },
  {
    name: 'run_repo_audit',
    description:
      'Deep code-level audit for a connected site with a repo (dependencies, bundle size, code smells). Not yet implemented in v1 — returns a note.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: { site_id: { type: 'string' } },
      required: ['site_id'],
    },
    handler: async () => {
      return { implemented: false, note: 'Repo-depth audit (Mode 3) lands in v1.5. Use run_site_scan for the live-site standard scan.' };
    },
  },
];
