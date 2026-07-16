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
import { JANET_MODEL, MAX_TOOL_ITERATIONS, HISTORY_LIMIT, JANET_MAX_TASK_COST, usdCostOf } from './config';
import { logTurnCost } from './actions';
import { buildJanetSystemPrompt } from './prompt';
import { resolveThreadId, getThreadClientContext, touchThread } from './threads';
import { executeJanetTool, toAnthropicTools, ringOf, describeProposal, AUDIT_TOOLS } from './tools/registry';
import type { JanetContext, PageContext } from './types';

export type JanetProposal = { tool: string; input: any; summary: string };

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

/** Rebuild text-only conversation history for the model (see header note). */
async function loadHistory(threadId: string): Promise<ApiMessage[]> {
  const { data, error } = await supabaseAdmin
    .from('janet_messages')
    .select('role, content')
    .eq('thread_id', threadId) // this thread only (Feature 1 — threads replace archive)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error || !data) return [];

  const rows = data.reverse(); // oldest first
  const messages: ApiMessage[] = [];
  for (const row of rows) {
    if (row.role === 'tool') continue;
    const text = textOf(row.content);
    if (!text) continue;
    messages.push({ role: row.role as 'user' | 'assistant', content: text });
  }
  // History must start with a user turn.
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
  return messages;
}

export async function runJanetTurn(opts: {
  message: string;
  pageContext?: PageContext | null;
  threadId?: string | null;
  emit: (ev: JanetStreamEvent) => void;
  signal?: AbortSignal; // Blue can halt the turn mid-flight (Stop control).
}): Promise<void> {
  const { message, pageContext, emit, signal } = opts;
  const threadId = await resolveThreadId(opts.threadId);
  const ctx: JanetContext = { pageContext };
  // Thread-scoped persist — every message in this turn belongs to this thread.
  const persist = (role: 'user' | 'assistant' | 'tool', content: unknown, pc: PageContext | null = null) =>
    persistMessage(role, content, pc, threadId);

  await persist('user', [{ type: 'text', text: message }], pageContext);
  void touchThread(threadId);

  // A client-attached thread loads that client's context (she knows where she is).
  const clientContext = await getThreadClientContext(threadId);
  const [system, history] = await Promise.all([
    buildJanetSystemPrompt(pageContext, clientContext),
    loadHistory(threadId),
  ]);

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
  let enforcedFabrication = false;

  // Cost governance (spec Task 1): accumulate estimated spend across the loop
  // and stop gracefully before it runs away.
  let turnCost = 0;
  const overBudget = () => turnCost >= JANET_MAX_TASK_COST;
  const costSummary = () => `$${turnCost.toFixed(4)} this turn`;
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
      const stream = anthropic.messages.stream(
        {
          model: JANET_MODEL,
          max_tokens: 8192,
          system,
          tools,
          messages: messages as any,
        },
        { signal }
      );

      stream.on('text', (delta) => emit({ type: 'text_delta', text: delta }));

      const response = await stream.finalMessage();
      turnCost += usdCostOf(response.usage as any, JANET_MODEL);
      await persist('assistant', response.content);
      messages.push({ role: 'assistant', content: response.content });

      // Server-side tool loop paused (web_search etc.) — re-send to resume.
      if (response.stop_reason === 'pause_turn') {
        if (overBudget()) return costStop();
        continue;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter((b: any) => b.type === 'tool_use');
        if (toolUses.length === 0) continue; // server-tool-only turn; resume

        // Split by ring: Ring 3 tool calls are PROPOSED (never executed here);
        // Ring 1/2 execute inline and feed results back to continue the loop.
        const proposals: JanetProposal[] = [];
        const toolResults: any[] = [];
        for (const tu of toolUses as any[]) {
          toolsUsed.add(tu.name); // record every tool she actually invoked this turn
          if (ringOf(tu.name) === 3) {
            proposals.push({ tool: tu.name, input: tu.input, summary: describeProposal(tu.name, tu.input) });
            continue;
          }
          emit({ type: 'tool_start', name: tu.name });
          const result = await executeJanetTool(tu.name, tu.input, ctx);
          const summary = result.ok ? summarizeForUi(result.result) : result.error;
          emit({ type: 'tool_done', name: tu.name, ok: result.ok, summary });
          if (result.ok && AUDIT_TOOLS.has(tu.name)) {
            emit({ type: 'audit', tool: tu.name, result: result.result });
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: result.ok ? JSON.stringify(result.result) : result.error,
            ...(result.ok ? {} : { is_error: true }),
          });
        }

        // Any Ring 3 proposal ends the turn: present the plan card and wait for
        // Blue. /api/janet/approve executes on approval. (Ring 1/2 tools in the
        // same message already ran; their results just aren't fed back this
        // turn — history replay is text-only, so no dangling-tool-block issue.)
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
      // STRUCTURAL ANTI-FABRICATION: if her final message claims a mutating
      // action (doc write / publish) as DONE but no matching tool ran this turn,
      // that's a fabrication (prose rules failed to stop this 3×). Force ONE
      // correction; if she repeats it, append a visible disclaimer so Blue is
      // never shown an unqualified false claim.
      const fab = detectFabrication(textOf(response.content), toolsUsed);
      if (fab.length > 0) {
        if (!enforcedFabrication) {
          enforcedFabrication = true;
          messages.push({ role: 'user', content: fabricationCorrectionPrompt(fab) });
          if (overBudget()) return costStop();
          continue; // one chance to actually call the tool or retract
        }
        const disclaimer = fabricationDisclaimer(fab);
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

// ── Structural anti-fabrication ─────────────────────────────────────────────
// A completion claim for a mutating action is only truthful if a corresponding
// tool actually ran this turn. Reads that ground the claim also satisfy it
// (get_doc backs "the doc now has X"; get_page_views backs "it's live at …").
const DOC_SATISFY = new Set(['update_doc', 'create_doc', 'get_doc', 'get_docs']);
const PUBLISH_SATISFY = new Set(['publish_page', 'get_page_views']);

function hasAny(used: Set<string>, allowed: Set<string>): boolean {
  for (const name of allowed) if (used.has(name)) return true;
  return false;
}

/** Detect first-person COMPLETION claims of a mutating action in her final text.
 *  Deliberately conservative — only flags when nothing in the satisfying tool
 *  set ran this turn (a legitimate read/write grounds the claim and clears it). */
function detectFabrication(text: string, used: Set<string>): ('doc' | 'publish')[] {
  const t = text.toLowerCase();
  const out: ('doc' | 'publish')[] = [];

  const claimsDocDone =
    /\b(i['’]?ve|i have|i just)\s+(updated|revised|rewrote|rewritten|edited|added|saved|drafted|created|turned|built|filled)\b/.test(t) ||
    /\b(the |your |this )?(doc|document|questionnaire|form|proposal|scope|brief|protocol|campaign)\b[^.\n]{0,24}\b(is|has been|now|now has|now includes)\b[^.\n]{0,24}\b(updated|revised|created|saved|ready|live|a fillable form|fillable)\b/.test(t) ||
    /\bturned (it|this|the doc|the document)\b[^.\n]{0,30}\b(into|to)\b[^.\n]{0,30}\b(form|questionnaire)\b/.test(t);
  if (claimsDocDone && !hasAny(used, DOC_SATISFY)) out.push('doc');

  const claimsPublishDone =
    /\b(published|now live|it['’]?s live|is live at|went live|has been published|i['’]?ve published|i published)\b/.test(t);
  if (claimsPublishDone && !hasAny(used, PUBLISH_SATISFY)) out.push('publish');

  return out;
}

function fabricationCorrectionPrompt(kinds: ('doc' | 'publish')[]): string {
  const map: Record<string, string> = {
    doc: 'a document update/creation (update_doc / create_doc)',
    publish: 'a publish to a live URL (publish_page)',
  };
  const what = kinds.map((k) => map[k]).join(' and ');
  return (
    `SYSTEM ENFORCEMENT — RULE ZERO CHECK FAILED. Your previous reply states ${what} as already done, ` +
    `but no such tool call was executed in this turn. That is a fabrication. Right now do exactly ONE of these: ` +
    `(1) actually call the correct tool to perform the action, or ` +
    `(2) reply plainly to Blue that it is NOT done — you have not run that action yet. ` +
    `Do not repeat the false claim. Do not invent a URL, slug, id, or status.`
  );
}

function fabricationDisclaimer(kinds: ('doc' | 'publish')[]): string {
  const map: Record<string, string> = {
    doc: 'no document was actually created or updated',
    publish: 'nothing was actually published and no live URL exists',
  };
  const what = kinds.map((k) => map[k]).join('; ');
  return `\n\n⚠️ System correction: ${what}. That action did not run this turn — disregard the claim above.`;
}

function summarizeForUi(result: unknown): string {
  if (result == null) return 'ok';
  if (typeof result === 'object' && 'count' in (result as any)) {
    return `${(result as any).count} row(s)`;
  }
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
