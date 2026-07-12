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
  pageContext?: PageContext | null
): Promise<void> {
  const { error } = await supabaseAdmin.from('janet_messages').insert({
    role,
    content,
    page_context: pageContext ?? null,
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
async function loadHistory(): Promise<ApiMessage[]> {
  const { data, error } = await supabaseAdmin
    .from('janet_messages')
    .select('role, content')
    .is('archived_at', null) // active thread only — "New chat" archives the rest (spec 1.6)
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
  emit: (ev: JanetStreamEvent) => void;
}): Promise<void> {
  const { message, pageContext, emit } = opts;
  const ctx: JanetContext = { pageContext };

  await persistMessage('user', [{ type: 'text', text: message }], pageContext);

  const [system, history] = await Promise.all([
    buildJanetSystemPrompt(pageContext),
    loadHistory(),
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
    await persistMessage('assistant', [{ type: 'text', text: note }]);
    await logTurnCost(turnCost, `cost-limit stop at ${costSummary()}`);
    emit({ type: 'done' });
  };

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const stream = anthropic.messages.stream({
        model: JANET_MODEL,
        max_tokens: 8192,
        system,
        tools,
        messages: messages as any,
      });

      stream.on('text', (delta) => emit({ type: 'text_delta', text: delta }));

      const response = await stream.finalMessage();
      turnCost += usdCostOf(response.usage as any, JANET_MODEL);
      await persistMessage('assistant', response.content);
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
              .insert({ proposals, summary: proposals.map((p) => p.summary).join('; '), page_context: ctx.pageContext ?? null })
              .select('id')
              .single();
            approvalId = data?.id ?? null;
          } catch (e) {
            console.error('[janet] pending approval persist failed:', (e as Error).message);
          }
          emit({ type: 'plan', proposals, approval_id: approvalId });
          await persistMessage('assistant', [
            { type: 'text', text: `[Awaiting approval: ${proposals.map((p) => p.summary).join('; ')}]` },
          ]);
          await logTurnCost(turnCost, costSummary());
          emit({ type: 'done' });
          return;
        }

        await persistMessage('tool', toolResults);
        messages.push({ role: 'user', content: toolResults });
        if (overBudget()) return costStop(); // stop before the next model call
        continue;
      }

      // end_turn / max_tokens / anything else — turn is over.
      await logTurnCost(turnCost, costSummary());
      emit({ type: 'done' });
      return;
    }

    // Iteration cap hit — close out gracefully (spec §5.1).
    const capNote =
      "\n\n[Hit my per-turn tool limit — here's where I got to. Ask me to continue if you want me to keep going.]";
    emit({ type: 'text_delta', text: capNote });
    await persistMessage('assistant', [{ type: 'text', text: capNote }]);
    await logTurnCost(turnCost, costSummary());
    emit({ type: 'done' });
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error';
    console.error('[janet] turn failed:', err);
    await logTurnCost(turnCost, `${costSummary()} (errored)`);
    emit({ type: 'error', message: msg });
    emit({ type: 'done' });
  }
}

function summarizeForUi(result: unknown): string {
  if (result == null) return 'ok';
  if (typeof result === 'object' && 'count' in (result as any)) {
    return `${(result as any).count} row(s)`;
  }
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
