// JANET v1 — the audit engine (spec §7). One engine, JANET's QA system AND
// BLVSTACK's sales weapon.
//
// 80/20 per Blue's 2026-07-09 call: the reliable core — security headers, SSL,
// and the basics sweep — needs NO external API and always runs. Lighthouse via
// the PageSpeed Insights API is the degradable component: attempted with an
// optional key, gracefully skipped (lighthouse: null + note) if the API is
// unavailable. Mobile-render screenshots + the Claude Vision pass are Phase 5.5
// (they need headless Chromium) and are deliberately NOT here.

import tls from 'node:tls';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type AuditFinding = {
  severity: Severity;
  area: string; // 'performance' | 'security' | 'ssl' | 'seo' | 'basics'
  issue: string;
  impact: string; // why it matters, in business terms
};

export type LighthouseResult = {
  performance: number | null; // 0–100
  accessibility: number | null;
  seo: number | null;
  best_practices: number | null;
  lcp_s: number | null; // seconds
  cls: number | null;
  tbt_ms: number | null;
};

export type AuditResult = {
  url: string;
  ok: boolean;
  fetched_at: string;
  lighthouse: LighthouseResult | null;
  lighthouse_note?: string;
  security_headers: Record<'csp' | 'hsts' | 'x_frame_options' | 'x_content_type_options' | 'referrer_policy', boolean>;
  ssl: { valid: boolean; expires_at: string | null; days_remaining: number | null; error?: string };
  basics: {
    title: string | null;
    meta_description: boolean;
    og_tags: boolean;
    favicon: boolean;
    robots_txt: boolean;
    sitemap_xml: boolean;
    custom_404: boolean;
  };
  findings: AuditFinding[]; // ranked, most severe first
  score: number; // 0–100 composite
};

const UA = 'Mozilla/5.0 (compatible; BLVSTACK-JANET-Audit/1.0)';
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function normalizeUrl(raw: string): URL {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return new URL(u);
}

async function fetchWithTimeout(url: string, ms: number, method: 'GET' | 'HEAD' = 'GET'): Promise<Response | null> {
  try {
    return await fetch(url, {
      method,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(ms),
    });
  } catch {
    return null;
  }
}

/**
 * Fetch the homepage HTML robustly. A single transient empty/blocked response
 * (cold start, edge challenge, a bare redirect body) must NOT get recorded as
 * "all head tags missing" — that's what produced the PSRx false-regression. So
 * if the first read looks empty (no <title> / tiny body), retry once, preferring
 * the www canonical. Only whichever attempt actually returned content is kept.
 */
async function fetchHomeHtml(url: URL): Promise<{ response: Response | null; html: string }> {
  const read = async (target: string): Promise<{ response: Response | null; html: string }> => {
    const response = await fetchWithTimeout(target, 10_000);
    let html = '';
    if (response && response.ok) {
      try {
        html = (await response.text()).slice(0, 200_000);
      } catch {}
    }
    return { response, html };
  };
  const looksEmpty = (r: { response: Response | null; html: string }) =>
    !r.response || !r.response.ok || r.html.length < 500 || !/<title[^>]*>/i.test(r.html);

  let best = await read(url.toString());
  if (looksEmpty(best)) {
    // Retry once — prefer the www canonical if we weren't already on it.
    const canonical = new URL(url.toString());
    if (!/^www\./i.test(canonical.hostname)) canonical.hostname = `www.${canonical.hostname}`;
    const retryTarget = canonical.toString() !== url.toString() ? canonical.toString() : url.toString();
    const retry = await read(retryTarget);
    if (!looksEmpty(retry) || retry.html.length > best.html.length) best = retry;
  }
  return best;
}

function checkSSL(hostname: string): Promise<AuditResult['ssl']> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: AuditResult['ssl']) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const socket = tls.connect({ host: hostname, port: 443, servername: hostname, timeout: 8000 }, () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        socket.end();
        if (!cert || !cert.valid_to) return done({ valid: false, expires_at: null, days_remaining: null, error: 'no certificate' });
        const expires = new Date(cert.valid_to);
        const days = Math.floor((expires.getTime() - Date.now()) / 86_400_000);
        done({ valid: authorized && days > 0, expires_at: expires.toISOString(), days_remaining: days });
      });
      socket.on('error', (e) => done({ valid: false, expires_at: null, days_remaining: null, error: e.message }));
      socket.on('timeout', () => {
        socket.destroy();
        done({ valid: false, expires_at: null, days_remaining: null, error: 'timeout' });
      });
    } catch (e: any) {
      done({ valid: false, expires_at: null, days_remaining: null, error: e?.message ?? 'ssl check failed' });
    }
  });
}

async function runLighthouse(url: string): Promise<{ result: LighthouseResult | null; note?: string }> {
  const key = import.meta.env.PAGESPEED_API_KEY || import.meta.env.GOOGLE_PAGESPEED_API_KEY || '';
  // Performance only: a 4-category mobile run takes ~60-70s (times out and
  // silently loses ALL lighthouse data). Performance is the signal this audit
  // surfaces (perf score + LCP/CLS/TBT); SEO/security are covered by our own
  // checks. One category keeps the run well inside the timeout.
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance${key ? `&key=${key}` : ''}`;
  try {
    const r = await fetch(api, { signal: AbortSignal.timeout(50_000) });
    if (!r.ok) {
      return { result: null, note: r.status === 403 ? 'Lighthouse skipped — enable the PageSpeed Insights API (set PAGESPEED_API_KEY).' : `Lighthouse skipped — PageSpeed API returned ${r.status}.` };
    }
    const j: any = await r.json();
    const cat = j?.lighthouseResult?.categories ?? {};
    const audits = j?.lighthouseResult?.audits ?? {};
    const pct = (s: any) => (typeof s === 'number' ? Math.round(s * 100) : null);
    return {
      result: {
        performance: pct(cat.performance?.score),
        accessibility: pct(cat.accessibility?.score),
        seo: pct(cat.seo?.score),
        best_practices: pct(cat['best-practices']?.score),
        lcp_s: typeof audits['largest-contentful-paint']?.numericValue === 'number' ? +(audits['largest-contentful-paint'].numericValue / 1000).toFixed(2) : null,
        cls: typeof audits['cumulative-layout-shift']?.numericValue === 'number' ? +audits['cumulative-layout-shift'].numericValue.toFixed(3) : null,
        tbt_ms: typeof audits['total-blocking-time']?.numericValue === 'number' ? Math.round(audits['total-blocking-time'].numericValue) : null,
      },
    };
  } catch {
    return { result: null, note: 'Lighthouse skipped — PageSpeed API timed out or was unreachable.' };
  }
}

/** Mode 1 — audit any URL (spec §7.1). Reliable core always runs; Lighthouse degrades. */
export async function runUrlAudit(rawUrl: string): Promise<AuditResult> {
  const url = normalizeUrl(rawUrl);
  const base = url.origin;
  const fetchedAt = new Date().toISOString();

  const [homeResult, robots, sitemap, notFound, ssl, lh] = await Promise.all([
    fetchHomeHtml(url),
    fetchWithTimeout(`${base}/robots.txt`, 6_000),
    fetchWithTimeout(`${base}/sitemap.xml`, 6_000, 'HEAD'),
    fetchWithTimeout(`${base}/janet-audit-probe-9f7x-nonexistent`, 6_000),
    checkSSL(url.hostname),
    runLighthouse(url.toString()),
  ]);

  const home = homeResult.response;
  const html = homeResult.html;
  const reachable = !!home && home.ok;
  const lower = html.toLowerCase();

  // Security headers (read from the homepage response).
  const h = (name: string) => (home ? home.headers.get(name) : null);
  const security_headers = {
    csp: !!h('content-security-policy'),
    hsts: !!h('strict-transport-security'),
    x_frame_options: !!(h('x-frame-options') || h('content-security-policy')?.includes('frame-ancestors')),
    x_content_type_options: (h('x-content-type-options') || '').toLowerCase() === 'nosniff',
    referrer_policy: !!h('referrer-policy'),
  };

  // Basics sweep.
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const basics = {
    title: titleMatch ? titleMatch[1].trim() : null,
    meta_description: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(html),
    og_tags: /<meta[^>]+property=["']og:/i.test(html),
    favicon: /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(lower) || (await fetchWithTimeout(`${base}/favicon.ico`, 4_000, 'HEAD'))?.ok === true,
    robots_txt: !!robots && robots.ok,
    sitemap_xml: !!sitemap && sitemap.ok,
    custom_404: !!notFound && notFound.status === 404,
  };

  const findings = buildFindings({ reachable, ssl, security_headers, basics, lighthouse: lh.result });
  const score = compositeScore({ ssl, security_headers, basics, lighthouse: lh.result, findings });

  return {
    url: url.toString(),
    ok: reachable,
    fetched_at: fetchedAt,
    lighthouse: lh.result,
    lighthouse_note: lh.note,
    security_headers,
    ssl,
    basics,
    findings,
    score,
  };
}

function buildFindings(d: {
  reachable: boolean;
  ssl: AuditResult['ssl'];
  security_headers: AuditResult['security_headers'];
  basics: AuditResult['basics'];
  lighthouse: LighthouseResult | null;
}): AuditFinding[] {
  const f: AuditFinding[] = [];

  if (!d.reachable) f.push({ severity: 'critical', area: 'basics', issue: 'Site did not respond', impact: 'Visitors and crawlers cannot load the page at all.' });

  // SSL
  if (d.ssl.error || !d.ssl.valid) {
    f.push({ severity: 'critical', area: 'ssl', issue: `SSL invalid${d.ssl.error ? ` (${d.ssl.error})` : ''}`, impact: 'Browsers warn visitors the site is not secure — most bounce immediately.' });
  } else if (typeof d.ssl.days_remaining === 'number' && d.ssl.days_remaining < 14) {
    f.push({ severity: 'critical', area: 'ssl', issue: `SSL expires in ${d.ssl.days_remaining} days`, impact: 'The certificate is about to lapse — the site will show a security warning when it does.' });
  } else if (typeof d.ssl.days_remaining === 'number' && d.ssl.days_remaining < 30) {
    f.push({ severity: 'high', area: 'ssl', issue: `SSL expires in ${d.ssl.days_remaining} days`, impact: 'Renew before it lapses to avoid a security-warning outage.' });
  }

  // Lighthouse (only when available)
  if (d.lighthouse) {
    const lcp = d.lighthouse.lcp_s;
    if (typeof lcp === 'number') {
      if (lcp >= 4) f.push({ severity: 'critical', area: 'performance', issue: `LCP ${lcp}s (mobile)`, impact: 'Largest content takes 4s+ to paint — most mobile visitors abandon before it loads.' });
      else if (lcp > 2.5) f.push({ severity: 'high', area: 'performance', issue: `LCP ${lcp}s (mobile)`, impact: 'Over the 2.5s budget — hurts conversions and Google ranking.' });
    }
    if (typeof d.lighthouse.cls === 'number' && d.lighthouse.cls > 0.1) f.push({ severity: 'medium', area: 'performance', issue: `CLS ${d.lighthouse.cls}`, impact: 'Layout shifts as it loads — feels janky, mis-taps happen.' });
    if (typeof d.lighthouse.seo === 'number' && d.lighthouse.seo < 80) f.push({ severity: 'high', area: 'seo', issue: `SEO score ${d.lighthouse.seo}`, impact: 'Search engines will surface this site below better-optimized competitors.' });
    if (typeof d.lighthouse.accessibility === 'number' && d.lighthouse.accessibility < 80) f.push({ severity: 'medium', area: 'seo', issue: `Accessibility score ${d.lighthouse.accessibility}`, impact: 'Barriers for assistive tech; also a legal-exposure and SEO signal.' });
  }

  // Security headers
  if (!d.security_headers.hsts) f.push({ severity: 'high', area: 'security', issue: 'No HSTS header', impact: 'Connections can be downgraded to insecure HTTP on first visit.' });
  if (!d.security_headers.csp) f.push({ severity: 'high', area: 'security', issue: 'No Content-Security-Policy', impact: 'No defense-in-depth against injected/malicious scripts (XSS).' });
  if (!d.security_headers.x_content_type_options) f.push({ severity: 'medium', area: 'security', issue: 'No X-Content-Type-Options: nosniff', impact: 'Browsers may MIME-sniff responses into executable content.' });
  if (!d.security_headers.x_frame_options) f.push({ severity: 'medium', area: 'security', issue: 'No clickjacking protection (X-Frame-Options / frame-ancestors)', impact: 'The site can be framed for clickjacking attacks.' });
  if (!d.security_headers.referrer_policy) f.push({ severity: 'low', area: 'security', issue: 'No Referrer-Policy', impact: 'Full referrer URLs leak to third parties.' });

  // Basics
  if (d.reachable && !d.basics.title) f.push({ severity: 'high', area: 'basics', issue: 'No <title>', impact: 'Search results and browser tabs have nothing to show.' });
  if (d.reachable && !d.basics.meta_description) f.push({ severity: 'medium', area: 'seo', issue: 'No meta description', impact: 'Google writes its own snippet — you lose control of the pitch in search results.' });
  if (d.reachable && !d.basics.og_tags) f.push({ severity: 'medium', area: 'seo', issue: 'No Open Graph tags', impact: 'Shared links render as bare URLs with no title/image — low click-through.' });
  if (!d.basics.robots_txt) f.push({ severity: 'low', area: 'basics', issue: 'No robots.txt', impact: 'Crawlers have no guidance; harmless but sloppy.' });
  if (!d.basics.sitemap_xml) f.push({ severity: 'medium', area: 'seo', issue: 'No sitemap.xml', impact: 'Slower, less complete indexing of the site’s pages.' });
  if (!d.basics.custom_404) f.push({ severity: 'low', area: 'basics', issue: 'No custom 404', impact: 'Broken links dump visitors on a default error page instead of recovering them.' });
  if (!d.basics.favicon) f.push({ severity: 'low', area: 'basics', issue: 'No favicon', impact: 'Blank tab icon reads as unfinished.' });

  return f.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function compositeScore(d: {
  ssl: AuditResult['ssl'];
  security_headers: AuditResult['security_headers'];
  basics: AuditResult['basics'];
  lighthouse: LighthouseResult | null;
  findings: AuditFinding[];
}): number {
  let score = 100;
  for (const f of d.findings) score -= { critical: 22, high: 12, medium: 6, low: 2 }[f.severity];
  return Math.max(0, Math.min(100, Math.round(score)));
}
