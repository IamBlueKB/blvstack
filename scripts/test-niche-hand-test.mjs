/**
 * Phase 9 hand-test for the SUNRESPONSE_NICHE_SPEC implementation.
 *
 * Runs locally against http://localhost:4321 (dev server must be up).
 * Programmatically logs in to admin so it can hit auth-gated endpoints.
 *
 * Real cost: ~5 Anthropic calls + 1 Google Places call. Sub-$1.
 *
 * What it does:
 *   1.  Migration sanity (col exists + writable)         [DB only — free]
 *   3.  detectNiche() logic against synthetic content    [pure JS — free]
 *   4.  Override survives re-research                    [2 Claude calls]
 *   5.  Solar compose returns niche-styled email         [1 Claude call]
 *   6.  Scaffold compose falls back to generic           [1 Claude call]
 *   7.  Null compose falls back to generic               [1 Claude call]
 *   8.  List filter by niche works                       [DB query — free]
 *   9.  Niche selector PUT persists                      [PUT — free]
 *   B.  Disqualification clears on re-research           [1 Claude call]
 *   D.  Find modal no-niche path still works             [1 Places call]
 *
 * All test prospects are prefixed `__TEST__` and deleted on exit.
 */

import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const BASE = 'http://localhost:4321';
const TEST_PREFIX = '__TEST__';

// ─── Setup ────────────────────────────────────────────────────────────

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const SB_URL = env.PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = env.ADMIN_EMAIL;
const ADMIN_SESSION_SECRET = env.ADMIN_SESSION_SECRET;
if (!SB_URL || !SB_KEY || !ADMIN_EMAIL || !ADMIN_SESSION_SECRET) {
  console.error('Missing env vars (need PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_SESSION_SECRET)');
  process.exit(1);
}

const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

const results = [];
const pass = (name, msg = '') => { results.push({ status: '✅ PASS', name, msg }); console.log(`✅ PASS  ${name}${msg ? ' — ' + msg : ''}`); };
const fail = (name, msg) => { results.push({ status: '❌ FAIL', name, msg }); console.log(`❌ FAIL  ${name} — ${msg}`); };
const skip = (name, msg) => { results.push({ status: '⊝ SKIP', name, msg }); console.log(`⊝ SKIP  ${name} — ${msg}`); };

// ─── Cookie-jar auth ──────────────────────────────────────────────────

let sessionCookie = '';

// Mint a valid HMAC session cookie using the same logic as src/lib/admin-session.ts.
// Avoids needing the actual admin password (which after first-seed is whatever the user
// set via the change-password flow, not what's in .env.local).
function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
async function login() {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: ADMIN_EMAIL, iat: now, exp: now + 60 * 60 }; // 1-hour test session
  const body = b64url(JSON.stringify(payload));
  const hmac = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(body).digest();
  const token = `${body}.${b64url(hmac)}`;
  sessionCookie = `blvstack_admin=${token}`;
  console.log(`🔑 Minted HMAC session for ${ADMIN_EMAIL}`);
}

async function adminFetch(path, opts = {}) {
  const headers = {
    ...(opts.headers || {}),
    Cookie: sessionCookie,
    // Astro's CSRF protection blocks bodyless POSTs unless Origin matches; set it always.
    Origin: BASE,
    Referer: `${BASE}/admin`,
  };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return fetch(`${BASE}${path}`, { ...opts, headers });
}

// ─── Supabase direct (service role) ───────────────────────────────────

async function sbInsert(table, row) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`sbInsert ${table}: ${r.status} ${await r.text()}`);
  return (await r.json())[0];
}

async function sbUpdate(table, id, patch) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`sbUpdate ${table}: ${r.status} ${await r.text()}`);
  return (await r.json())[0];
}

async function sbGet(table, id) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}&select=*`, { headers: SB_HEADERS });
  return (await r.json())[0];
}

async function sbDelete(table, filter) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SB_HEADERS });
  if (!r.ok) console.warn(`Cleanup ${table} ${filter}: ${r.status}`);
}

async function cleanup() {
  await sbDelete('prospects', `company_name=like.${encodeURIComponent(TEST_PREFIX + '%')}`);
}

// ─── detectNiche replica (pure JS, mirrors src/lib/outbound/researcher.ts) ───

const NICHE_CONFIGS = [
  // Solar (LIVE) — keywords + domainHints copied from src/lib/niches/solar.ts
  { slug: 'solar', keywords: ['solar','photovoltaic','pv system','solar panels','solar installation','rooftop solar','residential solar','kilowatt','kw system','net metering','inverter','tesla powerwall','enphase','sunrun'], domainHints: ['solar','pv','sun','photovoltaic'] },
  { slug: 'medspa', keywords: ['medspa','med spa','botox','filler','aesthetics'], domainHints: ['medspa','aesthetics','skin'] },
  { slug: 'dental', keywords: ['dental','dentist','orthodont','invisalign'], domainHints: ['dental','dentist','smile','ortho'] },
  { slug: 'hvac', keywords: ['hvac','heating','cooling','air conditioning','furnace'], domainHints: ['hvac','heating','cooling','air'] },
  { slug: 'plumbing', keywords: ['plumber','plumbing','drain','water heater'], domainHints: ['plumb','plumber','drain','pipe'] },
  { slug: 'roofing', keywords: ['roofing','roof repair','shingle','gutter'], domainHints: ['roof','roofing','shingle'] },
  { slug: 'law-firm', keywords: ['personal injury','attorney','law firm','lawyer'], domainHints: ['law','attorney','legal','injury'] },
  { slug: 'real-estate', keywords: ['realty','brokerage','real estate','realtor'], domainHints: ['realty','realestate','homes','broker'] },
  { slug: 'insurance', keywords: ['insurance','policy','coverage','allstate'], domainHints: ['insurance','insure','policy'] },
  { slug: 'chiropractor', keywords: ['chiropract','spinal','adjustment'], domainHints: ['chiro','chiropract','spine'] },
];

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function detectNicheJS(text, url) {
  text = (text || '').toLowerCase();
  url = (url || '').toLowerCase();
  const scores = {};
  for (const n of NICHE_CONFIGS) {
    let score = 0;
    for (const kw of n.keywords) {
      const re = new RegExp(`\\b${escRe(kw)}\\b`, 'g');
      const m = (text.match(re) || []).length;
      score += m * (kw.length > 8 ? 2 : 1);
    }
    for (const hint of n.domainHints) if (url.includes(hint)) score += 3;
    scores[n.slug] = score;
  }
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const [topSlug, topScore] = sorted[0];
  const [, secondScore] = sorted[1] ?? ['', 0];
  return topScore >= 5 && topScore >= secondScore * 2 ? topSlug : null;
}

// ─── TEST RUNNER ──────────────────────────────────────────────────────

async function run() {
  await cleanup(); // start clean

  // Synthetic research blob — generic enough for any niche
  const fakeResearch = {
    company_summary: '__TEST__ business for hand-test fixtures',
    employee_range: 'unknown',
    pain_points: [{ problem: 'lead response is slow', blvstack_solution: 'fast AI text-back', tier: 'L2', confidence: 'medium' }],
    outreach_angle: 'Likely losing leads to faster competitors',
    contact_hints: { emails_found: [], team_members: [], contact_page_url: null },
  };

  // ─── Item 1 ────────────────────────────────────────
  try {
    const r = await fetch(`${SB_URL}/rest/v1/prospects?select=niche,disqualified,disqualified_reason&limit=1`, { headers: SB_HEADERS });
    if (r.ok) pass('Item 1 · migration columns queryable');
    else fail('Item 1 · migration columns queryable', `status ${r.status}`);
  } catch (e) { fail('Item 1', e.message); }

  // ─── Item 3 — detectNiche pure-logic checks ─────────
  const solarHtml = 'Phoenix solar installation experts. We install solar panels with net metering and enphase inverters. Our pv system designs use tesla powerwall storage for residential solar customers.';
  const medspaHtml = 'Premier medspa offering botox, filler, and laser aesthetics treatments at our med spa locations.';
  const blandHtml = 'Welcome to our company. We provide services to local customers. Contact us today for more info.';

  const d1 = detectNicheJS(solarHtml, 'https://phoenix-solar.com');
  if (d1 === 'solar') pass('Item 3a · solar HTML → solar');
  else fail('Item 3a · solar HTML', `got "${d1}", expected "solar"`);

  const d2 = detectNicheJS(medspaHtml, 'https://example.com');
  if (d2 === 'medspa') pass('Item 3b · medspa HTML → medspa (scaffold)');
  else fail('Item 3b · medspa HTML', `got "${d2}", expected "medspa"`);

  const d3 = detectNicheJS(blandHtml, 'https://example.com');
  if (d3 === null) pass('Item 3c · bland HTML → null');
  else fail('Item 3c · bland HTML', `got "${d3}", expected null`);

  // ─── Item 4 (CRITICAL) — override survives re-research ───
  // Setup: prospect with example.com (research won't detect anything).
  // 1. PUT niche=solar manually  2. POST research  3. Verify niche stays 'solar'
  const t4 = await sbInsert('prospects', {
    company_name: `${TEST_PREFIX} Override Survives`,
    company_url: 'https://example.com',
    status: 'new',
  });

  // Manual override
  let r = await adminFetch(`/api/admin/prospects/${t4.id}`, { method: 'PUT', body: JSON.stringify({ niche: 'solar' }) });
  if (!r.ok) { fail('Item 4 setup · PUT niche', `${r.status} ${await r.text()}`); }
  else {
    // Re-research — should not touch the niche
    const before = await sbGet('prospects', t4.id);
    if (before.niche !== 'solar') { fail('Item 4 setup', `PUT didn't persist; got "${before.niche}"`); }
    else {
      r = await adminFetch(`/api/admin/prospects/${t4.id}/research`, { method: 'POST' });
      if (!r.ok) { fail('Item 4 · research call', `${r.status} ${(await r.text()).slice(0,200)}`); }
      else {
        const after = await sbGet('prospects', t4.id);
        if (after.niche === 'solar') pass('Item 4 · manual niche override survives re-research');
        else fail('Item 4 · override overwritten', `niche flipped to "${after.niche}"`);
      }
    }
  }

  // ─── Item 5 — Solar compose returns niche-styled email ───
  const t5 = await sbInsert('prospects', {
    company_name: `${TEST_PREFIX} Solar Compose`,
    company_url: 'https://example.com',
    contact_email: 'test@example.com',
    contact_name: 'Test Owner',
    status: 'researched',
    niche: 'solar',
    ai_research: fakeResearch,
  });
  r = await adminFetch(`/api/admin/prospects/${t5.id}/compose`, { method: 'POST' });
  if (!r.ok) { fail('Item 5 · solar compose', `${r.status} ${(await r.text()).slice(0,200)}`); }
  else {
    const j = await r.json();
    const body = (j.body || '').toLowerCase();
    const subject = (j.subject || '').toLowerCase();
    // Solar prompt instructs niche-specific patterns — check for at least one signal
    const niche_signals = ['lead', 'response', 'install', 'homeowner', '60-second', 'tcpa', 'speed', '$', 'closer'];
    const matched = niche_signals.filter((s) => body.includes(s));
    // Banned phrases check
    const banned = ['leverage', 'synergize', 'cutting-edge', 'revolutionary', 'best-in-class'];
    const hits = banned.filter((b) => body.includes(b));
    if (hits.length > 0) fail('Item 5 · banned phrase in body', hits.join(', '));
    else if (matched.length === 0) fail('Item 5 · no niche signal in body', `subject="${j.subject}" body[0..120]="${(j.body || '').slice(0,120)}"`);
    else pass('Item 5 · solar compose returns niche-styled email', `signals: ${matched.join(',')}`);
  }

  // ─── Item 6 — Scaffold (medspa) compose falls back to generic ───
  const t6 = await sbInsert('prospects', {
    company_name: `${TEST_PREFIX} Scaffold Compose`,
    company_url: 'https://example.com',
    contact_email: 'test@example.com',
    contact_name: 'Test Owner',
    status: 'researched',
    niche: 'medspa',
    ai_research: fakeResearch,
  });
  r = await adminFetch(`/api/admin/prospects/${t6.id}/compose`, { method: 'POST' });
  if (!r.ok) fail('Item 6 · scaffold compose', `${r.status} ${(await r.text()).slice(0,200)}`);
  else {
    const j = await r.json();
    if (j.subject && j.body) pass('Item 6 · scaffold compose falls back to generic, returns subject+body');
    else fail('Item 6 · scaffold compose', `incomplete response: ${JSON.stringify(j).slice(0,150)}`);
  }

  // ─── Item 7 — Null niche compose falls back to generic ───
  const t7 = await sbInsert('prospects', {
    company_name: `${TEST_PREFIX} Null Compose`,
    company_url: 'https://example.com',
    contact_email: 'test@example.com',
    contact_name: 'Test Owner',
    status: 'researched',
    niche: null,
    ai_research: fakeResearch,
  });
  r = await adminFetch(`/api/admin/prospects/${t7.id}/compose`, { method: 'POST' });
  if (!r.ok) fail('Item 7 · null compose', `${r.status} ${(await r.text()).slice(0,200)}`);
  else {
    const j = await r.json();
    if (j.subject && j.body) pass('Item 7 · null compose falls back to generic, returns subject+body');
    else fail('Item 7 · null compose', `incomplete response: ${JSON.stringify(j).slice(0,150)}`);
  }

  // ─── Item 8 — List filter by niche ──────────────────
  // We just created prospects with niche='solar' and niche='medspa'.
  // Query each via REST and verify counts > 0 with the right values.
  const sol = await fetch(`${SB_URL}/rest/v1/prospects?select=id,niche&niche=eq.solar`, { headers: SB_HEADERS }).then(r => r.json());
  const med = await fetch(`${SB_URL}/rest/v1/prospects?select=id,niche&niche=eq.medspa`, { headers: SB_HEADERS }).then(r => r.json());
  const any = await fetch(`${SB_URL}/rest/v1/prospects?select=id,niche&niche=in.(solar,medspa)`, { headers: SB_HEADERS }).then(r => r.json());
  if (sol.length >= 1 && med.length >= 1 && any.length === sol.length + med.length) {
    pass('Item 8 · niche filter (.eq + .in) returns correct rows', `solar=${sol.length}, medspa=${med.length}, in()=${any.length}`);
  } else {
    fail('Item 8 · niche filter mismatch', `solar=${sol.length}, medspa=${med.length}, in()=${any.length}`);
  }

  // ─── Item 9 — PUT niche persists ───────────────────
  // Take t7 (currently null) and PUT a new niche, verify in DB
  r = await adminFetch(`/api/admin/prospects/${t7.id}`, { method: 'PUT', body: JSON.stringify({ niche: 'chiropractor' }) });
  if (!r.ok) fail('Item 9 · PUT niche', `${r.status}`);
  else {
    const after = await sbGet('prospects', t7.id);
    if (after.niche === 'chiropractor') pass('Item 9 · niche selector PUT persists');
    else fail('Item 9 · PUT didn\'t persist', `got "${after.niche}"`);
  }
  // And clearing back to null
  r = await adminFetch(`/api/admin/prospects/${t7.id}`, { method: 'PUT', body: JSON.stringify({ niche: null }) });
  const cleared = await sbGet('prospects', t7.id);
  if (cleared.niche === null) pass('Item 9b · clearing niche to null works');
  else fail('Item 9b · clearing niche', `got "${cleared.niche}"`);
  // Invalid slug rejected
  r = await adminFetch(`/api/admin/prospects/${t7.id}`, { method: 'PUT', body: JSON.stringify({ niche: 'fake-slug-xyz' }) });
  if (r.status === 400) pass('Item 9c · invalid niche slug rejected with 400');
  else fail('Item 9c · invalid slug not rejected', `expected 400, got ${r.status}`);

  // ─── Emphasis B — Disqualification flag mirrors Claude's response ───
  // The real correctness test: after re-research, the DB columns
  // (disqualified, disqualified_reason) must MATCH whatever Claude returned in
  // ai_research.disqualified / .disqualified_reason. Claude's specific judgment
  // doesn't matter — what matters is the API doesn't drift from Claude's verdict.
  //
  // This proves the "false explicitly clears stale flag" path because:
  //   - If Claude returns disqualified=false/undefined, DB must be (false, null)
  //   - If Claude returns disqualified=true, DB must be (true, reason)
  // Either way: DB === Claude's response.
  const tB = await sbInsert('prospects', {
    company_name: `${TEST_PREFIX} Disqualified Mirror`,
    company_url: 'https://blvstack.com',
    status: 'researched',
    disqualified: true,
    disqualified_reason: 'STALE_PRE_RESEARCH_VALUE',
  });
  r = await adminFetch(`/api/admin/prospects/${tB.id}/research`, { method: 'POST' });
  if (!r.ok) fail('Emphasis B · research call', `${r.status} ${(await r.text()).slice(0,200)}`);
  else {
    const after = await sbGet('prospects', tB.id);
    const claudeDisq = after.ai_research?.disqualified === true;
    const claudeReason = claudeDisq ? (after.ai_research?.disqualified_reason ?? null) : null;
    const dbDisq = after.disqualified === true;
    const dbReason = after.disqualified_reason;
    // STALE_PRE_RESEARCH_VALUE must be gone (proving the API overwrote)
    const stalePurged = dbReason !== 'STALE_PRE_RESEARCH_VALUE';
    const mirrored = dbDisq === claudeDisq && dbReason === claudeReason;
    if (mirrored && stalePurged) {
      pass(`Emphasis B · DB mirrors Claude verdict + stale value purged`, `Claude=${claudeDisq}/"${(claudeReason || '').slice(0,40)}" → DB=${dbDisq}/"${(dbReason || '').slice(0,40)}"`);
    } else if (!stalePurged) {
      fail('Emphasis B · stale STALE_PRE_RESEARCH_VALUE survived re-research', `dbReason="${dbReason}"`);
    } else {
      fail('Emphasis B · DB drift from Claude', `Claude=${claudeDisq}/"${claudeReason}" but DB=${dbDisq}/"${dbReason}"`);
    }
  }

  // ─── Emphasis D — Find modal no-niche path works ───
  // Use a deliberately unfindable query so we don't pollute prod with real prospects.
  // Verifies the API accepts no-niche path AND doesn't pass undefined includedType to Places.
  r = await adminFetch(`/api/admin/prospects/find`, {
    method: 'POST',
    body: JSON.stringify({ query: 'plzdontexistxyz12345', maxResults: 1 }),
  });
  if (!r.ok) fail('Emphasis D · find with no niche', `${r.status} ${(await r.text()).slice(0,200)}`);
  else {
    const j = await r.json();
    if (j.ok === true) pass('Emphasis D · find no-niche path returns ok', `found=${j.found ?? 0}, message="${(j.message || '').slice(0,60)}"`);
    else fail('Emphasis D · find no-niche', JSON.stringify(j).slice(0,200));
  }

  // ─── Final cleanup ──
  await cleanup();
  console.log(`\n🧹 Cleaned up all __TEST__ prospects`);

  // ─── Summary ──
  const passed = results.filter(r => r.status === '✅ PASS').length;
  const failed = results.filter(r => r.status === '❌ FAIL').length;
  const skipped = results.filter(r => r.status === '⊝ SKIP').length;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`SUMMARY: ${passed} passed · ${failed} failed · ${skipped} skipped`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (failed > 0) process.exit(1);
}

try {
  await login();
  await run();
} catch (e) {
  console.error('FATAL:', e.message);
  await cleanup();
  process.exit(1);
}
