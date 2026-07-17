# JANET — System Architecture (Ground Truth)

**Audience:** a senior architect who has never seen the code.
**Stance:** accuracy over polish. This documents what *actually* exists as of 2026‑07‑16 — including what is half‑built, inconsistent, accreted, or fragile. It is not an idealized design. Every claim below was read out of the source; representative `file:line` anchors are given so findings can be checked.

Section 7 (Known Gaps, Fragilities & Accretion) is the one that matters most for a review and is deliberately blunt.

---

## 1. System Overview

**What JANET is.** JANET is an internal AI "operator" for BLVSTACK (a one‑person web/agency business). She lives *inside* the BLVSTACK web app as a founder‑only admin surface: a chat panel plus a set of admin pages (deals, clients, sites, docs, notepad, scorecard, "mind", activity). She reads the business's live state, drafts work (emails, proposals, questionnaires, follow‑ups), and — behind an approval gate — takes external actions (send email, publish a page, book a venue). She also runs an accountability ledger on her own advice and a re‑engagement engine for one client (PSRx).

**Stack.**
- **App:** Astro 5 (SSR, `output: server`), React islands for interactive UI, Tailwind v4. Runs on **Vercel** (`@astrojs/vercel`). Server routes use `import.meta.env`; `maxDuration` caps (300s on the chat route) are the hard wall‑clock ceiling.
- **Primary DB:** BLVSTACK's own **Supabase** (Postgres), reached server‑side with the **service‑role** key via `supabaseAdmin` (`src/lib/supabase.ts`) — bypasses RLS.
- **Model:** Anthropic (`@anthropic-ai/sdk`). Default loop model `claude-sonnet-4-6` (`config.ts`); a separate legacy Sonnet id `claude-sonnet-4-5-20250929` runs the non‑JANET admin/public chat (`anthropic.ts`).
- **Email:** Resend — **three separate accounts** (see below). Inbound web forms use Cloudflare Turnstile; cold domains use Cloudflare Email Routing.

**Deployment topology / where data lives.**
- **BLVSTACK Supabase** holds *everything JANET owns*: conversation, memory, audit, deals/clients/sites, docs/pages, the judgment ledger, PSRx *orchestration* tables (schedule/ledger/suppression), outbound and booker tables.
- **PSRx has its OWN, separate Supabase project** (`ref brauzztexqtihmwqrrcj`, a live patient‑adjacent system). JANET reaches it through a **dedicated read‑only Postgres role** (`janet_readonly`) over the **Supavisor transaction pooler** (port 6543, `prepare:false`) using the **porsager `postgres` driver** — *not* supabase‑js, *not* the service key. Credentials come from `PSRX_DATABASE_URL` (env, not hardcoded). If unset, all PSRx features degrade silently to "not connected."
- So JANET straddles **two databases in one process**: `supabaseAdmin` (BLVSTACK) and `psrxSql()` (PSRx). This split — plan/learning in BLVSTACK, the one write artifact in PSRx — is a recurring theme.

**Deploy mechanics (operational reality).** `supabase db push` is unreliable on this project; DDL is applied out‑of‑band via the Supabase **Management API**, and a standalone `NOTIFY pgrst, 'reload schema'` migration exists as a schema‑cache workaround. Vercel env changes require a redeploy to take effect.

---

## 2. Data Model

Two databases. All tables below are in **BLVSTACK's Supabase** unless in the PSRx section. RLS convention is inconsistent **in source** across three build eras: **base site tables** get RLS + a service‑role policy; **booker tables** get RLS on / no policy; the **outbound + `janet_*` families** have no RLS *in their migrations*. **However, the live DB has RLS enabled on every table** (verified: `pg_tables.rowsecurity = true` across the board; anon reads return 0 rows on populated tables) — it was enabled out‑of‑band. So the exposure the source implies does **not** exist live; the gap is that source doesn't encode the live RLS (a rebuild would regress). See §7‑A.

### (a) Core JANET — conversation, memory, audit
| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `janet_messages` | The one continuous chat, message‑by‑message | `role`, `content` JSONB, `page_context` JSONB, `thread_id`, `archived_at` | **OPEN** |
| `janet_memory` | What she's learned / been told (survives new chats) | `category`, `content`, `source`, `active` | **OPEN** |
| `janet_actions` | Append‑only audit of every tool call + per‑turn cost rows | `tool_name`, `ring`, `input` JSONB, `output_summary`, `approved_by_user`, `status`, `cost` | **OPEN** |
| `janet_pending_approvals` | Persisted Ring‑3 proposals (survive session loss) | `proposals` JSONB, `status`, `thread_id` | **OPEN** |
| `janet_threads` | Client‑scoped conversation threads | `title`, `client_id`, `status`, `last_message_at` | **OPEN** |
| `janet_briefings` | Daily briefings | `briefing_date` UNIQUE, `content` JSONB, `read_at` | **OPEN** |

### (b) Deals / clients / sites
| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `janet_clients` | Account hub | `contact_email/phone`, `status`, **`approver_*` (built for routing never wired)** | OPEN |
| `janet_sites` | Portfolio of connected sites | `production_url`, `retainer_status/monthly`, `client_id` | OPEN |
| `janet_site_scans` | Health/QA scan history | `site_id`, `scan_type`, `results` JSONB, `score` | OPEN |
| `janet_deals` | Pipeline | `stage` (text enum, no CHECK), `value_estimate`, `client_id`, `site_id`, `outcome/outcome_reason/outcome_at` | OPEN |
| `janet_outcomes` | Per‑artifact verdicts | `action_id`, `deal_id`, `artifact_type`, `outcome` | OPEN |

### (c) Docs / published pages / views / forms
| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `janet_docs` | Block‑based doc workspace | `content` JSONB, `client_id`, `deal_id`, `recommendation_id`, `thread_id`, `doc_type` | OPEN |
| `janet_doc_versions` | Snapshot before every AI edit | `doc_id` (CASCADE), `content` JSONB, `created_by` | OPEN |
| `janet_doc_templates` | Reusable templates | `name`, `doc_type`, `content` JSONB | OPEN |
| `janet_published_pages` | A doc live at `/[slug]` | `slug` UNIQUE, `published`, `indexable` (noindex default), `template` | OPEN |
| `janet_page_views` | Per‑view analytics **(visitor PII)** | `duration_seconds`, `section_engagement` JSONB, `referrer`, `user_agent`, **`ip`**, `viewer_type`, `recipient_link_id`, `token`, `session_id` | **Locked 2026‑07‑16** (was OPEN with PII) |
| `janet_page_recipient_links` | Per‑recipient tokened share links | `token` UNIQUE, `lead_id`, `client_id` | **Locked** |
| `janet_form_responses` | Questionnaire submissions **(PII)** | `answers` JSONB, `respondent_name/email`, `page_id/doc_id/client_id` | **Locked** |

### (d) Judgment / ledger
| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `janet_recommendations` | Accountability ledger (advice + outcome) | `category`, **`subject_type`/`subject_id` (untyped polymorphic, no FK)**, `subject_label` (denormalized), `confidence`, `outcome`, `outcome_value`, `blue_verdict` | OPEN |
| `janet_graveyard` | Killed ideas + why | `idea`, `why_killed`, `revisit_conditions`, `active` | OPEN |
| `janet_reasoning_patterns` | Model of how Blue thinks | `pattern`, `confidence`, `times_confirmed/contradicted` | OPEN |
| `janet_predictions` | Predictions of Blue's calls, scored | `pattern_id` → patterns, `subject_type/id` (untyped), `outcome`, `actual` | OPEN |

### (e) PSRx orchestration — BLVSTACK‑side (her planning tables; distinct from PSRx's own DB)
| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `janet_psrx_followups` | Re‑engagement scheduler + learning log **(lead PII)** | `lead_id/lead_email/lead_name` (**no FK — points at a different DB**), `timeline_bucket`, `review_on`, `status`, `outcome`, `opened/clicked/manager_action` | **OPEN** |
| `janet_psrx_suppression` | Do‑not‑contact **(email PII)** | `lead_id`, `email`, `reason` (no FK) | **OPEN** |
| `janet_client_briefs` | Stored weekly retainer briefs | `client_key` ('psrx', bare text), `week_of`, `content` JSONB, `cost_usd` | OPEN |

### (f) Notepad (discovery calls)
`janet_notepad_sessions` (deal‑linked capture; gained `coverage`, then `blocks` across separate migrations), `janet_question_bank` (seeded, editable; gained `topic` later). Both OPEN.

### (g) Outbound / prospects (`sql/outbound-tables.sql`)
`prospects` **(contact PII, `ai_research` JSONB, `status` 11‑value CHECK; `niche`, `disqualified` added later)**, `outbound_emails` (sent log, still uses `gmail_message_id` columns for Resend ids), `suppression_list` (email UNIQUE), `outbound_settings` (K/V). **All OPEN (no RLS).**

### (h) Booker (`sql/booker-schema.sql`) — **all RLS‑on/no‑policy (locked)**
`booker_artists` (roster; `intake_token`), `booker_sources`, `booker_venues` (`ai_research` blob), `booker_gigs`, `booker_matches` (status machine), `booker_outreach`, `booker_payments` (manual MRR), `booker_settings`, `booker_staff` (bcrypt, `role` CHECK owner/manager/agent, unused `permissions` JSONB), `booker_staff_assignments`.

### (i) Base site tables (`supabase-schema.sql`) — the one place RLS was done right
`leads` **(PII + `ip_address`; RLS + service‑role policy)**, `contact_messages` **(PII; RLS + policy; gained `draft_*`/`replied_*`/`resend_message_id`)**, `agent_conversations` (homepage AI chat, RLS + policy).

### (j) Sent‑mail log
`janet_sent_emails` **(PII; RLS‑locked)** — one record per outbound send *post‑approval*: `type`, `to_email`, `body`, `from_email`, `actor`, `source` (chat/manual/batch/cron), `status` (delivery), `resend_id`, `deleted_at`, context FKs (`client/deal/lead/message_id`). Built this session; `_v2` migration added delete/source/status/from/actor a day later.

### PSRx **remote** tables JANET reads (in PSRx's Supabase, via `psrxSql()`)
`assessment_leads` (the lead/assessment), `lead_messages` (comms + Brevo open/click/bounce/unsub stamps), `tattoo_analyses`, `portal_members` ($29/mo), `system_health_checks`, `uptime_checks`, `meta_campaigns`, and — the one write target — **`janet_lead_drafts`** (PSRx‑side approval queue, INSERT‑only from JANET). Note: a `reviews` table is referenced in code but **does not exist** in the live PSRx DB; analyzer/portal data is largely test rows (reads honestly self‑report "insufficient").

---

## 3. The Brain Loop (how a turn actually executes)

Entry: `POST /api/janet/chat` → `runJanetTurn` (`brain.ts:89`). The doc‑aware chat (`/api/janet/docs/[id]/chat`) funnels through the **same** `runJanetTurn`.

**Transport.** The route authorizes on `locals.adminEmail` (founder‑only), opens an SSE `ReadableStream`, and creates an `AbortController` whose `signal` is threaded into the turn; the stream's `cancel()` aborts it (this is the Stop control). `maxDuration=300s`.

**Prompt composition (`buildJanetSystemPrompt`, rebuilt fresh every message).** Fixed order:
1. **IDENTITY** (large static block): role, **RULE ZERO** (report only real tool results; tense discipline), **APPROVAL GATE**, the three‑ring authority model, the full capability map, operating rules, judgment rules, tone.
2. **BUSINESS SNAPSHOT** (live) — see below.
3. **MEMORY** — all `active=true` `janet_memory` rows, grouped by category.
4. **YOUR MODEL OF BLUE** — reasoning patterns (top 40 by confidence) + graveyard (newest 40 active).
5. **CURRENT THREAD CONTEXT** (only if the thread is client‑scoped).
6. **WHERE BLUE IS RIGHT NOW** — page path + open record summary.

Tool definitions and conversation history are passed *separately* (not in the system prompt). **There is no prompt‑cache breakpoint set** — the large static IDENTITY block is re‑sent uncached on every iteration and every turn, even though `usdCostOf` can account for cache tokens.

**The business snapshot (`buildBusinessSnapshot`).** Fires **12 reads in one `Promise.all`** (new leads, unreplied messages, active deals, sites, recent scans, prospect status counts up to 1000 rows, replied prospects, unread briefing, active notepad sessions, pending approvals, open recommendations, and the PSRx digest), then two more awaited reads (published‑page engagement, form‑response summary). Freshness:
- The snapshot itself is **not cached** — all reads re‑run every message, and the prompt *advertises* this to the model as a guarantee ("rebuilt fresh on every message and always reflects current state").
- **Exception:** published‑proposal engagement has a **120s process‑global in‑memory TTL cache**. It can be up to 2 minutes stale yet is presented under the same "live as of this message" banner.
- The PSRx digest is one giant scalar‑subquery statement (the transaction pooler deadlocks on concurrent queries) and **degrades silently to omitted** on any failure; a failed digest is indistinguishable from "PSRx has nothing to report."
- Any snapshot error collapses the whole block to a single "unavailable — use Ring 1 tools" sentence.

**Memory & judgment injection.** Both are point‑in‑time prose: `janet_memory`/patterns/graveyard rows are injected verbatim as written, with **no timestamps shown to the model**. A memory written last week ("portal has 40 members") is injected today as fact even if the live snapshot shows 45 — and nothing tells the model the memory block may be staler than the snapshot.

**The tool‑call loop.** `for iteration < MAX_TOOL_ITERATIONS(15)`:
- checks the abort signal, streams a model turn (`max_tokens: 8192`), accumulates cost.
- `stop_reason` handling: `pause_turn` (server‑side web_search/web_fetch) → resume; `tool_use` → dispatch (below); `end_turn`/`max_tokens` → run the fabrication check then finish.
- **Ring dispatch:** Ring‑3 tool_use blocks are **not executed** — pushed to `proposals`. Ring‑1/2 execute inline (`executeJanetTool`, no approval flag) and feed results back. If any Ring‑3 proposal exists, the turn **persists a `janet_pending_approvals` row, emits a `plan` event with an `approval_id`, and ends** — awaiting Blue.
- **History rebuild is text‑only.** `loadHistory` pulls the newest 30 messages *for this thread*, **drops every `role='tool'` row and all `tool_use`/`tool_result` blocks**, replaying only prose. Rationale: token cost + avoiding orphaned‑tool‑block API 400s. Consequence: across turns JANET has **no structured memory of what tools she called or what they returned** — only her prose about them. This is intentional (it forces re‑reads), and it dovetails with RULE ZERO, but it means her own prior numbers are, to her, ungrounded prose she's told never to trust.

**Model tiering.** Three env‑overridable constants: `JANET_MODEL` (`claude-sonnet-4-6`, the whole loop), `JANET_MODEL_HEAVY` (`claude-opus-4-8` — set in prod and `.env.local`; falls back to the loop model if unset), `JANET_MODEL_MAX` (defaults to HEAVY, **referenced nowhere**). HEAVY is used only by `draft_proposal` and the weekly PSRx brief, and both now resolve it through **`heavyModel()`**, which returns the id **and warns loudly** if HEAVY has collapsed to the base loop model (Finding F fix, 2026‑07‑17) — so an unset/typo'd escalation can no longer be silent. Pricing is Opus‑correct via family‑prefix match, so the cost breaker is never fooled.

**Cost governance.** `JANET_MAX_TASK_COST` (default $0.50/turn). `turnCost` accumulates every main‑loop response's usage plus nested escalated spend reported via `ctx.onCost`. The breaker (`turnCost >= limit`) is checked **only between model calls**, so one `max_tokens: 8192` response can overshoot before the next check. **`draft_email`'s nested API call is not instrumented — that spend is invisible to the breaker.** The weekly brief runs on a cron outside `runJanetTurn`, so its spend is unbounded by this breaker.

**Streaming events:** `text_delta`, `tool_start`, `tool_done`, `plan`, `audit`, `error`, `done` (every exit path ends with `done`).

---

## 4. Tool Inventory

Every tool is a `JanetTool` object carrying a hardcoded `ring: 1|2|3`. **~59 Ring 1, ~45 Ring 2, 11 Ring 3.** The registry (`registry.ts`) aggregates them from 11 files and `executeJanetTool` is the sole enforcement point. Ring contract: **1** = read (logged only on failure); **2** = reversible internal write, always logged, no per‑action approval; **3** = external/irreversible, draft → propose → Blue approves → execute.

**Ring 1 (read, ~59):** deals/sites/prospects/clients/leads/messages/briefings/notepad/recommendations/scorecard/graveyard/patterns/predictions reads; the full `get_psrx_*` + `analyze_psrx_*` read/aggregation family; `booker_get_*`; `list_threads`, `get_docs`/`get_doc`, `search_threads_and_docs`, `get_page_views`, `get_recipient_links`, `get_form_responses`.

**Ring 2 (internal act, always logged, ~45):** `create/update_deal`, `add/update/deactivate_memory`, **`delete_memory` (hard delete — irreversible, contradicts the ring's "reversible" contract)**, `create/update_site`, `create/update_client`, `draft_email`/`draft_proposal`/`draft_lead_reply`/`draft_message_reply`/`compose_prospect_email` (all draft, no send), the judgment writers (`log_recommendation`, `record_outcome`, `add_to_graveyard`, `record_reasoning_pattern`, `reinforce_pattern`, `log_prediction`, `score_prediction`), the PSRx write‑lane tools (`run_psrx_nurture_sweep`, `queue_psrx_lead_now`, `add_psrx_suppression`, `generate_psrx_brief`), the audit/scrape tools (`run_url_audit`, `run_site_scan`, `run_repo_audit`, `research_prospect`, `find_prospects`, `scrape_prospects`, `booker_find/scrape/research/run_match/draft`), `create_thread`, `create_doc`, `update_doc`, `unpublish_page`, `create_recipient_link`. **Note:** many "Ring 2 = internal" tools make outbound network calls (Places, Yelp, GitHub, OSV, npm, arbitrary sites) — they contact no *person's inbox*, which is the real Ring‑2/3 line, but the "nothing leaves the building" framing is inaccurate.

**Ring 3 (external/irreversible, gated, 11):** `send_email`, `send_lead_reply`, `send_message_reply`, `send_outbound_batch`, `process_outbound_followups`, `booker_pitch_venue`, `booker_send_to_artist`, `booker_send_intake`, `booker_mark_booked` (creates a payment record), `file_records` (writes bundled records on approval), `publish_page`. They live in **four** files (`ring3.ts`, `booker.ts`, `docs.ts`, `publish.ts`).

**How the Ring‑3 gate actually enforces (defense in depth):**
1. **Registry backstop (`executeJanetTool`):** `if (tool.ring === 3 && opts.approvedByUser !== true)` → logs a `rejected` row and returns an error **before the handler runs**. Keys on `=== true`, so it fails closed.
2. **Brain proposes, never executes:** a Ring‑3 `tool_use` is intercepted (`ringOf===3`), pushed to proposals, and the turn ends with a persisted approval + `plan` event. Even if a Ring‑3 tool reached the inline path, the registry check (no `approvedByUser`) refuses it.
3. **Approval endpoint is the only executor:** `POST /api/janet/approve` (founder‑session‑gated) is **the only call site in the codebase that passes `approvedByUser:true`**. It's idempotent on `approval_id` (a resolved row is never re‑run), logs reject/approve, and stamps `resolved_by`.
4. `file_records`' nested actions re‑enter `executeJanetTool` *without* an approval flag; because they're schema‑restricted to Ring‑2 actions each re‑checks its own ring — so a Ring‑3 send cannot be smuggled through one approval (it would be refused). The safety is the ring gate, not a server‑side whitelist.

---

## 5. Reliability Mechanisms Currently In Place

**Ring gate (code‑enforced).** As in §4 — the single approval endpoint + the registry's `=== true` check are real, in code, and fail closed. This is the strongest guarantee in the system.

**Anti‑fabrication — a code backstop bolted onto prose that failed 3×.**
- *Prose layer:* RULE ZERO ("report only real tool results this turn; never fabricate a URL/id/status; future tense until the result is back") plus an approval‑gate rule. This is the primary guard for most claims.
- *Structural layer (added this session, `brain.ts`):* after a terminal turn, `detectFabrication(finalText, toolsUsed)` regex‑scans the final text for first‑person completion claims of a **mutating** action and checks whether a satisfying tool actually ran. First offense → one forced correction iteration; repeat → a visible `⚠️ System correction` appended and persisted, so the turn can never *end* on an uncorrected fabrication.
- **Known limits (important):** it covers **only doc‑write and publish** verbs — fabricated claims about *emails sent, leads replied, bookings confirmed, records filed, memories saved* are **not** structurally caught (prose only). Detection is regex on English phrasing (paraphrases slip). And `toolsUsed` records that a tool was *invoked*, not that it *succeeded* — so "I updated the doc" after a **failed** `update_doc` still clears the check. It narrows the hole; it does not close it.

**Approval persistence.** Ring‑3 proposals are persisted to `janet_pending_approvals` with their thread, so an approval survives a closed panel or dropped session and re‑renders on reopen.

**Stop control.** An `AbortSignal` threaded through the turn + the Anthropic stream lets Blue halt mid‑turn; it takes effect at iteration boundaries or during an active stream (not during a synchronous tool execution) and stops further model calls (stops spend).

**Cost breaker.** Per‑turn USD ceiling (§3) — real but has the between‑calls‑only and uncounted‑`draft_email` gaps.

**Net:** what's enforced *in code* — the ring gate, approval persistence, the abort, the cost breaker, and the (partial) structural fabrication check. What's enforced *in prose only* — RULE ZERO for non‑doc/publish actions, "check the graveyard before recommending," id‑verbatim discipline, guardrail intent beyond the PSRx `checkGuardrails` function.

---

## 6. Integrations

**PSRx (read‑mostly, one write lane).** Connection via `psrxSql()` (porsager driver, read‑only role, pooler). JANET **reads** assessment leads, the comms thread (with Brevo engagement stamps), analyzer rows, portal members, ops health, and campaigns, and runs `analyze_psrx_*` market/retention/revenue aggregations. The **one write lane** is a single `pending` row inserted into PSRx's `janet_lead_drafts` (the approval queue) — from three nurture call sites, always parameterized, always preceded by `checkGuardrails`. **JANET never sends and never marks a draft sent.** The pending→sent transition is owned by an authenticated **PSRx clinic staffer** (server‑side `admin`/`canApprove` check) who approves through PSRx's own gated send path — Blue is *not* the approver here. The **schedule/ledger/suppression** live in BLVSTACK (`janet_psrx_followups`, `janet_recommendations`, `janet_psrx_suppression`); the draft artifact lives in PSRx. `checkGuardrails` (converted/archived, suppression, never‑emailed, bounced/unsub, portal member, pending draft, 3‑follow‑up cap, 14‑day cooldown) is re‑run at both plan and surface time and is non‑bypassable; only the *review date* is bypassable on‑demand (`queue_psrx_lead_now`). Nurture drafting runs on **Sonnet**; only the weekly brief targets HEAVY (now `claude-opus-4-8`, live in prod — see §7‑F). The **Brevo webhook** (PSRx‑side) stamps `lead_messages` open/click/bounce/unsub columns — the raw signal JANET's candidate selection and outcome reconciliation read.

**BLVBooker.** A booking‑agency arm: roster artists, scraped gigs/venues, Claude‑scored matches, drafted pitches, gated sends. Two builds (gigs‑to‑artist, venue‑pitch‑to‑venue). Has its own **RBAC** (owner/manager/agent; founder auto‑promoted to owner; agents money‑stripped) enforced in middleware on the `/admin/booker` UI. **JANET's booker tools use `supabaseAdmin` directly and bypass that RBAC entirely** (fine for a solo owner; the money‑stripping guarantee is UI‑layer only). Ring‑3 booker tools send/`mark_booked` (money). Sends go from `tryblvstack.com` via a **third Resend account** with a lossy fallback chain.

**Outbound (SunResponse).** Cold B2B outreach, productized around the **solar** niche (the only `status:'live'` niche config). Pipeline: scrape → research (niche‑aware, auto‑classified) → compose (anchors on `research.pain_points`; a niche prompt distinguishes `forbiddenClaims` (factual lies) from `bannedPhrases` (clichés) and enforces number‑consistency) → queue (approved) → send → 3‑step follow‑up cadence → reply/bounce handling. Sends from `tryblvstack.com` (outbound Resend account). Driven by a 6‑hour cron running both send + follow‑ups, plus Ring‑3 tools. **Guardrails are prompt‑only — no post‑generation validator confirms a draft obeyed `forbiddenClaims`.**

**Published pages + view tracking.** `publishPage` puts a doc live at `blvstack.com/[slug]` (noindex default, reserved‑slug refused), auto‑creating one tokened link for the doc's client. The page renders through an on‑brand template with a hand‑rolled, escape‑first markdown→HTML sanitizer, and a client script tracks per‑section visible time. **Session‑level attribution (built this session):** owner (admin‑cookie) views excluded from all reporting; a first‑party `blv_sid` cookie groups repeat opens into sessions; `?v=<token>` links attribute to a named recipient; `getPageStats` reports session‑level, owner‑excluded, recipient‑attributed engagement with **explicit honest‑confidence framing** ("evidence tag — NOT proof of identity"). Delivery status for all send lanes flows into `janet_sent_emails` via a Svix‑verified Resend webhook (multi‑account: each account's secret must be in the comma‑separated `RESEND_WEBHOOK_SECRET`).

**Docs / forms.** A block model (`DocBlock`: heading/text/bullet/checklist/code/**field**). A doc is a fillable form iff it has any `field` block. JANET drafts fields in markdown (`?` short, `??` long, `?*` radio, `?+` checkbox, trailing ` *` = required). A published form renders inputs + a honeypot + optional Turnstile, and posts to `/api/p/submit` (rate‑limit → honeypot → Turnstile‑if‑configured → slug‑must‑be‑a‑published‑form) → `janet_form_responses` (RLS‑locked) + a best‑effort founder notification email.

---

## 7. Known Gaps, Fragilities & Accretion  *(the section that matters)*

Ordered roughly by severity.

**A. The RLS "gap" — a source/state discrepancy, NOT a live exposure (verified 2026‑07‑16).** This finding was originally inferred from the **migration source**, which never emits `enable row level security` for the `janet_*` family or the `sql/outbound-tables.sql` tables. An empirical check against the **live** DB contradicts the source: `pg_tables` reports `rowsecurity = true` on **every** public table (none disabled), and a read with the **public anon key** returns **0 rows** on populated, sensitive tables while the service role sees the data (janet_messages 396→0, janet_psrx_followups 68→0, prospects 84→0, janet_clients 5→0, janet_deals 1→0). So RLS was enabled out‑of‑band (dashboard/Management API) and **anon is fully blocked today — there is no live exposure.** The real, remaining gap is **source ≠ live state**: the migrations do not encode the RLS that is live, so a clean rebuild from source would ship these tables *open*. Remediation is therefore not a live patch but **hygiene** — add an idempotent migration that `enable row level security` on every `janet_*`/outbound table so source matches reality and a rebuild can't regress. (Historical note: `janet_page_views` did ship open with visitor IPs before being locked days later, so the *pattern* of locking late is real — but the current live state is locked across the board.)

**B. Two webhooks, inconsistent security — one is effectively unauthenticated.** `/api/webhooks/resend` (delivery status) does full Svix HMAC verification. But `/api/webhooks/resend-outbound` (bounce/complaint → suppression) **only checks that a `svix-signature` header is present** ("basic check for now"). Any unauthenticated POST of `email.bounced`/`email.complained` can suppress a prospect and add addresses to the suppression list.

**C. `processBounce` mass‑updates the whole outbound email log.** In the outbound engine, one bounce webhook runs `outbound_emails.update({status:'bounced'}).eq('status','sent')` with **no per‑prospect/email filter** — flipping *every* `sent` row to `bounced`. (The prospect row update beside it is correctly filtered; the log update is not. Booker's equivalent is correctly scoped by address.)

**D. View‑ingest is unauthenticated and forgeable.** `/api/p/view` accepts arbitrary `duration`/`sections` for any published `page_id` (guessable/readable from HTML). Counts and section time can be inflated; owner‑exclusion rests entirely on the admin cookie being present. Tokened links attribute the *forwardee's* views to the original recipient (the code is honest about this, but "unique_recipients" is only as trustworthy as link handling).

**E. The anti‑fabrication backstop is narrow.** Structural detection covers only doc/publish verbs and only regex phrasing, and a *failed* mutating tool still clears the check (§5). For everything else — sends, replies, bookings, filings — the only guard is the same prose rule that has already failed repeatedly. This is a known, deliberate partial fix, not a solution.

**F. "Opus escalation" — fixed; and, like A, prod was never actually broken (verified 2026‑07‑17).** The finding was inferred from the source default (`JANET_MODEL_HEAVY = env.JANET_MODEL_HEAVY || JANET_MODEL`), which *reads* as "no‑op unless configured." Checking the deployed env told a different story: **Vercel production already had `JANET_MODEL_HEAVY = claude-opus-4-8` (set 3 days prior)** — so `draft_proposal` and the weekly PSRx brief were **already escalating to Opus in production.** The real gaps were (i) **local dev**, where the env was unset so escalation silently fell back to Sonnet, and (ii) **no fail‑loud guard**, so a future unset/typo would again be silent. Both are now closed: `JANET_MODEL_HEAVY` is set in `.env.local` **and** confirmed present in Vercel production, and a new `heavyModel()` resolver (`config.ts`) — which both escalation sites now call — emits a **visible `console.warn`** whenever HEAVY collapses to the base loop model, so "Opus escalation is on" can never be silently false again. Verified end‑to‑end: the Opus id `claude-opus-4-8` is API‑valid (a live ping returns 200 with `model: claude-opus-4-8`); `heavyModel()` returns it (no warning) when the env is set and falls back + warns when unset. *(`JANET_MODEL_MAX` is still referenced nowhere — genuinely unused, unchanged by this fix.)* Pricing was already Opus‑correct via family‑prefix match, so the cost breaker was never fooled.

**G. The "read‑only" PSRx role isn't strictly read‑only, and the grant that makes it work isn't in the repo.** `client.ts` asserts the role "cannot write," but nurture INSERTs into `janet_lead_drafts` over the same connection. The committed grant file (`sql/psrx-janet-readonly-role.sql`) does **not** grant that INSERT — so the one write privilege the engine depends on was applied out‑of‑band and is invisible to source. A clean re‑apply of the committed SQL would silently break drafting. The real boundary (SELECT‑all + INSERT‑only‑on‑one‑table) can't be audited from the repo.

**H. Cross‑database "FKs" are loose columns.** `janet_psrx_followups.lead_id`, `janet_psrx_suppression.lead_id/email`, and `janet_sent_emails` PSRx context point at PSRx's `assessment_leads` in a *different Supabase project* — no FK, no enforcement, silent drift/orphaning. `janet_client_briefs.client_key` is bare text `'psrx'`. And `janet_recommendations`/`janet_predictions` use untyped `subject_type/subject_id` pairs with no FK — integrity is entirely code‑enforced, and `subject_label` exists purely to dodge the join those untyped refs make impossible.

**I. The pooler is a latent concurrency trap.** PSRx reads go through the Supavisor transaction pooler, which **deadlocks on pipelined/`Promise.all` queries** — so the digest is one giant scalar‑subquery statement and the brief gathers intel sequentially. Anyone "optimizing" with parallel queries will hang it. The porsager driver's **timestamptz‑as‑`Date`** behavior (a bare `.slice()` throws — it once broke every draft with prior messages) is handled inline in the known spots but unguarded for any new code that slices a timestamp.

**J. Sending is fragmented across three Resend accounts.** `blvstack.com` (chat/transactional, full‑access), `tryblvstack.com` (outbound + booker, reputation‑isolated), and a booker fallback chain whose last resort can't send from the booker domain. Delivery‑status reconciliation requires *every* account's webhook secret in one comma‑separated env var. Chat‑send delivery status was only just wired (this required a full‑access key on the second account). Booker `source` is hardcoded `'cron'` in the sent log even when triggered from the UI or an approval, so provenance is mislabeled.

**K. Triplicated implementations (DRY violations that will drift).** Sent‑mail logging exists **three times** (`janet_sent_emails`, `outbound_emails`, `booker_outreach` — three schemas, three status enums). Suppression exists **three times**. Outcome/accountability is spread across `janet_outcomes`, `janet_recommendations.outcome`, and `janet_psrx_followups.outcome`. The scorecard hit‑rate formula is hand‑rolled in **three** places (tool, admin page, heartbeat). A change to any of these must be made in every copy.

**L. Accretion / vestigial.** Heavy ad‑hoc `ALTER` history (notepad gained columns across three migrations; `janet_sent_emails` needed a `_v2` the next day; `janet_actions` reuses the audit table for cost rows with a nullable ring). Dead fields: `janet_clients.approver_*` (routing never built), `booker_staff.permissions` (unused), legacy `gmail_*` columns holding Resend ids. K/V settings tables (`outbound_settings`, `booker_settings`) invite typo'd keys (no enum). Most status/category columns are free `text` with no CHECK — the enum lives only in a comment. Booker's inbound‑reply/bounce handlers (`processInboundReply`/`processBounce`) appear **defined but not wired to any webhook route** — booker inbound automation looks inert.

**M. Approval‑endpoint sharp edges.** `POST /api/janet/approve` executes whatever `{tool,input}` pairs are in the body with `approvedByUser:true` — so the security reduces to the admin session on that one endpoint (by design; the approver may edit the draft). If the body carries a *non‑empty* `proposals` array alongside a valid `approval_id`, the **body** proposals run (not the displayed/stored ones) while the pending row still resolves as "approved" — the plan card is not guaranteed to be what executes. Idempotency exists only when `approval_id` is present; a raw‑proposals POST has no dedup. And Ring‑1/2 side effects from a mixed message commit *before* a later Ring‑3 rejection and are not rolled back.

**N. Doc round‑trip is lossy.** `markdownToBlocks`/`docToMarkdown` collapse heading levels (`#` and `##` both → level 1), so editing a doc through markdown re‑parse mutates its structure. Form submit does no server‑side field validation (`required` is browser‑only; duplicate field labels collide in the answers JSONB); and form answers (PII) are stored RLS‑locked *and* emailed in full to the founder inbox.

**What I'd refactor first, in order:** (1) ~~enable RLS~~ *(done live; encode it in source so a rebuild can't regress — A)*; (2) verify the outbound webhook signature and scope `processBounce` — **both fixed 2026‑07‑16** (B, C); (3) a single server‑side sender‑whitelist + one sent‑mail/suppression schema (J, K); (4) broaden the structural fabrication check to sends/filings and key it on tool *success* (E); (5) ~~make model escalation fail‑loud~~ *(done 2026‑07‑17 — `heavyModel()` warns; HEAVY set to `claude-opus-4-8` in prod + dev — F).*

---

## 8. The Judgment / Ledger Layer

Six moving parts over four tables. **All four tables have a live writer and a live reader — nothing is fully dead — but the "self‑improving loop" is two small *code‑level* loops plus a large amount of *prompt‑level* (LLM‑driven, not enforced) behavior.**

- **Recommendations — real, end‑to‑end.** Created via `log_recommendation` (Ring 2) and by two automated writers (the weekly PSRx brief logs each opportunity; nurture logs each triage decision), plus the Ring‑3 `file_records` path. Stored flat. **Surfaced mechanically:** the 50 oldest *open* recs are injected into the system prompt every turn ("chase these ≥3d"), read by `get_recommendations`, and rendered on the scorecard.
- **Outcomes — real, but only on the recommendation row.** Set by `record_outcome` (Ring 2) or by Blue's scorecard UI (writes the table directly). **There is no code that gives a *deal* an outcome from this layer, and nothing auto‑closes a recommendation when its linked deal dies.** `subject_id` is stored but never joined back; `record_outcome` never reads `janet_deals.stage`. The prompt tells her to *infer* an outcome and *propose* it — inference is entirely LLM‑driven.
- **Graveyard — write is real; the "check before recommending" is prompt‑level, not enforced.** Killed ideas are injected into the prompt every turn (the 40 newest active), so they're in front of her. But **nothing in code compares a pending recommendation against the graveyard or blocks a re‑suggestion** — the guard lives only in prompt instructions.
- **Reasoning patterns ("how Blue thinks") — the most genuinely wired sub‑system.** Written/reinforced with real confidence math (confirm → `c+(1-c)*0.2`, contradict → `c*0.6`), injected every turn (top 40 by confidence with ✓/✗ tallies), and editable from the "mind" UI.
- **Predictions — a real closed loop, but not injected.** `log_prediction` → `score_prediction` **automatically moves the linked pattern's confidence** (the same math). This is the only path that mechanically edits the injected judgment model. But predictions have **no UI writer, no cron, no auto‑scoring** (pure model discipline — empty if the tools go uncalled) and are **never injected into the system prompt** (only patterns + graveyard are), so mid‑conversation she is blind to her own open predictions unless she calls the read tool.
- **Scorecard — real, computed three times** (tool, admin page, heartbeat digest) from `janet_recommendations`: hit rate `(worked + partial*0.5)/(worked+failed+partial)`, per‑category, confidence calibration, dollars attributed. Never stored; recomputed on read.

**Honest bottom line on the loop:** there are two genuine code loops — (1) recommendation → outcome → scorecard → open‑recs injection next turn, and (2) prediction → score → pattern confidence → judgment injection. **They are not connected by code.** For a bad recommendation to actually change "how Blue thinks," the *model* must read the scorecard and choose to call `record_reasoning_pattern`/`add_to_graveyard`. So the accurate description is: **fully wired storage + injection + reporting, with the "learns from its own track record" claim resting on model discipline, not enforced code.** Cold‑start, the graveyard/patterns/predictions are empty until the tools are exercised.

---

*Generated 2026‑07‑16 from a direct source audit of `blvstack` (and the `psrx-nextjs` Brevo webhook + approval route). File:line anchors throughout can be spot‑checked. Where behavior depends on unversioned config (the PSRx role grant, `RESEND_*`/`JANET_MODEL_HEAVY` env), that is called out explicitly rather than assumed.*
