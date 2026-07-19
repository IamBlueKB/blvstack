// Phase 5.2 — view-ingest hardening.
//
// janet_page_views is public-writable (visitors POST /api/p/view), and the citation
// flip now binds "did they view it" claims to observations read from this table — so
// a FORGED view row is a forged observation, worse than none. This hardens the ingest:
//   • a server-issued SIGNED beacon token (HMAC of page_id + session) must validate,
//     so blind/cross-page POSTs without a token the server minted are rejected;
//   • durations are capped server-side (a replayed/inflated time-on-page can't stick);
//   • (the endpoint also rate-limits per page+session).
// This is NOT authentication — a real visitor's browser still reports the numbers — so
// getPageStats stays labelled "signed but client-reported, unauthenticated".

import { createHmac, timingSafeEqual } from 'node:crypto';

const ENV: any = (import.meta as any).env ?? {};
// Server-only HMAC key. Prefer a dedicated BEACON_SECRET; fall back to the service-
// role key (already a high-entropy server secret, never shipped to the browser) so
// this works with no new env. The key never leaves the server.
const SECRET: string = ENV.BEACON_SECRET || ENV.SUPABASE_SERVICE_ROLE_KEY || 'blvstack-dev-beacon-secret';

/** Max plausible time-on-page in one sitting. Beyond this is replay/inflation → capped. */
export const MAX_VIEW_SECONDS = 2 * 60 * 60; // 2h

/** HMAC binding a view to a specific page + session. Pure — secret passed in (testable). */
export function signBeacon(secret: string, pageId: string, sessionId: string): string {
  return createHmac('sha256', secret).update(`${pageId}:${sessionId}`).digest('hex').slice(0, 32);
}

/** Timing-safe verify. False on any missing/mismatched/wrong-page/wrong-session token. */
export function verifyBeacon(secret: string, pageId: string, sessionId: string, token: unknown): boolean {
  if (!sessionId || !pageId || typeof token !== 'string' || !token) return false;
  const expected = signBeacon(secret, pageId, sessionId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Env-bound convenience for the server call sites.
export const beaconToken = (pageId: string, sessionId: string): string => signBeacon(SECRET, pageId, sessionId);
export const checkBeacon = (pageId: string, sessionId: string, token: unknown): boolean => verifyBeacon(SECRET, pageId, sessionId, token);

/** Clamp a reported duration to [0, MAX_VIEW_SECONDS]; null if not a number. */
export function capDuration(d: unknown): number | null {
  const n = Number(d);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_VIEW_SECONDS, Math.max(0, Math.round(n)));
}

/** Clamp per-section engagement — each value ≤ MAX_VIEW_SECONDS, at most 100 sections. */
export function capSections(sections: unknown): Record<string, number> | null {
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return null;
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, v] of Object.entries(sections as Record<string, unknown>)) {
    if (n++ >= 100) break;
    const num = Number(v);
    if (Number.isFinite(num) && num > 0) out[String(k).slice(0, 80)] = Math.min(MAX_VIEW_SECONDS, Math.round(num));
  }
  return Object.keys(out).length ? out : null;
}
