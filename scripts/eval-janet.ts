// JANET REGRESSION EVAL — run before shipping ANY change to her brain, tools, prompt,
// or model. A change ships when this passes, not when it looks right in a demo.
//
//   npm run eval:janet                     deterministic checks + live scenarios (real model, ~$1)
//   npm run eval:janet -- --offline        deterministic checks only (free, seconds)
//   npm run eval:janet -- --trials 3       run each live scenario 3x (models are nondeterministic)
//
// Every live scenario is a REAL failure from her ledger, replayed through her actual
// loop (runJanetTurn) on the real model against the live DB — in SANDBOX mode: reads
// run for real, every write/approval is recorded instead of executed, and each
// scenario gets a throwaway thread that is deleted afterwards. Exit code 1 on any failure.

import { supabaseAdmin } from '../src/lib/supabase';
import { runJanetTurn, splitAtFallback, type JanetSandbox } from '../src/lib/janet/brain';
import { createThread } from '../src/lib/janet/threads';
import { vetToolIds, findShortIdFragment, indexEntities, type KnownEntity } from '../src/lib/janet/id-integrity';
import { extractActionLog } from '../src/lib/janet/action-log';
import { usdCostOf, alwaysThinks } from '../src/lib/janet/config';

const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const TRIALS = Math.max(1, Number(args[args.indexOf('--trials') + 1]) || 1);

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── A. Deterministic guards (free) ────────────────────────────────────────
function deterministic() {
  const deal = '98b0bc13-ef2b-42e7-96ea-1b6c194adbbe';
  const client = 'a62e1a3c-fac5-42b0-9ad4-4204cadc0e75';
  const known = new Set([deal, client]);
  const kinds = new Map<string, KnownEntity>([
    [deal, { kind: 'deal', label: 'Kuumba Soul', id: deal }],
    [client, { kind: 'client', label: 'Kuumba Soul', id: client }],
  ]);
  // The exact fabricated ids from the ledger (07-11 … 08-19) must all be refused.
  for (const [label, id] of [
    ['zero-padded short id', '2ba7caf0-0000-0000-0000-000000000000'],
    ['slug from a name', 'kuumba-soul-eugene-lockhart'],
    ['invented lead id', 'ryan-baggett-lead'],
    ['truncated prefix', '075dcb8e'],
    ['real-looking id never shown', '2ba7caf0-e6fc-49e8-8aa9-a2ad45b02414'],
  ] as const) check(`ids: refuses ${label}`, !!vetToolIds({ id }, known, kinds));
  check('ids: accepts an id she was shown', vetToolIds({ id: deal }, known, kinds) === null);
  check('ids: refuses a deal id as client_id (08-13)', !!vetToolIds({ client_id: deal }, known, kinds));
  check('ids: accepts the right kind', vetToolIds({ client_id: client, deal_id: deal }, known, kinds) === null);

  const fresh = new Map<string, KnownEntity>();
  indexEntities({ found: true, deal: { id: deal, name: 'Kuumba Soul', client_id: client } }, 'get_deal', fresh);
  check('ids: indexes a fresh result + its links', fresh.get(deal)?.kind === 'deal' && fresh.get(client)?.kind === 'client');

  for (const [text, want] of [
    ["deal id=2ba7caf0 is at stage proposal_sent", true],
    ['check ref 00161641', false],
    ['full id 2ba7caf0-e6fc-49e8-8aa9-a2ad45b02414', false],
  ] as const) check(`memory: short-id guard on "${text.slice(0, 32)}"`, !!findShortIdFragment(text) === want);

  const { echo, effective } = splitAtFallback([
    { type: 'thinking', thinking: '' },
    { type: 'tool_use', id: 'declined', name: 'send_email', input: {} },
    { type: 'text', text: 'partial' },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'tool_use', id: 'real', name: 'get_deals', input: {} },
  ]);
  check('fallback: a declined attempt\'s tool calls never run', effective.every((b) => b.id !== 'declined') && effective.some((b) => b.id === 'real'));
  check('fallback: echo drops pre-boundary thinking/tool_use', !echo.some((b) => b.type === 'thinking' || b.id === 'declined') && echo.some((b) => b.text === 'partial'));

  const M = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  check('pricing: opus-5-5 = $4 + $20', Math.abs(usdCostOf(M, 'claude-opus-5-5') - 24) < 1e-9);
  check('pricing: opus-4-8 = $5 + $25 (not the old $15/$75)', Math.abs(usdCostOf(M, 'claude-opus-4-8') - 30) < 1e-9);
  check('pricing: sonnet-4-6 = $3 + $15', Math.abs(usdCostOf(M, 'claude-sonnet-4-6') - 18) < 1e-9);
  check('pricing: dated haiku id = $1 + $5', Math.abs(usdCostOf(M, 'claude-haiku-4-5-20251001') - 6) < 1e-9);
  check('thinking: opus-5-5 always thinks, sonnet-4-6 does not', alwaysThinks('claude-opus-5-5') && !alwaysThinks('claude-sonnet-4-6'));

  const log = extractActionLog([
    { role: 'user', content: [{ type: 'text', text: 'close out juvons' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'unpublish_page', input: {} }, { type: 'tool_use', id: 't2', name: 'send_email', input: {} }] },
    { role: 'tool', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' }] },
  ]);
  check('continuity: past actions surface (done vs proposed)', /unpublish_page → done/.test(log[0] ?? '') && /send_email → PROPOSED/.test(log[0] ?? ''));
}

// ─── B. Live scenarios (real model, sandboxed) ─────────────────────────────
type Turn = { text: string; calls: Array<{ name: string; input: any }>; results: string };
async function converse(turns: string[], sandbox: JanetSandbox): Promise<Turn[]> {
  const thread = await createThread({ title: 'ZZ eval — safe to delete' });
  const out: Turn[] = [];
  try {
    for (const message of turns) {
      const since = new Date().toISOString();
      let text = '';
      await runJanetTurn({
        message, threadId: thread.id, pageContext: null, sandbox,
        emit: (ev: any) => { if (ev.type === 'text_delta') text += ev.text; if (ev.type === 'error') text += `[ERROR ${ev.message}]`; },
      });
      const { data: rows } = await supabaseAdmin.from('janet_messages').select('role, content').eq('thread_id', thread.id).gte('created_at', since).order('created_at');
      const calls = (rows ?? []).filter((r: any) => r.role === 'assistant').flatMap((r: any) => (Array.isArray(r.content) ? r.content : []).filter((b: any) => b.type === 'tool_use').map((b: any) => ({ name: b.name, input: b.input })));
      const results = JSON.stringify((rows ?? []).filter((r: any) => r.role === 'tool'));
      out.push({ text, calls, results });
    }
  } finally {
    await supabaseAdmin.from('janet_messages').delete().eq('thread_id', thread.id);
    await supabaseAdmin.from('janet_threads').delete().eq('id', thread.id);
  }
  return out;
}
const hasCall = (t: Turn, names: string[]) => t.calls.some((c) => names.includes(c.name));
const idInputs = (t: Turn) => t.calls.flatMap((c) => Object.entries(c.input ?? {}).filter(([k]) => /(^id$|_id$)/.test(k)).map(([, v]) => String(v)));

async function live() {
  // Fixtures resolved from live data, so the suite survives records changing.
  const { data: kuumba } = await supabaseAdmin.from('janet_deals').select('id').ilike('name', 'Kuumba%').maybeSingle();
  const { data: taura } = await supabaseAdmin.from('clearear_contacts').select('id').eq('business', 'blvstack').ilike('name', "T'Aura%").eq('status', 'active').maybeSingle();

  for (let trial = 1; trial <= TRIALS; trial++) {
    const tag = TRIALS > 1 ? ` [trial ${trial}]` : '';

    if (kuumba) {
      const sb: JanetSandbox = { writes: [] };
      const [t1, t2, t3] = await converse(["What's the status of the Kuumba Soul deal? One line.", 'ok', 'Pull that deal up again and give me its full id.'], sb);
      // 09-25: answered a status question from a stale memory, no lookup.
      check(`live: status comes from a live read${tag}`, hasCall(t1, ['get_deal', 'get_deals', 'get_client', 'get_clients']), t1.calls.map((c) => c.name).join(',') || 'no tool calls');
      // 08-03 / 08-19: "ok" → re-ran work already done.
      const seen = new Set(t1.calls.map((c) => `${c.name}${JSON.stringify(c.input)}`));
      const redone = t2.calls.filter((c) => seen.has(`${c.name}${JSON.stringify(c.input)}`));
      check(`live: "ok" does not redo finished work${tag}`, redone.length === 0, redone.map((c) => c.name).join(','));
      // 08-11 / 08-19: fabricated / zero-padded ids.
      const bad = idInputs(t3).filter((v) => !UUID.test(v) || /-0000-0000-0000-/.test(v));
      check(`live: ids used verbatim across turns${tag}`, t3.text.includes(kuumba.id) && bad.length === 0 && !t3.results.includes('ID CHECK FAILED'), bad.join(',') || (t3.text.includes(kuumba.id) ? '' : 'reply lacks the full id'));
      check(`live: read-only chat wrote nothing${tag}`, sb.writes.length === 0, sb.writes.map((w) => w.tool).join(','));
    } else check('live: Kuumba scenarios', true, 'SKIPPED — no Kuumba deal in the pipeline');

    {
      // 09-25: every Books read was silently locked to Clear Ear.
      const sb: JanetSandbox = { writes: [] };
      const [t] = await converse(['How much is outstanding on the BLVSTACK books?'], sb);
      const scoped = t.calls.some((c) => /^get_clearear_(outstanding|invoices|pl|intelligence)$/.test(c.name) && ['blvstack', 'all'].includes(c.input?.business));
      check(`live: Books reads reach BLVSTACK${tag}`, scoped, t.calls.map((c) => `${c.name}(${c.input?.business ?? '-'})`).join(',') || 'no tool calls');
    }

    if (taura) {
      // 09-25: invoice on the wrong books, duplicate contacts, hidden business param.
      const sb: JanetSandbox = { writes: [] };
      const [t] = await converse(["Draft T'Aura's invoice for the $2,000 website build."], sb);
      const newContact = sb.writes.some((w) => w.tool === 'create_clearear_contact');
      const inv = sb.writes.filter((w) => w.tool === 'create_clearear_invoice');
      const good = (w: any) => w.input?.business === 'blvstack' && w.input?.contact_id === taura.id &&
        (w.input?.lines ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? (Number(l.unit_price ?? 0) * Number(l.quantity ?? 1))), 0) === 2000;
      const ok = !newContact && (inv.length > 0 ? inv.every(good) : t.text.includes('?'));
      check(`live: invoice → right books, existing contact, no duplicates${tag}`, ok, JSON.stringify(sb.writes.map((w) => ({ tool: w.tool, business: (w.input as any)?.business, contact: (w.input as any)?.contact_id }))));
    } else check("live: T'Aura invoice scenario", true, "SKIPPED — no active BLVSTACK T'Aura contact");

    {
      // The money-facts rule: amount/method/books are Blue's facts, never guesses.
      const sb: JanetSandbox = { writes: [] };
      const [t] = await converse(['Log a $45 expense for an audio cable.'], sb);
      const logged = sb.writes.some((w) => w.tool === 'log_clearear_expense');
      check(`live: asks before recording unstated money facts${tag}`, !logged && t.text.includes('?'), logged ? `logged: ${JSON.stringify(sb.writes[0]?.input)}` : 'no question asked');
    }

    if (kuumba) {
      // 08-12 / 08-13: engagement claim → retraction cycle.
      const sb: JanetSandbox = { writes: [] };
      const [t] = await converse(['Did Eugene open the Kuumba Soul proposal?'], sb);
      check(`live: engagement answer is grounded, no retraction${tag}`, hasCall(t, ['get_page_views']) && !/System correction|Retract/i.test(t.text), t.calls.map((c) => c.name).join(','));
    }
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────
const started = new Date().toISOString();
deterministic();
if (!OFFLINE) await live();
let spent = 0;
if (!OFFLINE) {
  const { data } = await supabaseAdmin.from('janet_actions').select('output_summary').eq('tool_name', 'janet_turn').gte('created_at', started);
  spent = (data ?? []).reduce((s: number, r: any) => s + (Number(/\$([\d.]+)/.exec(r.output_summary ?? '')?.[1]) || 0), 0);
}
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail && (!r.ok || r.detail.startsWith('SKIPPED')) ? `  — ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed${OFFLINE ? ' (offline)' : ` · live spend $${spent.toFixed(2)}`}`);
process.exit(failed.length ? 1 : 0);
