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

// ─── Mode 3 helpers (repo-depth audit) ─────────────────────────────
const GITHUB_TOKEN = import.meta.env.GITHUB_TOKEN || import.meta.env.GH_TOKEN || '';

function parseRepo(url: string): { owner: string; repo: string } | null {
  const m = String(url).match(/github\.com[/:]([^/\s]+)\/([^/\s#]+)/i);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, '') } : null;
}

/** Read a file from a repo: GitHub contents API (works for private with a token),
 *  falling back to public raw. Tries main then master. */
async function fetchRepoFile(owner: string, repo: string, path: string): Promise<string | null> {
  const headers: Record<string, string> = { 'User-Agent': 'BLVSTACK-JANET', Accept: 'application/vnd.github.raw' };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  for (const branch of ['main', 'master']) {
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) return await r.text();
    } catch {
      /* try raw next */
    }
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`, {
        headers: { 'User-Agent': 'BLVSTACK-JANET' },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) return await r.text();
    } catch {
      /* next branch */
    }
  }
  return null;
}

const cleanVersion = (range: string) => String(range).replace(/^[\^~>=<\s]*/, '').split(/[\s,|]/)[0] || '0.0.0';
const majorOf = (v: string) => parseInt(String(v).replace(/^[^\d]*/, '').split('.')[0], 10) || 0;

/** OSV batch query, chunked — a full lockfile (hundreds of packages) exceeds one
 *  batch, and the transitive deps are where the vulns that actually bite hide. */
async function osvBatch(deps: { name: string; version: string }[]): Promise<{ dep: { name: string; version: string }; vulns: any[] }[]> {
  const out: { dep: { name: string; version: string }; vulns: any[] }[] = [];
  for (let i = 0; i < deps.length; i += 500) {
    const chunk = deps.slice(i, i + 500);
    try {
      const r = await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: chunk.map((d) => ({ package: { name: d.name, ecosystem: 'npm' }, version: d.version })) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      (data.results ?? []).forEach((res: any, j: number) => {
        if (res.vulns?.length) out.push({ dep: chunk[j], vulns: res.vulns });
      });
    } catch {
      /* skip this chunk, keep going */
    }
  }
  return out;
}

/** Real severity for a vuln from OSV detail (GHSA severity string). Takes the
 *  worst across the package's advisories; unknown → 'high' (conservative). */
async function worstSeverity(ids: string[]): Promise<'critical' | 'high' | 'medium' | 'low'> {
  const sevs = await Promise.all(
    ids.slice(0, 3).map(async (id) => {
      try {
        const r = await fetch(`https://api.osv.dev/v1/vulns/${id}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return '';
        const d = await r.json();
        return String(d.database_specific?.severity ?? '').toUpperCase();
      } catch {
        return '';
      }
    })
  );
  if (sevs.some((s) => s.includes('CRIT'))) return 'critical';
  if (sevs.some((s) => s.includes('HIGH'))) return 'high';
  if (sevs.some((s) => s.includes('MOD') || s.includes('MED'))) return 'medium';
  if (sevs.some((s) => s.includes('LOW'))) return 'low';
  return 'high';
}

/** Exact installed packages from an npm v2/v3 package-lock.json (name@version). */
function parseLockfile(raw: string): { name: string; version: string }[] | null {
  try {
    const lock = JSON.parse(raw);
    const m = new Map<string, { name: string; version: string }>();
    for (const [p, meta] of Object.entries(lock.packages || {}) as [string, any][]) {
      if (!p.startsWith('node_modules/') || !meta?.version) continue;
      const name = p.split('node_modules/').pop() as string;
      m.set(`${name}@${meta.version}`, { name, version: meta.version });
    }
    return [...m.values()];
  } catch {
    return null;
  }
}

async function latestVersion(name: string): Promise<string | null> {
  try {
    const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      headers: { 'User-Agent': 'BLVSTACK-JANET' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return (await r.json()).version ?? null;
  } catch {
    return null;
  }
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
      "Repo-depth audit (Mode 3) for a connected site that has a repo_url — reads its package-lock.json (falling back to package.json) and reports KNOWN dependency vulnerabilities across the FULL installed tree incl. transitive deps (OSV), plus major-version drift on direct deps (npm), ranked by business impact (the cause behind symptoms; transitive vulns are the ones nobody inspects). Stores the result in scan history. Bundle-size / dead-code / safeguard analysis needs a build and isn't covered yet.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: { site_id: { type: 'string', description: 'janet_sites UUID (must have repo_url)' } },
      required: ['site_id'],
    },
    handler: async (input) => {
      const siteId = reqString(input, 'site_id');
      const { data: site, error } = await supabaseAdmin.from('janet_sites').select('id, name, repo_url').eq('id', siteId).single();
      if (error) throw new Error(error.message);
      if (!site.repo_url) return { ok: false, note: `No repo_url connected for ${site.name} — add the repo to run a depth audit.` };
      const parsed = parseRepo(site.repo_url);
      if (!parsed) return { ok: false, note: `repo_url is not a recognizable GitHub URL: ${site.repo_url}` };

      const pkgRaw = await fetchRepoFile(parsed.owner, parsed.repo, 'package.json');
      if (!pkgRaw) return { ok: false, note: `Could not read package.json from ${parsed.owner}/${parsed.repo}. If the repo is private, set GITHUB_TOKEN.` };
      let pkg: any;
      try {
        pkg = JSON.parse(pkgRaw);
      } catch {
        return { ok: false, note: 'Fetched package.json but it is not valid JSON.' };
      }

      const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      const directNames = new Set(Object.keys(allDeps));
      const directDeps = Object.entries(allDeps).map(([name, range]) => ({ name, version: cleanVersion(String(range)) }));

      // Full transitive coverage from the lockfile — the vulns that actually bite
      // (ws, protobufjs, dompurify…) live in transitive deps nobody inspects.
      // Fall back to direct deps only if there's no lockfile.
      const lockRaw = await fetchRepoFile(parsed.owner, parsed.repo, 'package-lock.json');
      const installed = lockRaw ? parseLockfile(lockRaw) : null;
      const scanSet = installed ?? directDeps;
      const coverage = installed ? `full (package-lock.json, ${installed.length} packages)` : 'direct deps only (no package-lock.json)';

      const findings: any[] = [];
      const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

      // Known vulnerabilities (OSV) across the full installed set, with real
      // severities fetched from OSV detail (so the score reflects reality).
      const vulnHits = await osvBatch(scanSet);
      const severities = await Promise.all(vulnHits.map((h) => worstSeverity(h.vulns.map((v: any) => v.id))));
      vulnHits.forEach((h, idx) => {
        const where = directNames.has(h.dep.name) ? 'direct' : 'transitive';
        findings.push({
          severity: severities[idx],
          issue: `${h.dep.name}@${h.dep.version} (${where}) — ${h.vulns.length} known vulnerabilit${h.vulns.length === 1 ? 'y' : 'ies'} (${h.vulns.slice(0, 3).map((v: any) => v.id).join(', ')})`,
          impact:
            where === 'direct'
              ? 'A direct dependency with a published CVE — a live security exposure.'
              : 'A published CVE in a transitive dependency — the kind nobody inspects; resolve by bumping the direct dep that pulls it.',
          category: 'dependency-vuln',
        });
      });

      // Major-version drift on DIRECT deps (what you actually upgrade).
      const sample = directDeps.slice(0, 40);
      const latests = await Promise.all(sample.map((d) => latestVersion(d.name)));
      let majorBehind = 0;
      sample.forEach((d, i) => {
        const latest = latests[i];
        if (latest && majorOf(d.version) > 0 && majorOf(latest) > majorOf(d.version)) {
          majorBehind++;
          if (majorBehind <= 8)
            findings.push({
              severity: 'medium',
              issue: `${d.name} is ${majorOf(latest) - majorOf(d.version)} major version(s) behind (${d.version} → ${latest})`,
              impact: 'Major-version drift compounds breaking-change and security debt; the longer it waits the harder the upgrade.',
              category: 'dependency-outdated',
            });
        }
      });

      findings.sort((a, b) => (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4));
      const crit = findings.filter((f) => f.severity === 'critical').length;
      const high = findings.filter((f) => f.severity === 'high').length;
      const med = findings.filter((f) => f.severity === 'medium').length;
      const low = findings.filter((f) => f.severity === 'low').length;
      // Severity-weighted exponential decay — doesn't floor to 0 the moment a repo
      // has a few highs, so it stays a metric you can track improving over time.
      const score = Math.round(100 * Math.exp(-(crit * 0.6 + high * 0.18 + med * 0.05 + low * 0.01)));

      const result = {
        ok: true,
        site: { id: site.id, name: site.name, repo: `${parsed.owner}/${parsed.repo}` },
        coverage,
        packages_scanned: scanSet.length,
        direct_deps: directDeps.length,
        vulnerable: vulnHits.length,
        major_behind: majorBehind,
        score,
        findings: findings.slice(0, 30),
        not_yet_covered: ['bundle size', 'dead/unused code', 'missing safeguards (error boundaries, hardcoded config)'],
      };

      await supabaseAdmin.from('janet_site_scans').insert({
        site_id: siteId,
        scan_type: 'repo',
        results: { repo: result },
        passed: scanSet.length - vulnHits.length,
        failed: vulnHits.length,
        score,
      });
      return result;
    },
  },
];
