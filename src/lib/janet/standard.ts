// JANET v1 — the Build Standard (spec §7.2), as executable config. Blue extends
// this list as standards emerge — one edit, every connected site inherits it.
// run_site_scan evaluates a site's audit against these checks.

import type { AuditResult, Severity } from './audit';

export type StandardCheck = {
  id: string;
  label: string;
  severity: Exclude<Severity, never>;
  /** Returns true when the site PASSES this check. null = not determinable. */
  evaluate: (a: AuditResult) => boolean | null;
};

export const BUILD_STANDARD: StandardCheck[] = [
  { id: 'ssl-valid', label: 'SSL valid, >30 days to expiry', severity: 'critical', evaluate: (a) => a.ssl.valid && (a.ssl.days_remaining ?? 0) > 30 },
  { id: 'headers-security', label: 'Security headers present (CSP, HSTS, XFO, XCTO)', severity: 'high', evaluate: (a) => a.security_headers.csp && a.security_headers.hsts && a.security_headers.x_frame_options && a.security_headers.x_content_type_options },
  { id: 'meta-complete', label: 'Title + meta description present', severity: 'high', evaluate: (a) => !!a.basics.title && a.basics.meta_description },
  { id: 'og-tags', label: 'Open Graph tags present', severity: 'medium', evaluate: (a) => a.basics.og_tags },
  { id: 'favicon', label: 'Favicon present', severity: 'low', evaluate: (a) => a.basics.favicon },
  { id: 'custom-404', label: 'Custom 404 page', severity: 'medium', evaluate: (a) => a.basics.custom_404 },
  { id: 'sitemap', label: 'sitemap.xml present', severity: 'medium', evaluate: (a) => a.basics.sitemap_xml },
  { id: 'robots', label: 'robots.txt present', severity: 'medium', evaluate: (a) => a.basics.robots_txt },
  { id: 'cwv-lcp', label: 'LCP < 2.5s (mobile)', severity: 'high', evaluate: (a) => (a.lighthouse?.lcp_s == null ? null : a.lighthouse.lcp_s < 2.5) },
  { id: 'cwv-cls', label: 'CLS < 0.1 (mobile)', severity: 'high', evaluate: (a) => (a.lighthouse?.cls == null ? null : a.lighthouse.cls < 0.1) },
  { id: 'seo-score', label: 'SEO score ≥ 90', severity: 'medium', evaluate: (a) => (a.lighthouse?.seo == null ? null : a.lighthouse.seo >= 90) },
  // Blue extends this list as standards emerge.
];

export type StandardResult = {
  passed: number;
  failed: number;
  skipped: number;
  score: number; // 0–100 = passed / determinable
  checks: { id: string; label: string; severity: Severity; status: 'pass' | 'fail' | 'skip' }[];
};

export function evaluateStandard(audit: AuditResult): StandardResult {
  const checks = BUILD_STANDARD.map((c) => {
    const r = c.evaluate(audit);
    const status: 'pass' | 'fail' | 'skip' = r == null ? 'skip' : r ? 'pass' : 'fail';
    return { id: c.id, label: c.label, severity: c.severity, status };
  });
  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const skipped = checks.filter((c) => c.status === 'skip').length;
  const determinable = passed + failed;
  const score = determinable === 0 ? 0 : Math.round((passed / determinable) * 100);
  return { passed, failed, skipped, score, checks };
}
