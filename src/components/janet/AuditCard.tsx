/**
 * Audit results card (spec §7). Renders a run_url_audit (Lighthouse + Core Web
 * Vitals + security headers + SSL + basics + ranked findings) or a
 * run_site_scan (Build Standard pass/fail). Business-impact-first, cockpit
 * density. Vision/mobile-render land in Phase 5.5.
 */
type Sev = 'critical' | 'high' | 'medium' | 'low';

const SEV_COLOR: Record<Sev, string> = {
  critical: 'text-red-400',
  high: 'text-amber-400',
  medium: 'text-yellow-500',
  low: 'text-slate/60',
};
const SEV_DOT: Record<Sev, string> = {
  critical: 'bg-red-400',
  high: 'bg-amber-400',
  medium: 'bg-yellow-500',
  low: 'bg-slate/50',
};

function scoreColor(n: number): string {
  if (n >= 90) return 'text-emerald-400';
  if (n >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function ScoreChip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[52px]">
      <span className={`font-mono text-[15px] font-semibold ${value == null ? 'text-slate/40' : scoreColor(value)}`}>
        {value == null ? '—' : value}
      </span>
      <span className="font-mono text-[8px] tracking-widest uppercase text-slate/50">{label}</span>
    </div>
  );
}

function HeaderChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`font-mono text-[9px] tracking-wide px-1.5 py-0.5 rounded ${ok ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
      {ok ? '✓' : '✕'} {label}
    </span>
  );
}

export default function AuditCard({ tool, result }: { tool: string; result: any }) {
  const isScan = tool === 'run_site_scan' || !!result?.standard;
  return isScan ? <ScanCard result={result} /> : <UrlAuditCard result={result} />;
}

function UrlAuditCard({ result }: { result: any }) {
  const lh = result?.lighthouse;
  const sh = result?.security_headers ?? {};
  const ssl = result?.ssl ?? {};
  const findings: { severity: Sev; area: string; issue: string; impact: string }[] = result?.findings ?? [];
  const host = (() => {
    try {
      return new URL(result.url).host;
    } catch {
      return result?.url ?? 'site';
    }
  })();

  return (
    <div className="rounded-xl border border-white/10 bg-navy/70 overflow-hidden">
      {/* Header — score + host */}
      <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-white/10">
        <span className={`font-mono text-2xl font-bold leading-none ${scoreColor(result?.score ?? 0)}`}>{result?.score ?? '—'}</span>
        <div className="flex flex-col">
          <span className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate/50">Audit</span>
          <span className="text-cream text-[12px] truncate max-w-[190px]">{host}</span>
        </div>
      </div>

      <div className="px-3.5 py-3 flex flex-col gap-3">
        {/* Lighthouse */}
        {lh ? (
          <div className="flex items-center justify-between gap-1">
            <ScoreChip label="Perf" value={lh.performance} />
            <ScoreChip label="A11y" value={lh.accessibility} />
            <ScoreChip label="SEO" value={lh.seo} />
            <ScoreChip label="Best" value={lh.best_practices} />
          </div>
        ) : (
          <p className="font-mono text-[10px] text-slate/50">{result?.lighthouse_note ?? 'Lighthouse unavailable.'}</p>
        )}

        {/* Core Web Vitals */}
        {lh && (
          <div className="flex items-center gap-4 font-mono text-[10px] text-slate/70">
            <span>LCP <b className={lh.lcp_s != null && lh.lcp_s > 2.5 ? 'text-amber-400' : 'text-cream'}>{lh.lcp_s ?? '—'}s</b></span>
            <span>CLS <b className={lh.cls != null && lh.cls > 0.1 ? 'text-amber-400' : 'text-cream'}>{lh.cls ?? '—'}</b></span>
            <span>TBT <b className="text-cream">{lh.tbt_ms ?? '—'}ms</b></span>
          </div>
        )}

        {/* Security headers + SSL */}
        <div className="flex flex-wrap gap-1">
          <HeaderChip label="CSP" ok={!!sh.csp} />
          <HeaderChip label="HSTS" ok={!!sh.hsts} />
          <HeaderChip label="XFO" ok={!!sh.x_frame_options} />
          <HeaderChip label="XCTO" ok={!!sh.x_content_type_options} />
          <HeaderChip label={ssl.valid ? `SSL ${ssl.days_remaining ?? '?'}d` : 'SSL'} ok={!!ssl.valid} />
        </div>

        {/* Findings */}
        {findings.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-white/5 pt-2.5">
            {findings.slice(0, 8).map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${SEV_DOT[f.severity]}`} />
                <div className="min-w-0">
                  <p className="text-cream/90 text-[11px] leading-snug">
                    <span className={`font-mono text-[9px] uppercase tracking-wide mr-1.5 ${SEV_COLOR[f.severity]}`}>{f.severity}</span>
                    {f.issue}
                  </p>
                  <p className="text-slate/55 text-[10px] leading-snug">{f.impact}</p>
                </div>
              </div>
            ))}
            {findings.length > 8 && <p className="font-mono text-[9px] text-slate/40 pl-3.5">+{findings.length - 8} more</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function ScanCard({ result }: { result: any }) {
  const std = result?.standard ?? {};
  const checks: { id: string; label: string; severity: Sev; status: 'pass' | 'fail' | 'skip' }[] = std.checks ?? [];
  const site = result?.site ?? {};

  return (
    <div className="rounded-xl border border-white/10 bg-navy/70 overflow-hidden">
      <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-white/10">
        <span className={`font-mono text-2xl font-bold leading-none ${scoreColor(std.score ?? 0)}`}>{std.score ?? '—'}</span>
        <div className="flex flex-col">
          <span className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate/50">Build Standard</span>
          <span className="text-cream text-[12px] truncate max-w-[190px]">{site.name ?? site.url ?? 'site'}</span>
        </div>
        <span className="ml-auto font-mono text-[10px] text-slate/60">
          <span className="text-emerald-400">{std.passed ?? 0}✓</span> · <span className="text-red-400">{std.failed ?? 0}✕</span>
          {std.skipped ? <span className="text-slate/40"> · {std.skipped}—</span> : null}
        </span>
      </div>
      <div className="px-3.5 py-2.5 flex flex-col gap-1">
        {checks.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-[11px]">
            <span className={c.status === 'pass' ? 'text-emerald-400' : c.status === 'fail' ? 'text-red-400' : 'text-slate/40'}>
              {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '—'}
            </span>
            <span className={c.status === 'fail' ? 'text-cream/90' : 'text-slate/70'}>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
