// JANET v1 — the brain (spec §5.1)
//
// Standard tool-use loop: user message → model → tool calls → results → model
// → ... → final text. Streams text deltas and tool activity to the caller via
// an emit callback; the chat endpoint wraps those as SSE events.
//
// Every client tool call goes through executeJanetTool (ring enforcement +
// audit logging). web_search / web_fetch run server-side on Anthropic's infra.
//
// Persistence: every API-level message is stored in janet_messages with full
// content blocks so the UI can render tool activity in the thread. When
// REBUILDING history for the model, only text content is replayed — tool_use /
// tool_result pairs from past turns are deliberately dropped. This keeps
// history token-cheap and immune to orphaned-tool-block API errors; within a
// single live turn the loop holds the full blocks in memory.

import { anthropic } from '../anthropic';
import { supabaseAdmin } from '../supabase';
import { JANET_CHAT_MODEL, JANET_CHAT_EFFORT, JANET_CHAT_MAX_TOKENS, MAX_TOOL_ITERATIONS, HISTORY_LIMIT, JANET_MAX_TASK_COST, usdCostOf } from './config';
import { logTurnCost, logJanetAction } from './actions';
import { buildJanetSystemPrompt, type SystemBlock } from './prompt';
import { collectUuids, extractKnownEntities, formatKnownEntities, indexEntities, vetToolIds, explainToolError, type KnownEntity } from './id-integrity';
import { extractActionLog, formatActionLog } from './action-log';
import { resolveThreadId, getThreadClientContext, touchThread } from './threads';
import { executeJanetTool, toAnthropicTools, ringOf, getJanetTool, describeProposal, AUDIT_TOOLS } from './tools/registry';
import { toolClaimClasses, parseCitations, citationGaps, CITATION_GAP_MESSAGE, detectFabrication, stripObsTags, makeObsTagStripper, type FabKind } from './consequential';
import { recordObservation } from './observations';
import { checkEntailment, type TurnObservation } from './entailment';
import { batchTaints, escalatesUnderTaint } from './taint';
import type { JanetContext, PageContext } from './types';

export type JanetProposal = { tool: string; input: any; summary: string };

// Reads that surface CONTENT the model would otherwise have to invent (doc bodies,
// page engagement, form answers). If one of these FAILS, the failure is made
// explicit in the tool result so she can't narrate contents she never received.
const CONTENT_READS = new Set(['get_doc', 'get_docs', 'get_page_views', 'get_form_responses', 'get_recent_actions']);

export type JanetStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_done'; name: string; ok: boolean; summary: string }
  | { type: 'plan'; proposals: JanetProposal[]; approval_id?: string | null } // Ring 3 actions awaiting Blue's approval (spec §4.4)
  | { type: 'audit'; tool: string; result: any } // structured audit result → rich card (spec §7)
  | { type: 'error'; message: string }
  | { type: 'done' };

type ApiMessage = { role: 'user' | 'assistant'; content: any };

async function persistMessage(
  role: 'user' | 'assistant' | 'tool',
  content: unknown,
  pageContext?: PageContext | null,
  threadId?: string | null
): Promise<void> {
  const { error } = await supabaseAdmin.from('janet_messages').insert({
    role,
    content,
    page_context: pageContext ?? null,
    thread_id: threadId ?? null,
  });
  if (error) console.error('[janet] message persist failed:', error.message);
}

/** Strip [obs:obs_N] provenance tags from text blocks before persisting — internal
 *  provenance never belongs in stored history or the rendered thread. */
function stripObsFromContent(content: any): any {
  if (typeof content === 'string') return stripObsTags(content);
  if (Array.isArray(content)) {
    return content.map((b) =>
      b?.type === 'text' && typeof b.text === 'string' ? { ...b, text: stripObsTags(b.text) } : b
    );
  }
  return content;
}

/** Extract plain text from stored content blocks (string or block array). */
function textOf(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/**
 * Rebuild text-only conversation history for the model (see header note), plus
 * what that drops: the ids her past tool results showed her (id-integrity.ts).
 * knownIds = every UUID she was SHOWN — tool results and Blue's messages. Her own
 * past prose is deliberately excluded: an id she once wrote isn't proof it's real.
 */
async function loadHistory(threadId: string): Promise<{ messages: ApiMessage[]; knownIds: Set<string>; entities: KnownEntity[]; actionLog: string[] }> {
  const { data, error } = await supabaseAdmin
    .from('janet_messages')
    .select('role, content, created_at')
    .eq('thread_id', threadId) // this thread only (Feature 1 — threads replace archive)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error || !data) return { messages: [], knownIds: new Set(), entities: [], actionLog: [] };

  const rows = data.reverse(); // oldest first
  const messages: ApiMessage[] = [];
  const knownIds = new Set<string>();
  for (const row of rows) {
    if (row.role === 'tool' || row.role === 'user') collectUuids(row.content, knownIds);
    if (row.role === 'tool') continue;
    const text = textOf(row.content);
    if (!text) continue;
    messages.push({ role: row.role as 'user' | 'assistant', content: text });
  }
  // History must start with a user turn.
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
  return { messages, knownIds, entities: extractKnownEntities(rows), actionLog: extractActionLog(rows) };
}

// Refusal fallback (Opus 5.5 migration: ship it from day one). A safety-classifier
// decline — bio / cyber / reasoning_extraction, false positives included — is re-run
// server-side on the model Anthropic recommends for that category, inside the same
// call, instead of Blue getting an empty reply. If the API ever rejects the opt-in
// (e.g. a retired beta), drop it for the life of the process: the opt-in must never
// be the thing that takes her down.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
let fallbackOptIn = true;

/** One streamed model call: text deltas go to Blue (provenance tags stripped). */
async function streamModelCall(req: Record<string, unknown>, signal: AbortSignal | undefined, emit: (ev: JanetStreamEvent) => void): Promise<any> {
  const run = async (withFallback: boolean) => {
    const stream = withFallback
      ? (anthropic.beta.messages as any).stream({ ...req, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal })
      : (anthropic.messages as any).stream(req, { signal });
    // A tag can straddle token deltas, so the stripper buffers a possible partial;
    // the trust layer still reads the tags from the raw response.content.
    const stripper = makeObsTagStripper();
    stream.on('text', (delta: string) => {
      const safe = stripper.push(delta);
      if (safe) emit({ type: 'text_delta', text: safe });
    });
    const response = await stream.finalMessage();
    const tail = stripper.flush();
    if (tail) emit({ type: 'text_delta', text: tail });
    return response;
  };
  if (!fallbackOptIn) return run(false);
  try {
    return await run(true);
  } catch (err: any) {
    if (err?.status === 400 && /fallback/i.test(String(err?.message ?? ''))) {
      console.warn('[janet] server-side fallback opt-in rejected — continuing without it:', err.message);
      fallbackOptIn = false;
      return run(false);
    }
    throw err;
  }
}

/**
 * Split a response at the LAST server-side fallback boundary. Whatever the declined
 * model emitted before it is not the answer: its tool calls must never run (only
 * `effective` feeds execution and the final-text checks). The echo kept for the next
 * request follows the API rule — before the boundary keep only text and PAIRED
 * server-tool blocks; the fallback marker itself is dropped.
 */
export function splitAtFallback(content: any[]): { echo: any[]; effective: any[] } {
  let last = -1;
  content.forEach((b, i) => { if (b?.type === 'fallback') last = i; });
  if (last < 0) return { echo: content, effective: content };
  const before = content.slice(0, last);
  const answered = new Set(before.filter((b) => /_tool_result$/.test(b?.type ?? '') && b.tool_use_id).map((b) => b.tool_use_id));
  const kept = before.filter(
    (b) => b?.type === 'text' || (b?.type === 'server_tool_use' && answered.has(b.id)) || (/_tool_result$/.test(b?.type ?? '') && b.tool_use_id)
  );
  const effective = content.slice(last + 1);
  return { echo: [...kept, ...effective], effective };
}

/**
 * EVAL SANDBOX (scripts/eval-janet.ts). A regression run drives her real loop on the
 * real model against the live DB, so it must be side-effect free: every write and
 * every Ring 3 proposal is RECORDED here instead of executed, and nothing reaches the
 * production ledgers (failure log, observations, pending approvals). Reads run for
 * real — that's what makes the eval honest.
 */
export type JanetSandbox = { writes: Array<{ tool: string; input: unknown; ring: number }> };
const isWrite = (name: string) => {
  const t = getJanetTool(name);
  return !!t && t.ring >= 2 && (t as any).mutates !== false;
};

/** Append text to the per-turn (last) system block — keeps block 1's cache warm. */
function withTail(system: SystemBlock[], tail: string): SystemBlock[] {
  if (!tail) return system;
  return system.map((b, i) => (i === system.length - 1 ? { ...b, text: b.text + tail } : b));
}

export async function runJanetTurn(opts: {
  message: string;
  pageContext?: PageContext | null;
  threadId?: string | null;
  emit: (ev: JanetStreamEvent) => void;
  signal?: AbortSignal; // Blue can halt the turn mid-flight (Stop control).
  sandbox?: JanetSandbox; // eval runs only — writes recorded, never executed
}): Promise<void> {
  const { message, pageContext, emit, signal, sandbox } = opts;
  const threadId = await resolveThreadId(opts.threadId);
  const ctx: JanetContext = { pageContext };
  // Thread-scoped persist — every message in this turn belongs to this thread.
  const persist = (role: 'user' | 'assistant' | 'tool', content: unknown, pc: PageContext | null = null) =>
    persistMessage(role, content, pc, threadId);

  await persist('user', [{ type: 'text', text: message }], pageContext);
  void touchThread(threadId);

  // A client-attached thread loads that client's context (she knows where she is).
  const clientContext = await getThreadClientContext(threadId);
  const [baseSystem, loaded] = await Promise.all([
    buildJanetSystemPrompt(pageContext, clientContext),
    loadHistory(threadId),
  ]);
  const history = loaded.messages;
  // Continuity: history replay drops past tool calls, so re-surface what she already
  // DID (action-log.ts) and the real ids those results showed her (id-integrity.ts);
  // track every id she has actually been shown so a guessed one is refused.
  const system = withTail(baseSystem, formatActionLog(loaded.actionLog) + formatKnownEntities(loaded.entities));
  const knownIds = collectUuids(system, collectUuids(pageContext, collectUuids(message, loaded.knownIds)));
  const kinds = new Map<string, KnownEntity>(loaded.entities.map((e) => [e.id, e])); // what each shown id IS
  // Phase 3.1 — taint tracking. Ambient leads/messages in the snapshot do NOT taint
  // (fenced as «untrusted:…» instead). The turn becomes tainted only when FRESH
  // untrusted content actually enters context via a tool call this turn (a web-facing
  // tool or an inbound message/lead/form body read — see batchTaints). While tainted,
  // durable-state writes she'll re-read as trusted context escalate to approval (3.2).
  let tainted = false;

  // History already includes the just-persisted user message (loadHistory runs
  // after the insert) — guard against double-appending it.
  const last = history[history.length - 1];
  const messages: ApiMessage[] =
    last && last.role === 'user' && textOf(last.content) === message
      ? history
      : [...history, { role: 'user', content: message }];

  const tools = [
    ...toAnthropicTools(),
    { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
  ] as any[];

  // Structural anti-fabrication (code-enforced, not prose). Every tool actually
  // invoked this turn is recorded here; her final claims are checked against it.
  const toolsUsed = new Set<string>();
  const toolsSucceeded = new Set<string>(); // E-fix: only tools that returned ok — a failed call never clears a claim
  let enforcedIntegrity = false;
  // Provenance (2.5/2.7/2.8): consequential tool results observed THIS turn — their
  // classes ground grounding-reads, their payloads feed the entailment gate.
  const observationsThisTurn: TurnObservation[] = [];
  let obsSeq = 0; // turn-local observation counter → obs_1, obs_2, … (what she cites)

  // Cost governance (spec Task 1): accumulate estimated spend across the loop
  // and stop gracefully before it runs away.
  let turnCost = 0;
  const overBudget = () => turnCost >= JANET_MAX_TASK_COST;
  const costSummary = () => `$${turnCost.toFixed(4)} this turn${sandbox ? ' (eval)' : ''}`;
  // Escalated nested calls (e.g. Opus proposal drafting) report their spend here
  // so the per-turn budget breaker stays accurate (v2 spec 1.7).
  ctx.onCost = (usd: number) => {
    turnCost += usd;
  };
  const costStop = async () => {
    const note = `\n\n[I hit the cost limit on this task at $${turnCost.toFixed(2)} — here's where I got to. Ask me to continue if you want me to keep going.]`;
    emit({ type: 'text_delta', text: note });
    await persist('assistant', [{ type: 'text', text: note }]);
    await logTurnCost(turnCost, `cost-limit stop at ${costSummary()}`);
    emit({ type: 'done' });
  };
  // Blue pressed Stop (or the client disconnected). Halt cleanly, leave a marker
  // in history, and — critically — stop calling the model so we stop spending.
  const stopHalt = async () => {
    await persist('assistant', [{ type: 'text', text: '[Stopped by Blue.]' }]);
    await logTurnCost(turnCost, `${costSummary()} (stopped by Blue)`);
    emit({ type: 'done' });
  };

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      if (signal?.aborted) return stopHalt();
      // Opus 5.5 always thinks — `effort` is the dial, and thinking spends from
      // max_tokens (sized for thinking + reply). Thinking blocks ride along in
      // response.content and are passed back unchanged within the turn; history
      // replay across turns is text-only, so no stale thinking is ever re-sent.
      const response = await streamModelCall(
        {
          model: JANET_CHAT_MODEL,
          max_tokens: JANET_CHAT_MAX_TOKENS,
          thinking: { type: 'adaptive' },
          output_config: { effort: JANET_CHAT_EFFORT },
          system,
          tools,
          messages,
        },
        signal,
        emit
      );
      // Priced for the model that actually served it (a fallback may have).
      turnCost += usdCostOf(response.usage as any, response.model || JANET_CHAT_MODEL);

      // The whole chain declined (classifier refusal, fallback included). Say so
      // plainly — an empty reply reads as her being broken.
      if (response.stop_reason === 'refusal') {
        const cat = response.stop_details?.category;
        const note = `\n\n[I can't take that one — the model's safety filter declined the request${cat ? ` (${cat})` : ''} and no fallback model picked it up. Try rephrasing it.]`;
        emit({ type: 'text_delta', text: note });
        await persist('assistant', [{ type: 'text', text: note }]);
        await logTurnCost(turnCost, `${costSummary()} (refused${cat ? `: ${cat}` : ''})`);
        emit({ type: 'done' });
        return;
      }
      const { echo, effective } = splitAtFallback(response.content as any[]);
      // Persist history with tags stripped (they're internal); keep raw in-loop
      // context so the citation check below reads the model's actual citations.
      await persist('assistant', stripObsFromContent(echo));
      messages.push({ role: 'assistant', content: echo });

      // Server-side tool loop paused (web_search etc.) — re-send to resume.
      if (response.stop_reason === 'pause_turn') {
        if (overBudget()) return costStop();
        continue;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUses = effective.filter((b: any) => b.type === 'tool_use'); // never a declined attempt's calls
        if (toolUses.length === 0) continue; // server-tool-only turn; resume

        // Split by ring: Ring 3 tool calls are PROPOSED (never executed here);
        // Ring 1/2 execute inline and feed results back to continue the loop.
        const proposals: JanetProposal[] = [];
        const toolResults: any[] = [];
        // 3.1 — if any tool in THIS batch pulls untrusted web content, the turn is
        // tainted BEFORE we decide whether to escalate durable writes in the same batch.
        if (batchTaints((toolUses as any[]).map((b) => b.name))) tainted = true;
        for (const tu of toolUses as any[]) {
          toolsUsed.add(tu.name); // record every tool she actually invoked this turn
          // Id integrity — refuse a call (or a Ring 3 proposal) built on an id she was
          // never shown, with guidance she can act on, before anything runs.
          const idProblem = vetToolIds(tu.input, knownIds, kinds);
          if (idProblem) {
            emit({ type: 'tool_start', name: tu.name });
            emit({ type: 'tool_done', name: tu.name, ok: false, summary: 'refused — id not verified' });
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: idProblem, is_error: true });
            if (!sandbox) void logJanetAction({ tool_name: tu.name, ring: ringOf(tu.name) || 1, input: tu.input, status: 'failed', output_summary: `Blocked by id check: ${idProblem.slice(0, 400)}` });
            continue;
          }
          // Eval sandbox: record a direct (Ring 2) write exactly as she made it, execute
          // nothing, and let her continue as if it went through. Ring 3 / taint-escalated
          // calls fall through to the proposal path, which ends the turn exactly as in
          // production (recorded there, no approval card persisted).
          if (sandbox && isWrite(tu.name) && ringOf(tu.name) !== 3 && !escalatesUnderTaint(tu.name, tainted)) {
            sandbox.writes.push({ tool: tu.name, input: tu.input, ring: ringOf(tu.name) || 2 });
            emit({ type: 'tool_start', name: tu.name });
            emit({ type: 'tool_done', name: tu.name, ok: true, summary: '[sandbox] recorded, not executed' });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify({ sandbox: true, recorded: true, note: 'Evaluation sandbox — this write was recorded, not executed. Continue as if it succeeded; do not retry it.' }),
            });
            continue;
          }
          // 3.2 — under taint, a durable-state write is escalated to an approval proposal
          // (its static ring is 2, but injected instructions must not silently persist).
          const escalated = escalatesUnderTaint(tu.name, tainted);
          if (ringOf(tu.name) === 3 || escalated) {
            const base = describeProposal(tu.name, tu.input);
            const summary = escalated
              ? `⚠ Approval required — untrusted content is in context this turn, so this durable write is gated (prompt-injection guard): ${base}`
              : base;
            proposals.push({ tool: tu.name, input: tu.input, summary });
            continue;
          }
          emit({ type: 'tool_start', name: tu.name });
          const result = await executeJanetTool(tu.name, tu.input, ctx);
          if (result.ok) {
            collectUuids(result.result, knownIds); // ids she's now been shown
            indexEntities(result.result, tu.name, kinds); // …and what each one is
          }
          const errText = result.ok ? '' : explainToolError(result.error);
          const classes = toolClaimClasses(tu.name);
          const isGroundingOrContent = classes.length > 0 || CONTENT_READS.has(tu.name);
          let obsId: string | null = null;
          if (result.ok) {
            toolsSucceeded.add(tu.name); // E-fix: a claim binds to a SUCCESS, not a call
            // Provenance (2.5 / citation flip): a consequential or content read becomes
            // a CITABLE observation with a turn-local id the model must cite; also
            // persisted server-side so its citation survives history compaction.
            if (isGroundingOrContent) {
              obsId = `obs_${++obsSeq}`;
              observationsThisTurn.push({ id: obsId, toolName: tu.name, classes, payload: result.result });
              if (!sandbox) void recordObservation({ threadId, toolCallId: tu.id, toolName: tu.name, source: 'tool', claimClasses: classes, payload: result.result });
            }
          }
          const summary = result.ok ? summarizeForUi(result.result) : errText;
          emit({ type: 'tool_done', name: tu.name, ok: result.ok, summary });
          if (result.ok && AUDIT_TOOLS.has(tu.name)) {
            emit({ type: 'audit', tool: tu.name, result: result.result });
          }
          // Success → hand back the result, and for citable reads STAMP the observation
          // id the model must cite. Failure of a grounding/content read → say so
          // explicitly so she can't narrate contents she never received.
          let content: string;
          if (result.ok) {
            content = obsId
              ? `${JSON.stringify(result.result)}\n\n[observation_id: ${obsId} — when you state any fact from this read (a status, count, name, date, id, or amount), cite it as [obs:${obsId}]. An uncited consequential fact will be blocked.]`
              : JSON.stringify(result.result);
          } else if (isGroundingOrContent) {
            content = `${errText}\n\n[SYSTEM: this read FAILED — you received NO data from it this turn, and there is NO observation to cite. Do NOT state its contents, section names, counts, numbers, dates, IDs, or status as fact. Report that the read failed and offer to retry.]`;
          } else {
            content = errText;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content,
            ...(result.ok ? {} : { is_error: true }),
          });
        }

        // Any Ring 3 proposal ends the turn: present the plan card and wait for
        // Blue. /api/janet/approve executes on approval. (Ring 1/2 tools in the
        // same message already ran; their results just aren't fed back this
        // turn — history replay is text-only, so no dangling-tool-block issue.)
        if (proposals.length > 0 && sandbox) {
          // Sandbox: record the proposals; persist no approval card. End the turn as
          // the real path does.
          for (const p of proposals) sandbox.writes.push({ tool: p.tool, input: p.input, ring: 3 });
          emit({ type: 'plan', proposals, approval_id: null });
          await logTurnCost(turnCost, costSummary());
          emit({ type: 'done' });
          return;
        }
        if (proposals.length > 0) {
          // Persist the pending approval so it survives the session — Blue can
          // come back later and still approve/reject (v2 spec 1.1).
          let approvalId: string | null = null;
          try {
            const { data } = await supabaseAdmin
              .from('janet_pending_approvals')
              .insert({ proposals, summary: proposals.map((p) => p.summary).join('; '), page_context: ctx.pageContext ?? null, thread_id: threadId })
              .select('id')
              .single();
            approvalId = data?.id ?? null;
          } catch (e) {
            console.error('[janet] pending approval persist failed:', (e as Error).message);
          }
          emit({ type: 'plan', proposals, approval_id: approvalId });
          await persist('assistant', [
            { type: 'text', text: `[Awaiting approval: ${proposals.map((p) => p.summary).join('; ')}]` },
          ]);
          await logTurnCost(turnCost, costSummary());
          emit({ type: 'done' });
          return;
        }

        await persist('tool', toolResults);
        messages.push({ role: 'user', content: toolResults });
        if (overBudget()) return costStop(); // stop before the next model call
        continue;
      }

      // end_turn / max_tokens / anything else — turn is over.
      // CONSEQUENTIAL-CLAIM INTEGRITY CHECK (RULE ZERO, enforced in code). Three
      // layers over her final text, all reusing one correction/disclaimer path:
      //   1. structural fabrication — "I did X" (doc/publish/send) with no such tool
      //      run this turn (proven E-fix).
      //   2. CITATION FLIP (2.5/2.7) — a consequential claim (published/viewed/lead-real/
      //      recovered/delivered) that does NOT cite [obs:obs_N] resolving to a this-turn
      //      observation of that class. Uncited = inference by construction = blocked.
      //   3. entailment (2.8) — a cited consequential claim NOT actually supported by the
      //      observation it points at (right tool, misread result). Cheap Haiku NLI.
      // Force ONE correction; if she repeats, append a visible disclaimer so Blue is
      // never shown an unqualified false claim. "unknown" is always an acceptable fix.
      const finalText = textOf(effective);
      const cited = parseCitations(finalText);
      const problems: string[] = [];
      for (const k of detectFabrication(finalText, toolsSucceeded)) problems.push(FAB_PROBLEM[k]);
      for (const g of citationGaps(finalText, observationsThisTurn, cited)) problems.push(CITATION_GAP_MESSAGE[g]);
      for (const e of await checkEntailment(finalText, observationsThisTurn, ctx.onCost)) {
        problems.push(`your reply states "${e.claim}", but the observation it cites does not support it (${e.reason})`);
      }
      if (problems.length > 0) {
        if (!enforcedIntegrity) {
          enforcedIntegrity = true;
          messages.push({ role: 'user', content: integrityCorrectionPrompt(problems) });
          if (overBudget()) return costStop();
          continue; // one chance to ground the claim, retract, or say "unknown"
        }
        const disclaimer = integrityDisclaimer(problems);
        emit({ type: 'text_delta', text: disclaimer });
        await persist('assistant', [{ type: 'text', text: disclaimer }]);
      }
      await logTurnCost(turnCost, costSummary());
      emit({ type: 'done' });
      return;
    }

    // Iteration cap hit — close out gracefully (spec §5.1).
    const capNote =
      "\n\n[Hit my per-turn tool limit — here's where I got to. Ask me to continue if you want me to keep going.]";
    emit({ type: 'text_delta', text: capNote });
    await persist('assistant', [{ type: 'text', text: capNote }]);
    await logTurnCost(turnCost, costSummary());
    emit({ type: 'done' });
  } catch (err: any) {
    // Blue pressed Stop mid-stream → the SDK aborts finalMessage(). Treat as a
    // clean halt, not an error.
    if (signal?.aborted || err?.name === 'AbortError' || err?.name === 'APIUserAbortError') {
      await logTurnCost(turnCost, `${costSummary()} (stopped by Blue)`);
      emit({ type: 'done' });
      return;
    }
    const msg = err?.message ?? 'Unknown error';
    console.error('[janet] turn failed:', err);
    await logTurnCost(turnCost, `${costSummary()} (errored)`);
    emit({ type: 'error', message: msg });
    emit({ type: 'done' });
  }
}

// Structural-fabrication problems, phrased for the unified integrity path.
const FAB_PROBLEM: Record<FabKind, string> = {
  doc: 'you state a document was created/updated, but no update_doc/create_doc ran this turn',
  publish: 'you state a page was published/is live, but no publish_page/get_page_views ran this turn',
  send: 'you state an email was sent, but a send only runs AFTER Blue approves — nothing sent this turn',
};

/** One correction covering every integrity problem (fabrication + grounding +
 *  entailment). She gets exactly one shot to ground, retract, or say "unknown". */
function integrityCorrectionPrompt(problems: string[]): string {
  return (
    `SYSTEM ENFORCEMENT — CONSEQUENTIAL-CLAIM CHECK FAILED (RULE ZERO). Your previous reply makes claim(s) the system cannot back:\n` +
    problems.map((p) => `- ${p}`).join('\n') +
    `\nRight now do exactly ONE: (1) call the correct Ring-1 read to GROUND the claim ` +
    `(get_page_views for published/views, get_lead/get_leads for a lead, get_psrx_recovered_revenue for recovered revenue) and then report ONLY what it returns, or ` +
    `(2) RETRACT — tell Blue plainly you don't have that confirmed; "I don't know / not verified yet" is a correct, expected answer. ` +
    `Do NOT repeat the unbacked claim. Do NOT invent a URL, slug, id, number, or status.`
  );
}

function integrityDisclaimer(problems: string[]): string {
  return (
    `\n\n⚠️ System correction — the following could not be verified against a real tool result this turn and should be treated as UNCONFIRMED:\n` +
    problems.map((p) => `- ${p}`).join('\n')
  );
}

function summarizeForUi(result: unknown): string {
  if (result == null) return 'ok';
  if (typeof result === 'object' && 'count' in (result as any)) {
    return `${(result as any).count} row(s)`;
  }
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
