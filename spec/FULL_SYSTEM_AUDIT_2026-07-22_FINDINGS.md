# FULL-SYSTEM AUDIT — COMPLETE FINDINGS REGISTER (2026-07-22)

Companion to `FULL_SYSTEM_AUDIT_2026-07-22.md`. That file is the ranked synthesis (12 headline findings + Parts 1–5). **This file is every finding from every one of the 14 area reports — 146 total** — so nothing is lost to synthesis.

**How to read this**
- **ID** — `AREA-N`, stable within this doc.
- **Class** — the area report's own tag: **BROKEN** (does the wrong thing / dead) · **MISSING** (should exist, doesn't / never-fired) · **OPPORTUNITY** (latent upside or a suggested build) · **INVENTORY** (a measured fact or confirmation; the report's 4th class — this is where "hygiene"/ground-truth items land). Every finding also carried `confirmed` or `inferred`; I mark **[inf]** on the inferred ones, all others are confirmed.
- **Evidence** — the strongest single anchor (file:line or measured table/row count). Each source finding cites more; see the area file.
- **Effort** — the report's estimate; `n/a` means inventory/verdict with no action.
- **Synth?** — **Y** = represented in the synthesis report (named or its content appears in the Top-12 or Parts 1–5); **cut** = not carried into the synthesis (kept here only).

**Counts:** 146 findings — 62 BROKEN, 44 MISSING, 16 OPPORTUNITY, 24 INVENTORY. By repo-area the biggest producers were **bypass (16)**, **automation (14)**, **data (13)**, **polling (13)**. In the synthesis: **~104 represented, ~42 cut** (the cut set is almost entirely minor INVENTORY confirmations and low-blast-radius latent items).

---

## AREA: onconflict (5) — upsert arbiter vs live index

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| OCF-1 | `createProposal` upserts `janet_dream_proposals` `onConflict:'idempotency_key'` but the only unique index on that column is PARTIAL (`WHERE ... IS NOT NULL`) → PostgREST can't use it → every proposal write throws 42P10. Dream output path dead on arrival. | proposals.ts:117; pg_indexes `janet_dream_proposals_idem_idx`; migration 20260721230000:39-40; janet_dream_proposals 0 rows | BROKEN | ~1h (drop partial, create plain unique) | **Y (#1)** |
| OCF-2 | `dream-verify.test.ts` claims to test the shipped shape but upserts `onConflict:'id'` (PK), not the shipped `'idempotency_key'` — so the broken path passed verification. | dream-verify.test.ts:91-92 vs proposals.ts:117 | MISSING | ~30min | **Y (#1)** |
| OCF-3 | 9 upsert sites never read the supabase-js error (doesn't throw); the Meta/Instagram token saves are the riskiest — a silent failed token write surfaces days later as a dead integration. | instagram.ts:53-60, meta.ts:71-78, compliance/route.ts:36-48, products.ts:78-99, + 5 blvstack fire-and-forget | MISSING | 2-4h | **Y (2.5)** |
| OCF-4 | The previously-broken `janet_conversions` upsert is now backed by a plain non-partial unique index in live PSRX — the documented partial-index incident is remediated. | conversion-attribution.ts:76; pg_indexes `janet_conversions_external_id_key` (no WHERE) | INVENTORY | n/a | **Y (2.5)** |
| OCF-5 | Every other upsert site in both repos (21 app + 8 raw-SQL) resolves to a real non-partial unique index or PK, incl. the no-onConflict app_settings/site_config sites landing on key-as-PK. | live pg_indexes both DBs; app_settings/site_config PK=(key); 8 named UNIQUE constraints | INVENTORY | n/a | **Y (2.5)** |

## AREA: judgment (10) — is the learning loop closed?

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| JUD-1 | Loop is CLOSED IN CODE, OPEN IN PRACTICE: the only edge ever carrying live data is seeded patterns/graveyard/memory → chat prompt. Nothing has ever been created/adjusted by an outcome. | dream_proposals 0, predictions 0, patterns 3× times_confirmed=0; janet_actions score_prediction/reinforce/dream_accept all 0 | BROKEN | n/a (verdict) | **Y (#3)** |
| JUD-2 | Pattern confidence has never moved: all 3 patterns times_confirmed=0/contradicted=0; every path that could move it (reinforce_pattern, score_prediction, dream revise) has 0 calls. The 0.9/0.9/0.92 shown each turn are the seeder's guesses. | judgment.ts:121-154,246-257; janet_reasoning_patterns measured | BROKEN | n/a until predictions flow | **Y (#3)** |
| JUD-3 | `janet_predictions` has 0 rows ever — `log_prediction` never called — so prediction_accuracy in the heartbeat has been null in every briefing. Prediction mechanism is prompt-exhortation only. | judgment.ts:189; janet_actions log_prediction=0; registry.ts:165-174 | BROKEN | hours (hook into approval flow) | **Y (#3)** |
| JUD-4 | No scorer exists for reconcile-staged predictions: reconcile defers confirm/contradict to "a later pass" that doesn't exist anywhere. | reconcile.ts:14-17,115-134; grep score_prediction = only judgment.ts/prompt.ts | MISSING | 0.5-1 day | **Y (#3)** |
| JUD-5 | `log_recommendation` and `record_outcome` have 0 calls ever; all 91 recs written directly by system code; the 2 "worked" outcomes came via the scorecard POST / unlogged path. Ledger fills, but not through the accountable tool. | janet_actions both 0; nurture.ts:244, brief.ts:154, approve.ts:111 | INVENTORY | n/a | **Y (2.1/2.3)** |
| JUD-6 | Dream produced 0 proposals across both runs → `executeProposalChange` (only machine-write path to patterns/graveyard/memory) never executed. | janet_dream_proposals 0; proposals.ts:149; janet_memory 0 dream-sourced | INVENTORY | n/a (starves) | **Y (#3)** |
| JUD-7 | `janet_outcomes` table (migration 20260709…) has 0 rows and ZERO src references — dead schema that misleads audits; the shipped outcome loop lives on janet_recommendations columns. | migration :18-28; grep 0 matches; count 0 | BROKEN | minutes (drop) | **Y (1.2)** |
| JUD-8 | Outcomes/scorecard alter NO decision parameter: model choice env-only, nurture/triage use static prompts, briefing narrates scorecard as text. Sole behavioral consumer of learned state is the chat system prompt. | config.ts:11-15; nurture.ts:199-201; heartbeat.ts:103,296-298 | MISSING | 1-2 days per pipeline | **Y (#3)** |
| JUD-9 | Everything in the judgment store was seeded/hand-entered: all 5 graveyard rows share one timestamp, add_to_graveyard 0 calls; no accretion since 2026-07-14. | graveyard 5× killed_at 2026-07-12T16:36:27; janet_actions add_to_graveyard=0 | INVENTORY | n/a | **Y (#3)** |
| JUD-10 | The one automated outcome-closer that works: dream_reconcile flagged 2 lead recs DUE and produced the 5 "unknown" — but only closes deal/lead-linked recs; 16 revenue_idea recs have no auto-closer. | janet_actions dream_reconcile 2026-07-22; reconcile.ts:76-190 | INVENTORY | n/a | **Y (2.3)** |

## AREA: funnel (10) — assessment → portal → member

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| FUN-1 | assessment-nurture agent — the only automated path emailing leads a /portal link — has processed 0 leads because it filters on 5 columns that don't exist; error swallowed; runs 6×/day as a no-op. | route.ts:39-41; information_schema (0/5 cols exist); 94 leads, 0 real members | BROKEN | hours (migration + error logging) | **Y (#4)** |
| FUN-2 | Completion screen offers only an external AestheticsPro booking link + "Return Home" — no portal CTA at peak intent. | SkinAssessmentForm.tsx:245-287, BOOKING_URL:6 | MISSING | 1-2h | **Y (#4)** |
| FUN-3 | Screen promises "your personalized skin profile will arrive by email" but no path emails the readout to the lead — the only email goes to staff. 94 leads promised a deliverable that never came. | SkinAssessmentForm.tsx:256; assessment/route.ts:88-92 (email → assignee.email) | BROKEN | hours (readout email template) | **Y (#4)** |
| FUN-4 | Admin portal-funnel dashboard defines the funnel as homepage→/portal→checkout→member, with the assessment nowhere in it — so the 94→0 break is structurally invisible in PSRx's own analytics. | portal-funnel/route.ts:4-9,91-95 | MISSING | hours | **Y (#4)** |
| FUN-5 | shop-abandonment agent never sent an email (0 shop_abandonment log rows) and its 7-day dedup filters on a `sent_at` column that doesn't exist. | route.ts:104-109; portal_automation_log has fired_at not sent_at; 0 rows | BROKEN | hours + PostHog wiring unknown | **Y (1.3/2.4)** |
| FUN-6 | winback agent correctly wired but never had a target: 0 cancelled members (all 3 active, owner test accounts). Downstream of the empty portal. | winback/route.ts:68-74; portal_members cancelled=0 | INVENTORY | n/a | **Y (1.3)** |
| FUN-7 | Promo popup converts 6 emails from 8,531 views (0.07%); 43% dismiss; door-clicks 64 (0.75%). ~165 missed leads ≈ $8-11k plausible treatment revenue. | popup_metrics measured: view 8531, email_submitted 6; assessment_leads referral='popup'=6 | OPPORTUNITY | days (offer/creative) | **Y (#6)** |
| FUN-8 | Every portal monetization surface downstream of membership is at 0 real usage: booking_requests 0, memberships 0, referrals 0, gift_cards 0; all activity traces to 3 owner test accounts. | measured counts; portal_login_codes 49 all owner emails | INVENTORY | n/a | **Y (1.2/3.3)** |
| FUN-9 | 84 leads carry status='contacted' while all 94 have staff_contacted=false — actual contact is 124 lead_messages + 38 sent JANET drafts; JANET's nurture, not the PSRx staff flow, owns these leads. | measured status vs flags; lead_messages 124 outbound | INVENTORY | n/a | cut |
| FUN-10 | Dollar-ranked leak order: (1) popup ~$8-11k, (2) assessment→portal ~$4.4k/yr ARR, (3) shop-abandonment $0 lifetime, (4) bookings/referrals/gift_cards blocked behind (2). | popup 8531/6; membership $29-39; converted 10/94 | OPPORTUNITY [inf] | days total | **Y (3.3)** |

## AREA: attribution (9) — recovered-revenue defensibility

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| ATT-1 | Recovered revenue as computed today = $0: 38 re-engaged, 1 "engaged", 0 recovered conversions, 0 pending bookings. The honest pipeline correctly reports zero. | recovered.ts:45-73; janet_lead_drafts 38 sent; janet_conversions recovered=0 | INVENTORY | n/a | **Y (#7)** |
| ATT-2 | The single janet_conversions row is a $40.77 correlated-only invoice with credited_draft_id=null — the code refuses to count it (no sent draft preceded). Proves the chain works; n=1 correlated ≠ evidence. | full table dump n=1; conversion-attribution.ts:56-58 | INVENTORY | n/a | **Y (#7)** |
| ATT-3 | 9 of 10 converted leads have 0 janet_conversions rows and 0 sent drafts — marked converted via manual dropdown that writes no attribution; 0 of 10 ever got a JANET touch. The skeptic's base-rate weapon. | converted_leads query; status/route.ts:15 (no recordConversion) | MISSING | 1-2h (status route writes source='staff') | **Y (#7)** |
| ATT-4 | The single 'converted' outcome in janet_psrx_followups was stamped by status-correlation with released_at/draft_id null, opened/clicked false — nurture never contacted this lead. The learning table's only non-null outcome is a correlation artifact. | followups row 6f52308b; nurture.ts:375-377 | BROKEN | 2-3h (distinct 'converted_untouched') | **Y (2.4)** |
| ATT-5 | Brevo webhook stores event times as UTC when Brevo sends account-local → 2 of 3 opens recorded BEFORE their own send. Discredits the engagement dataset on sight. | brevo/route.ts:38; 2/3 opened_at<sent_at; +5h → 6s after send | BROKEN | ~1h (+ un-backfillable) | **Y (#8)** |
| ATT-6 | engaged=1 rests on a single open ~6s after send (TZ-corrected), and columnFor() counts proxy_open as opens — almost certainly Apple-MPP prefetch, not a human. Honest engagement plausibly 0/38. | msg 923e8c51; brevo/route.ts:26; clicked=0 across all 124 | BROKEN [inf] | ~1h (segment proxy_open) | **Y (#7)** |
| ATT-7 | Scorecard's "100% hit rate" = 2 self-scored process items (nurture-executed + CVE upgrade), outcome_value null on both, 84 of 91 recs have no outcome — denominator is 2% of the ledger. | heartbeat.ts:208-214; recs 91: null=84/unknown=5/worked=2 | INVENTORY | n/a (framing) | **Y (2.4)** |
| ATT-8 | No holdout/control anywhere: release drafts every qualifying followup; strongest auto tier is bare temporal precedence. Dataset already proves the background rate is nonzero (10 untouched conversions vs 0 touched). | nurture.ts:332-356; conversion-attribution.ts:30-41; base rate 10/0 | MISSING | 3-5h (25% held-out arm) | **Y (#7)** |
| ATT-9 | Distance to a diligence-surviving claim: ≥150-300 sends/≥90d, 45-day windows closed (first 2026-08-28), TZ-correct chain, a holdout, treatment_value on every conversion. Current: 38/300 sends, 0/41 windows, 0 holdout, chain broken. | janet_lead_drafts 38/7d; followups earliest terminal 2026-08-28 | OPPORTUNITY | holdout 3-5h + TZ 1h now, rest is calendar | **Y (#7/3.4)** |

## AREA: ledger (9) — is the rec ledger a prioritization instrument?

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| LED-1 | 85% of the open ledger (69/81) is machine per-lead nurture state sharing one table + one nag channel with the 12 strategic calls — noise with a noise-suppressor (rec-hygiene regex) bolted on. | open 81, reengage 69; nurture.ts:223-246; rec-hygiene.ts:10-15 | BROKEN | 1-2h (born-resolved rec) | **Y (#10)** |
| LED-2 | Nothing ranks by value/effort: every surface orders made_at desc; outcome_value populated on 0/91. The "highest money, structural" rec ranks like a dep bump. | prompt.ts:147; heartbeat.ts:197; recommendations.ts:25; outcome_value 0/91 | MISSING | ~30min/surface | **Y (#10)** |
| LED-3 | janet_recommendations has no owner/next_action/review-date column; due-date semantics are regex-scraped from prose. janet_deals already has the right vocabulary. | migration 20260712…:6-24; rec-hygiene.ts:13; deals next_action/due (prompt.ts:104) | MISSING | ~half day | **Y (#10)** |
| LED-4 | Strategic recs age forever: reconcile sweep 1 covers only deal-subject, sweep 3 only lead-subject; all 12 open strategic rows (5 client + 7 site) are outside every auto-close path. | reconcile.ts:81,146; open_by_subject {lead:69,site:7,client:5} | BROKEN | ~1h once review_on exists | **Y (#10)** |
| LED-5 | 41 flagged rows compete for 5 display slots by recency; all 41 are the same reason — a genuinely urgent flag would queue behind them. | open_flagged 41; prompt.ts:350 (slice 0,5 over made_at-desc) | BROKEN | n/a (subsumed by LED-1) | **Y (#10)** |
| LED-6 | Accountability half is starved: 2 real outcomes in 9 days, blue_verdict never set on 91 rows, so nightly synthesize learns from 2 rows. Age, not defect. | outcome worked=2, blue_verdict null 91/91; synthesize.ts:38-44 | INVENTORY | n/a | **Y (2.3)** |
| LED-7 | Category carries no meaning under load: 6 of 12 strategic rows are CVE/env engineering tasks logged as 'revenue_idea' though 'site_fix' exists; 0 rows use site_fix/deal_action/pricing/outreach. | open_by_category {lead_triage:69,revenue_idea:11,other:1}; ring2-admin.ts:150 | INVENTORY | n/a | **Y (2.3)** |
| LED-8 | heartbeat computes "today" in UTC while prompt.ts uses Blue's local day, so a re-engage rec can be 'due' in the brief and 'scheduled' in chat for hours around midnight. | heartbeat.ts:201 vs prompt.ts:347 | BROKEN | 15min | cut* |
| LED-9 | The minimal workable-rec change: born-resolved nurture rec + 3 columns (next_action/review_on/value_estimate copied from deals) + order by (value,review_on) + client/site reconcile sweep. Empties 69/81, gives the rest a sort key + lifecycle. | nurture.ts:238-243; prompt.ts:104; reconcile.ts:143-190 | OPPORTUNITY | half day total | **Y (#10/2.3)** |

## AREA: tools (10) — tool surface & write governance

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| TOO-1 | `booker_mark_booked` (Ring 3, legacy-exempt) raw-inserts a success-fee into booker_payments + flips matches to 'booked', no idempotency key, no ledger, no reversal tool, no unique index beyond pkey. The registry's own "touches money" tool. | booker.ts:385-401; LEGACY_UNDECLARED; pg_indexes booker_payments only pkey | BROKEN | 2-4h (guardedCreate + declare) | **Y (#9)** |
| TOO-2 | `send_outbound_batch` fans one Ring-3 approval to up to daily_cap cold sends with per-message approvalRef synthesized in code; content sent is whatever prospects.draft_* holds at run time, not what Blue approved. | engine.ts:69,35-45; ring3.ts:173-182 | BROKEN | 0.5-1 day (snapshot the batch) | cut |
| TOO-3 | `file_records` executes an array of Ring-2 writes with no inner idempotency and no all-or-nothing — inner failures leave a partial file; re-approval double-writes every bare-insert record. | docs.ts:143-151; ring2.ts:88 (create_deal bare insert) | BROKEN | 0.5 day | **Y (#9)** |
| TOO-4 | Every sendVerified sender does after-send bookkeeping via raw supabaseAdmin outside the ledger tx; on the dedup path it re-inserts outbound_emails, re-appends lead notes, re-inserts booker_outreach. Transport can't double-send; books can double-record. | executor.ts:88-94; ring3.ts:237-261,110-116; booker.ts:350-359 | BROKEN | 2-3h (branch on dedup) | **Y (#9)** |
| TOO-5 | check-tool-contract.mjs is a regex over declarations; nothing verifies a declaration against handler behavior — a tool declaring mutates:false with bare inserts passes the build (empirically verified). | check-tool-contract.mjs:94-142; log_recommendation honest-but-unverified example | MISSING | 2-4h (insert-scan heuristic) | **Y (1.1)** |
| TOO-6 | `generate_psrx_brief` inserts opportunities straight into janet_recommendations (bypassing dedup) + inserts janet_client_briefs with no unique on (client_key, week_of) — re-run duplicates both + a full Opus spend. | brief.ts:154-163,167-171; pg_indexes client_briefs only pkey | BROKEN | 2h | **Y (#9)** |
| TOO-7 | All 11 Ring-3 senders route the provider call through the single sendVerified executor (refuses w/o approvalRef, idempotent on a real unique index, never reports success on error); 5 clearear creators route through guardedCreate. | executor.ts:83-152; unique index janet_action_ledger_idempotency_key_key | INVENTORY | n/a | **Y (1.1)** |
| TOO-8 | The PSRx cross-DB write lane is exactly as narrow as documented: janet_readonly's only non-SELECT grant in the client DB is INSERT on janet_lead_drafts. Strongest containment in the system. | measured role_table_grants → [{janet_lead_drafts, INSERT}]; client.ts:4-12 | INVENTORY | n/a | **Y (1.1)** |
| TOO-9 | 57 of 71 Ring-2/3 tools remain frozen-exempt; exactly one paydown since the contract shipped (log_recommendation); policy is "when next touched" → all 12 dangerous-uncontracted tools stay exempt indefinitely. | check-tool-contract.mjs:30-91; node run → "14 governed … 57 exemptions" | OPPORTUNITY | ~2-3 days for the dangerous 12 | **Y (#9/1.1)** |
| TOO-10 | The 2 hidden tools are excluded from the model's tool list but remain Ring 3, executable only via /api/janet/approve with a human click; sends still pass sendVerified. Hidden ≠ backdoor. | registry.ts:127,148-158; ring3.ts:195-202; booker.ts:314-320 | INVENTORY | n/a | **Y (1.1)** |

## AREA: bypass (16) — success-reported-without-work & double-fire

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| BYP-1 | shop-abandonment swallows send failures with .catch(console.warn) then unconditionally inserts the 'sent' log + increments fired — a failed send is permanently recorded as sent and dedup suppresses retry forever. | route.ts:143,145-151,104-111 | BROKEN | 1-2h | **Y (2.4)** |
| BYP-2 | All PSRx agent crons send FIRST, mark DB AFTER, no idempotency — a crash between, or overlapping 4h runs, re-sends. This is the double-fire class the write-executor was built to kill, on the arm that does 38/39 of real send volume. | assessment-nurture:65-74; winback:132-158; lead-followup:57-78 | BROKEN | 1-2 days (sendOnce wrapper) | **Y (#9)** |
| BYP-3 | JANET draft-approval route reads status==='pending' then sends + updates non-conditionally; /email/send has no idempotency — two concurrent approvals (or a retry) send the follow-up twice. | queue/[draftId]/route.ts:39,55-74; email/send:56-67 | BROKEN | 2-4h (CAS on status) | cut |
| BYP-4 | janet_action_ledger has 0 rows while 5 invoices/5 payments/1 email/74 followups exist — every durable row was written by ungoverned paths; the write executor + send ledger has processed zero prod writes. | ledger count 0; clearear_invoices 5 @2026-07-21; write-executor.ts:69-84 | MISSING | 1h verify deploy timeline | **Y (#3/1.2)** |
| BYP-5 | PSRx nurture release inserts janet_lead_drafts (PSRX) then janet_psrx_followups (BLVSTACK) raw, non-idempotent across two DBs — the dup class ALREADY occurred: 3 leads with 2-3 followup rows for follow_up_number=1. | nurture.ts:278-282; group-by dup: leads 1e8c1b18(3), a2a061df(3), 1932e940(2) | BROKEN | 0.5-1 day (natural key) | **Y (#9)** |
| BYP-6 | Scorecard hit-rate counts outcome='worked' with no provenance — record_outcome is Ring-2 (no approval) and the model sets both outcome AND blue_verdict; both live 'worked' rows have blue_verdict null. A model belief is load-bearing for the trust number. **→ Prerequisite for JUD-11's evidence gate (a): until a surface captures blue_verdict, that gate learns from 0/92.** | ring2-admin.ts:276,303-304; janet-scorecard.astro:31-36; recs 9a1c7923/b7ba7410 | BROKEN | 0.5 day (recorded_by + block model writes) | **Y (2.4)** |
| BYP-7 | Staff attribute-conversion inserts janet_conversions with recovered=true + staff-typed value, NO idempotency (external_id null → double-click = 2 rows), and recovered.ts sums it into the single headline the tile/CSV/tool present. | conversion-attribution.ts:75-77; attribute-conversion/route.ts:45-54; recovered.ts:70 | BROKEN | 0.5 day | **Y (2.4)** |
| BYP-8 | PSRx Brevo webhook wraps every event in `catch { /* skip */ }` returning ok:true; a failed engagement event vanishes with no log, and the reconciler then marks an engaged lead 'no_response'. | brevo/route.ts:67-68; nurture.ts:400 | BROKEN | 1-2h | **Y (2.4)** |
| BYP-9 | outbound + booker crons catch every sub-job exception and still return HTTP 200 {ok:true} — a run where both jobs threw reports success to Vercel monitoring. | outbound.ts:24-36; booker.ts:29-35; contrast heartbeat.ts:36-37 | BROKEN | 1h (return 500) | **Y (2.4)** |
| BYP-10 | Instagram job processor records cooldown + marks job 'done' even when DM and reply both failed; cooldown then suppresses retry — a fully-failed rule is indistinguishable from success. | process-instagram/route.ts:128-136,140-145,37 | BROKEN | 2-4h | **Y (2.4)** |
| BYP-11 | sendVerified's ledger intent-insert failure is swallowed (console.error, return null) and the send proceeds unledgered — and dedup checks the row that was never written, so a retry re-sends. The one governed path loses both guarantees exactly when the ledger fails. | executor.ts:70-77,105-119,88-95 | BROKEN | 1-2h (refuse to send) | **Y (2.4)** |
| BYP-12 | send_outbound_followup + booker senders: send is idempotent but post-send bookkeeping is raw, so a repeat re-inserts outbound_emails/booker_outreach + re-advances prospect cadence. (Same root as TOO-4, latent — both tables 0 rows.) | ring3.ts:226-261; engine.ts:64-94; booker/engine.ts:1061-1167 | OPPORTUNITY | 0.5 day | **Y (#9/2.4)** |
| BYP-13 | record_external_action stores human reports as system_verified=false, but janet_external_actions is never read by any surface — while its side effect (deal stage/updated_at bump) renders identically to observed activity. | ring2-admin.ts:259-266; grep 0 read sites; heartbeat.ts:240-247; count 0 | MISSING | 0.5-1 day | **Y (2.4)** |
| BYP-14 | Contract gate exempts 57 frozen tools; guardedCreate has 4 call sites against 132 raw mutation sites in src/lib/janet alone (344 supabaseAdmin.from repo-wide) — governance covers clearear + external actions, ~nothing else. | check-tool-contract.mjs:30-91; 132/344 grep | INVENTORY | n/a | **Y (1.1)** |
| BYP-15 | generateDueRecurring creates the invoice (guarded, but natural key includes issue_date=today()) then advances next_issue_date in a separate raw update — a crash between → next day generates a second invoice (different key). | recurring.ts:57-66; invoicing.ts:90-92; 5 backfilled all issue_date 2026-07-21 | OPPORTUNITY [inf] | 2-4h (key on recurring_id+period) | cut |
| BYP-16 | assessment-nurture returns ok:true HTTP 200 even when every lead errored (errors=50, processed=0); winback/shop-abandonment 'skipped' conflates 'not due' with 'send threw' — monitoring can't tell healthy-quiet from fully-broken. | assessment-nurture:145; winback:167-173 | BROKEN | 1-2h | **Y (2.4)** |

## AREA: automation (14) — cron & webhook census

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| AUT-1 | 4 PSRX portal crons export only POST while Vercel invokes GET → 405; never executed. Reminders, ALL time-based portal automations, monthly cleanup, Meta lookalike sync — the entire retention layer dead. | 4 route files POST-only; vercel.json:4-18; 49 stale OTP codes prove cleanup never ran | BROKEN | 1-2h | **Y (#5)** |
| AUT-2 | assessment-nurture queries 5 nonexistent columns → every 4-hourly run silently processes 0 leads. (=FUN-1/POL-1, cron-census view.) | route.ts:36-42; information_schema; 94 leads, 0 nurture logs | BROKEN | 2-3h | **Y (#4)** |
| AUT-3 | seo-content inserts meta_description/tags/seo_keyword (none exist) → failed every run since ~2026-03-09 (~38 missed), paying a Sonnet call before the failing insert twice weekly. | route.ts:141-146; blog_posts schema; 2 ai posts, seo_keyword_index '0' | BROKEN | 1h (drop 3 fields) | **Y (1.3)** |
| AUT-4 | replenishment + shop-abandonment dedup against portal_automation_log.sent_at, but the column is fired_at → dedup query always errors; if they ever fire, reminders repeat daily for 30 days. | replenishment:110; shop-abandonment:109; information_schema | BROKEN | 30min | **Y (1.3)** |
| AUT-5 | BLVSTACK outbound (6h) + booker (daily) send crons are scheduled + authed but produced 0 rows ever (outbound_emails/booker_outreach/suppression_list all 0) against 84 prospects/201 venues. Matches Blue's leave-idle choice. | vercel.json:4-9; measured 0/0/0 | INVENTORY | n/a | **Y (1.3)** |
| AUT-6 | Both BLVSTACK Resend webhooks never processed a delivery event: janet_sent_emails 1 row, 0 delivered; janet_action_ledger 0; suppression_list 0. The executed→verified loop unexercised end-to-end. | resend.ts:35-36; resend-outbound.ts:48-51; measured | MISSING | 1h (verify dashboard config) | **Y (1.3/1.4)** |
| AUT-7 | lead-followup can never fire: 0 of 94 leads have follow_up_due_at (its mandatory trigger); the assignment flow that should stamp it never does. | lead-followup/route.ts:35-38; measured with_due 0 | MISSING | half day | **Y (1.3)** |
| AUT-8 | Shopify orders/paid webhook never recorded an order: 0 'shopify_order' rows — either unregistered in Shopify admin or no member ordered; Meta Purchase attribution has zero history. | shopify/route.ts:96-99; portal_automation_log no shopify_order key | MISSING | 30min (check Shopify admin) | **Y (1.3/1.4)** |
| AUT-9 | Instagram webhook + pg_cron pipeline ran once (2026-03-11) then dormant 4.5 months; pg_cron installation unverifiable with read-only role. | instagram/route.ts:101; pending_jobs 2 done 2026-03-11; cron.job permission denied | INVENTORY | n/a | **Y (1.3/1.4)** |
| AUT-10 | refresh-tokens has no observable evidence yet — both tokens expire 2026-07-30, cron only refreshes within 7 days → first real window opened 2026-07-23. If not extended by ~07-30, both integrations go dark. | refresh-tokens/route.ts:22-48; app_settings expiries 2026-07-30 | OPPORTUNITY | 5min re-check after 07-25 | **Y (1.3)** |
| AUT-11 | All 6 JANET core crons on BLVSTACK are live-proven by fresh rows: heartbeat, dream submit+collect, weekly PSRx brief, daily/weekly nurture pair. The healthiest surface in either repo. | scans 18, briefings 13; dream_runs 2; client_briefs 2; followups 74/drafts 38 | INVENTORY | n/a | **Y (1.3)** |
| AUT-12 | PSRX monitoring crons live-proven: uptime (7,455 rows, 240/day) + health-check (32 daily × 5 probes since 2026-06-22). Reference implementation for cron auth done right. | uptime_checks 7455; system_health_checks 160 | INVENTORY | n/a | **Y (1.3/2.6)** |
| AUT-13 | Two BLVSTACK crons have no DB footprint: invariants (writes nothing, emails on failure) + clearear-recurring (live ~1 day, 0 overdue flips, all 5 invoices are the seed batch). Vercel dashboard is the only truth. | invariants.ts:22-41; clearear_invoices 5 @2026-07-21T08:44 | INVENTORY | n/a | **Y (1.3)** |
| AUT-14 | vercel.json schedules 11 crons not 12 — janet-scans.ts is intentionally unscheduled (heartbeat runs scans inline). Corrects the brief's count. | vercel.json:2-47; janet-scans.ts:10-13 | INVENTORY | n/a | cut (footnote) |

## AREA: data (13) — 112-table asset inventory

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| DAT-1 | popup stats endpoint computes variant metrics from ≤10,000 (PostgREST caps to ~1,000) rows of 12,309, no ORDER BY → admin A/B stats silently drop ~92% of events in arbitrary order. | popup/stats/route.ts:22-25; popup_metrics 12,309 | BROKEN | 1-2h (server-side aggregate) | **Y (#6)** |
| DAT-2 | popup_metrics has no retention job (uptime_checks has one); the single biggest table in either DB grows unbounded, compounding the stats truncation. | uptime-cleanup exists; no cron references popup_metrics; 12,309 rows | MISSING | 1h | **Y (#6)** |
| DAT-3 | The 2026-07-22 dream run is stuck 'submitted' (collected_at null) through 7 collector windows; janet_dream_proposals still 0 across both runs. Batch spend incurred, results never harvested (24h expiry). | dream_runs row 5406a69a; batch ids; vercel.json crons | BROKEN | half day (diagnose collector) | **Y (#2)** |
| DAT-4 | Phase 2.5 observation store is dead on both ends: getFreshObservations imported by nothing, janet_observations 0 rows despite recordObservation in brain.ts. The grounding-read layer is inert. | brain.ts:264; grep getFreshObservations = def only; count 0 | BROKEN | half day | **Y (1.2)** |
| DAT-5 | janet_action_ledger (3 writer sites) has 0 rows — no Ring-2/3 write has passed through the executor/idempotency path since deploy. Its runtime behavior is unproven. | executor.ts:71, verify.ts:158, write-executor.ts:51; count 0; janet_actions 380 | MISSING | 1-2h (trace one write) | **Y (#3/1.2)** |
| DAT-6 | meta_campaigns read by JANET's paid-performance intelligence but has no writer in either repo and 0 rows → that branch permanently returns "not populated yet". | intelligence.ts:111,117; reads.ts:108; 0 insert sites; count 0 | MISSING | 1-2 days (Meta ingest cron) | **Y (1.2/5)** |
| DAT-7 | 8 PSRX tables (audit_log, clients, gift_cards, memberships, gallery_items, portal_guardrail_rules, product_routes, admin_integrations) have 0 rows and 0 code refs — pure schema orphans. | grep from('<t>') = 0 for all; counts 0 | INVENTORY | n/a (drop candidates) | **Y (1.2)** |
| DAT-8 | 3 BLVSTACK tables (agent_conversations, janet_doc_templates, janet_outcomes) have 0 rows and 0 runtime refs; janet_outcomes exists only in a migration + specs. | grep 0 files; counts 0 | INVENTORY | n/a | **Y (1.2)** |
| DAT-9 | referrals (read by email personalization) + portal_consent_versions (read by portal access gate) each have readers but no writer and 0 rows → both paths always no-op. (referrals query also selects nonexistent columns.) | personalization.ts:310; access.ts:218; counts 0 | MISSING | hours each | **Y (1.2)** |
| DAT-10 | Parked booker arm sits on the 3rd-5th biggest data assets — 315 sources, 297 gigs (stale since 2026-06-02), 201 venues, 38 matches — with outreach/payments at 0. Gig data 7 weeks stale; unparking later = re-scrape. | measured counts; engine.ts:1064-1255; daily cron | OPPORTUNITY | n/a (data refresh is cost of delay) | **Y (3.3)** |
| DAT-11 | JANET's prediction tool + 4 consumer sites all exist but janet_predictions has 0 rows — she has never recorded a prediction, starving the dream reconcile step. | judgment.ts:212; reconcile.ts:118, synthesize.ts:46, heartbeat.ts:218; count 0 | MISSING | prompt-level nudge (hours) | **Y (#3/1.2)** |
| DAT-12 | The entire PSRX portal dataset flatlined 2026-05-29: portal_members(3)/checkins(0)/skin_scores(6)/assessments(4)/login_codes(49) all latest ~2026-05-28. Large surface, zero member activity since late May. | measured latest created_at across portal_* | INVENTORY | n/a | **Y (1.2)** |
| DAT-13 | assessment_leads (94) has had no new lead since 2026-07-16 (6-day gap) while popup_metrics shows live traffic through 2026-07-23 — lull or intake breakage undetermined. | max(created_at) 2026-07-16; popup latest 2026-07-23 | INVENTORY | 30min (test submission) | **Y (1.2)** |

## AREA: integrations (11)

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| INT-1 | BLVSTACK Resend delivery webhook never received an event: the only sent row (2026-07-16, resend_id set) still status='sent', never promoted; janet_action_ledger 0. Likely never registered in the Resend dashboards. | janet_sent_emails 1/status sent; resend.ts:14-19; ledger 0 | BROKEN | <1h (register + test) | **Y (1.4)** |
| INT-2 | AESTHETICSPRO_WEBHOOK_SECRET + BREVO_WEBHOOK_SECRET exist in no local env file yet both webhooks work in prod → .env.vercel.prod is a stale snapshot; a restore from it would silently kill both integrations. | grep 0 in both env files; janet_conversions + lead_messages prove prod secrets set | MISSING | <1h (env pull refresh) | **Y (1.4)** |
| INT-3 | Instagram integration dormant since 2026-03-11; app_settings token last refreshed 2026-05-21 (62 days, past Meta's 60-day expiry); refresh cron hasn't stamped a newer value; no health check covers IG. | app_settings updated_at 2026-05-21; pending_jobs 2 @03-11; instagram.ts:18-24 | BROKEN [inf] | 1-2h (re-auth + health check) | **Y (1.4)** |
| INT-4 | Klaviyo fully decommissioned (no-op stubs, lib has 0 importers) but 4 KLAVIYO_* keys remain in both env files, and portal_automation_log's klaviyo_event column now records Brevo sends. | subscribe/route.ts:3; grep 0 importers; 4 keys both files | INVENTORY | 1h (delete) or leave | **Y (1.4)** |
| INT-5 | AestheticsPro→Zapier→webhook proven live end-to-end but exactly 1 conversion (2026-07-22) against 94 leads/10 converted — 9 of 10 converted have no conversion row; recovered-revenue reports will undercount. | janet_conversions n=1; assessment_leads converted 10; route.ts:117-130 | INVENTORY | n/a (observe/backfill separately) | **Y (1.4/#7)** |
| INT-6 | Both tryblvstack.com outbound lanes fully built with active crons but 0 emails ever; warmup_complete=false, gmail_connected=false. Idle inventory awaiting deliberate go-live (Blue's choice). | outbound_emails/booker_outreach/suppression_list 0; outbound_settings | INVENTORY | n/a (deliberate) | **Y (1.4)** |
| INT-7 | Health cron covers 5 services but has no check for Recharge, Instagram, or AestheticsPro — precisely the 3 with the weakest recent evidence and silent-failure modes. | system_health_checks 5 distinct check_names; no recharge/instagram rows | MISSING | 2-3h (add 3 checks) | **Y (1.4)** |
| INT-8 | meta_campaigns has 0 rows despite a full admin Meta suite + green meta_graph health check; campaign-sync has never persisted anything; token last written 2026-03-09. | meta_campaigns 0; app_settings 2026-03-09; 16 callers | INVENTORY | n/a | **Y (1.4)** |
| INT-9 | CLOUDFLARE_API_TOKEN + ZONE_ID sit in blvstack .env.local with 0 code refs anywhere — served a one-off DMARC write, now back no code path. | grep 0 files; env has both; outbound-email.ts:4 comment | INVENTORY | n/a | **Y (1.4)** |
| INT-10 | HEALTHCHECKS_* keys exist only in psrx .env.local, absent from .env.vercel.prod, while the uptime cron using them runs in prod — either post-snapshot drift or the dead-man ping silently no-ops in prod. | 3 keys .env.local only; uptime_checks latest 2026-07-23 | MISSING [inf] | 30min (check Vercel env) | **Y (1.4)** |
| INT-11 | Stripe not integrated in either repo: no SDK, no keys, only string-enum mentions; actual billing runs inside Shopify/Recharge. Clearear payments deferred by design. | grep stripe → globals.css + enum labels only | INVENTORY | n/a | **Y (1.4)** |

## AREA: spend (9) — measured AI cost

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| SPD-1 | Only cost ledger is janet_actions.cost + janet_client_briefs.cost_usd: $25.37 total over 12 days, $7.02 last 7 days. Run-rate ~$38-40/mo, chat ~75%. | janet_actions 175 cost rows sum $22.66; client_briefs $2.71 | INVENTORY | n/a | **Y (2.7)** |
| SPD-2 | Turn-cost rows (89% of spend) store only tool_name='janet_turn' + free text — no client tag → PSRx share of chat spend is uncomputable; only 10.7% of spend is PSRx-attributable. | actions.ts:31-38; chat_turn $22.49 vs psrx-tagged $2.71 | MISSING | hours (client_key column) | **Y (#12/2.7)** |
| SPD-3 | psrx-nextjs Anthropic spend is entirely unledgered: 11 route files call messages.create, none writes cost to any table; only 2 of 3 assessment calls emit token counts to PostHog. | 11 call sites; assessment/route.ts:56,165,206 | MISSING | ~1 day (logged-client wrapper) | **Y (#12/2.7)** |
| SPD-4 | 20+ blvstack call sites outside brain/dream/brief never touch usdCostOf/logTurnCost — incl. active crons: heartbeat (3), nurture drafting+sweep, initiative, booker (6), outbound (4). Nurture is the largest active gap. | grep usdCostOf = 5 files; nurture.ts:198,461; heartbeat.ts:103,115,306 | MISSING | ~1 day (one costed client) | **Y (#12/2.7)** |
| SPD-5 | Dream collect ledgers at full Sonnet rates though it runs on the Batch API (~50% discount) → ledger overstates dream spend ~2×, and consumes the $1 nightly cap at 2× the real rate. | model.ts:140-142; 14 collect rows $0.1767 | BROKEN | <1h | **Y (#12/2.7)** |
| SPD-6 | draft_lead_reply's model call in ring2-admin.ts has no ctx.onCost, so its spend bypasses both the per-turn cost breaker and the turn's ledgered cost. | ring2.ts:273,313 (has onCost) vs ring2-admin.ts:379-384 (none) | BROKEN | <1h | cut |
| SPD-7 | The PSRx weekly brief's cost_usd is stored only in janet_client_briefs (text-only in janet_actions) → summing janet_actions.cost misses $2.71 (11%). Any total-spend query must UNION both. | brief.ts:169 vs :174-179; client_briefs sum $2.71 | INVENTORY | n/a | **Y (2.7)** |
| SPD-8 | All non-Anthropic metered services ~$0/mo at current volume: Resend 1 send ever, Brevo 92/30d (free tier), Places/PageSpeed 18 scans, PostHog trivial. | janet_sent_emails 1; lead_messages 92/30d; site_scans 18 | INVENTORY | n/a | **Y (2.7)** |
| SPD-9 | usdCostOf prices unknown model ids at Sonnet and 'fable' at a placeholder Opus rate → a JANET_MODEL swap could silently misprice the whole ledger with no error. | config.ts:54-66 (RATES, default-to-sonnet) | OPPORTUNITY | hours (fail-loud) | cut |

## AREA: product (10) — multi-client / productization

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| PRD-1 | PSRx is a hand-built special-cased arm (24 tools, own module tree, 3 crons), not an instance of a client abstraction — 0 psrx code references janet_clients; no tool takes client_id. | psrx.ts:37-313; grep janet_clients=0; vercel.json:28-36 | MISSING | n/a (this is the architecture) | **Y (3.5)** |
| PRD-2 | Client-DB connection is a module singleton keyed on one env var (PSRX_DATABASE_URL); a 2nd client DB can't connect without editing client.ts. | client.ts:28-31,73; invariants.ts:58-59 | MISSING | 2-3 days (registry) | **Y (3.5)** |
| PRD-3 | janet_psrx_followups (74) + suppression have no client_id — lead_id points into THE one PSRx DB; a 2nd client's ids would collide with no way to tell whose is whose. | measured columns; invariants.ts:99-116 (single-DB probe) | MISSING | 1-2 days | **Y (3.5)** |
| PRD-4 | Client attribution is string-typed: nurture writes subject_label 'PSRx: {name}', brief retrieves with .ilike('subject_label','PSRx%'). A rename or "PSRx Plus" silently corrupts attribution. | nurture.ts:235; brief.ts:157,221 | BROKEN | 0.5-1 day | **Y (3.5)** |
| PRD-5 | Approval queue lives in the CLIENT's DB (janet_lead_drafts) while the schedule lives in BLVSTACK's → every client must host BLVSTACK-owned tables + a janet_readonly role, and their app must ship a queue-approval UI. | janet_lead_drafts 40 (PSRX) vs followups 74 (BLV); client.ts:1-14 | INVENTORY | 3-5 days/client | **Y (3.5)** |
| PRD-6 | Nurture qualification is coupled to PSRx's exact med-spa schema (timeline/fitzpatrick/primary_concern, tattoo analyses, portal membership by name) — a 2nd med-spa only works on a byte-compatible schema. | nurture.ts:74-80; reads.ts/intelligence.ts | MISSING | 5-8 days/vertical | **Y (3.5)** |
| PRD-7 | psrx-nextjs is not white-label: 233 of 402 files (58%) contain "PSRx" (1,107 occurrences); catalog hardcoded in TS; ~25 branded email templates. Fork-and-rewrite, not config. | grep 1107/233; products.ts:1,31; PSRxEmail.tsx | INVENTORY | 8-12 days fork+rebrand | **Y (3.5)** |
| PRD-8 | A client deployment carries ~45 client-specific env credentials in psrx-nextjs while BLVSTACK has exactly ONE per-client key (PSRX_DATABASE_URL) with no scheme for a second. | ~45 keys from .env.local; client.ts:28 | INVENTORY | 2-4 days credential setup/client | **Y (3.5)** |
| PRD-9 | Approval routing is single-operator: prompt names Blue as sole principal; auth is one ADMIN pair; janet_clients has approver_* columns but no routing is built on them. | prompt.ts:19,33-35; ADMIN_EMAIL/PASSWORD; grep janet_clients in psrx=0 | MISSING | 3-5 days | **Y (3.5)** |
| PRD-10 | Realistic client #2 onboarding as things stand: ~20-30 engineer-days same-vertical; per-client licensing is aspirational — every layer assumes exactly one client. Honest path is extract-the-pattern, not parameterize-PSRx. | sum of component estimates; 62/138 tools are per-business hand builds | OPPORTUNITY [inf] | 20-30 eng-days/client | **Y (3.5)** |

## AREA: memory (7) — self-knowledge & staleness

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| MEM-1 | The CVE nag is the GENERAL SHAPE, not one bug: no mechanism reconciles client/site-subject recs (or memory) against deployed reality; reconcile sweeps cover only deal/lead. All 12 strategic recs nag until manually closed. | heartbeat.ts:193-207; rec 9a1c7923 open 13.5h after fix; reconcile.ts:82,146 | MISSING | 1-2 days (reconcile sweep 4) | **Y (2.2)** |
| MEM-2 | dream/consolidate liveDigest queries table `connected_sites` which doesn't exist (should be janet_sites); error swallowed → site reality never reaches the memory-deprecate judge. | consolidate.ts:198; measured PostgREST "table not found" | BROKEN | minutes (rename) | **Y (2.1/2.2)** |
| MEM-3 | Injected memory has zero code-level freshness enforcement (top-60 by recency, prose-only TTL) while outbound claims get code-enforced zero-TTL classes. Asymmetric: what she says is gated, what she believes is prose-gated. | prompt.ts:367-401,483; consequential.ts:22-28; janet_memory 7 rows | MISSING | hours | **Y (2.2)** |
| MEM-4 | dream consolidate — the only designed memory-vs-live reconciler — produced 0 proposals in its life (07-21 batch timed out, 07-22 still submitted ~17h later). Memory hygiene is 100% manual in practice. | dream_proposals 0; dream_runs 2; vercel.json collect windows | BROKEN | hours (diagnose collector) | **Y (#2/2.2)** |
| MEM-5 | JANET's self-knowledge is patched by hand-inserted rows: the category='system' capability memory uses a category add_memory's enum can't produce; will go stale with no deprecation path. | janet_memory e75c827c category='system'; ring2.ts:160 enum | INVENTORY | n/a (deploy-flow step ~hours) | **Y (2.2)** |
| MEM-6 | heartbeat compares rec review dates in UTC while prompt uses Blue's Chicago day → a rec flips 'due' 5-7h earlier in the brief. Latent only because the cron fires at 12:00Z. (Same class as LED-8.) | heartbeat.ts:201 vs prompt.ts:347; rec-hygiene.ts:33 | OPPORTUNITY | minutes | cut |
| MEM-7 | Cross-turn self-knowledge is text-plus-DB only: loadHistory drops all tool_use/result pairs and re-injects whatever the DB says — including 30 stale open recs per turn. Ledger staleness IS her working memory. | brain.ts:88-108; prompt.ts:143-148; 84 open recs | INVENTORY | n/a | cut |

## AREA: polling (13) — unbounded loops & fixed ceilings

| ID | Description | Evidence | Class | Effort | Synth? |
|---|---|---|---|---|---|
| POL-1 | assessment-nurture cron never processed a lead (4 nonexistent columns, error discarded, returns ok:true). Highest-blast-radius silent failure; structurally invisible. (=FUN-1/AUT-2, polling lens.) | route.ts:36-42,145; live repro "column does not exist"; 94 leads | BROKEN | hours | **Y (#4)** |
| POL-2 | All 13 blvstack `maxDuration` exports are dead code: @astrojs/vercel only honors an adapter-level option astro.config.mjs doesn't set → every heavy cron runs at an undeclared platform default nobody chose. | @astrojs/vercel dist:42,269,472; astro.config.mjs:11-14; engine.ts:342-346 | BROKEN | minutes (adapter option) | **Y (#11)** |
| POL-3 | releaseDuePsrxFollowups runs ≤50 sequential Sonnet calls + a 2-DB write pair per item, no time budget; a timeout mid-batch orphans a pending draft, and the next run's guardrail flips it to 'cancelled', permanently disconnecting it from reconciliation. | nurture.ts:332,345-350,337-341,368; 3 due today | MISSING | hours (time budget + write order) | **Y (2.6)** |
| POL-4 | A PageSpeed timeout makes a site's score silently IMPROVE (lighthouse null → 0 findings) → next good scan reads as a >4-pt drop → briefing reports a phantom regression. Also: only category=performance requested, so SEO/accessibility findings are unreachable dead code. | audit.ts:165-167,250-259; heartbeat.ts:85 | BROKEN [inf] | hours | **Y (2.6)** |
| POL-5 | Weekly sweep truncates the eligible pool to 80 and discards eligible_total → throughput silently pinned at 80/week with no signal anything was left behind. | nurture.ts:128,472,474; 94 leads (fits today) | MISSING | <1h reporting; hours w/ budget | **Y (2.6)** |
| POL-6 | 3 PSRX agents send BEFORE writing the record that prevents re-send; replenishment also fetches Shopify per-member with no timeout → a kill mid-loop re-sends real emails, a hung socket stalls the cron. | lead-followup:57-79; replenishment:119-138,42-47 | MISSING | hours | **Y (2.6)** |
| POL-7 | shop-abandonment reads one PostHog page (limit=500, cursor ignored) for both events over 48h → above 500 events the count map is wrong both ways (missed abandoners AND emails to buyers). Grows with traffic. | shop-abandonment:31,45-46,85-93 | MISSING | hours (follow next / HogQL) | **Y (2.6)** |
| POL-8 | Instagram processor marks 'processing' before working, only fetches 'pending' → a crash mid-job strands the row forever; no reaper, retry ladder never applies. Latent (2 lifetime jobs). | process-instagram/route.ts; pending_jobs all 0 except done 2 | MISSING | <1h (reclaim) | **Y (2.6)** |
| POL-9 | Morning-queue draft generators swallow a failed model call with bare `catch { continue }` → a lost overdue-invoice reminder / check-in / message reply is indistinguishable from a clean queue. The honest version exists 20 lines away. | chasing.ts:62,103; initiative.ts:~104; contrast nurture.ts:352-353 | MISSING | <1h | **Y (2.6)** |
| POL-10 | fetchAllPages in Meta insights/campaigns loops `while(nextUrl)` with no page cap and no fetch timeout → a pathological paging chain hangs the request. Admin-facing, low blast radius. | insights/route.ts:11-24; campaigns/route.ts:23 | OPPORTUNITY | <1h | **Y (2.6)** |
| POL-11 | sendTransactionalEmail fail-opens on missing BREVO_API_KEY (callers count it fired) and has no timeout/retry; every PSRX nurture/winback/replenishment/staff/uptime-alert email flows through it → a bad env silently disables all email incl. the site-down alert. | brevo.ts:114-131; uptime/route.ts:140,154 | MISSING | hours | **Y (2.6)** |
| POL-12 | reconcilePsrxFollowups caps at limit(400) with no .order() → past 400, an arbitrary 400 reconcile daily and the rest never accrue outcomes; 1-4 sequential SQL round-trips per row share the release invocation's undeclared time ceiling. | nurture.ts:368,370-404; 68 rows today | OPPORTUNITY | hours, at ~5× volume | **Y (2.6)** |
| POL-13 | Every un-.limit()'d supabase-js select in both repos is silently capped at ~1000 (PostgREST default) — the ceiling that engages first as tables grow, error-free. Already bit the popup stats page. | lead-followup:28-38, winback:68-74, replenishment:63-67; prompt.ts:118 limit(1000) | INVENTORY [inf] | n/a (awareness) | **Y (2.6)** |

---

## The ~42 findings CUT from the synthesis (kept only here)

These didn't earn a line in the ranked report — almost all are minor INVENTORY confirmations or low-blast-radius latent items. Listed so you can see exactly what was set aside, not buried:

**Genuinely omitted (not represented anywhere in the synthesis):**
FUN-9 (contacted-status vs flags), LED-8 (UTC/Chicago rec due split — but its twin MEM-6 says the same), TOO-2 (outbound-batch synthesized approval), BYP-3 (queue-approve race), BYP-15 (recurring-invoice crash window), SPD-6 (draft_lead_reply escapes breaker), SPD-9 (rate-table drift), MEM-6 (UTC/Chicago review day), MEM-7 (history text-only), AUT-14 (cron count — appears only as a report footnote).

**Everything else marked "Y"** is represented — the Top-12 items plus the ~92 findings folded into Parts 1–5 (inventory tables, the failure-class catalog in 2.4, the onconflict audit in 2.5, the polling catalog in 2.6, the spend breakdown in 2.7, and the product/differentiation analysis in Parts 3–4).

*A note on class taxonomy: the area reports use INVENTORY as the 4th class (measured facts / confirmations), where your brief said "HYGIENE." I kept the reports' own label so the mapping to source is exact — the INVENTORY rows are the ground-truth/hygiene bucket. 24 of the 146 are INVENTORY; the actionable defects are the 62 BROKEN + 44 MISSING.*

*This register modified no code, schema, or data. Every row traces to one of the 14 files under the audit scratchpad, which trace to file:line and live row counts in the session transcript.*

---

## POST-AUDIT FINDINGS (discovered during remediation — NOT in the original 146)

### JUD-11 — the dream loop closes the evidence circle on itself within a single run  · BROKEN · confirmed
*Discovered 2026-07-23 while reviewing the first collected dream proposals. The original audit caught the weak outcome DATA (ATT-4: the zero-contact "converted" artifact) but not that the learning loop generates its own evidence and generalizes from it inside one execution, with no external verification at any point.*

**The mechanism (same-run self-evidence):**
- `src/pages/api/cron/janet-dream.ts:44` calls `runReconcile()`, then `:50` calls `prepareSynthesize()` — in the **same submit pass** (one HTTP invocation of the night cron).
- `src/lib/janet/dream/reconcile.ts:167-178` stamps `outcome='worked'` on a recommendation at `ran_at` (the run's own timestamp) whenever its linked `janet_psrx_followups` row is `'converted'` — and that follow-up `'converted'` flag is itself the ATT-4 zero-contact artifact (nurture reconcile stamps it on any `lead.status='converted'`, `released_at`/`draft_id` null → never contacted).
- `src/lib/janet/dream/synthesize.ts:39-42` then selects resolved recs with `.not('outcome','is',null).neq('outcome','unknown').gte('made_at', since)` — **no exclusion of outcomes stamped in the current run, no `blue_verdict` requirement, no n floor** (it only skips when there are 0 resolved recs AND 0 predictions). The prompt says "propose nothing if unsupported," but that is a model instruction, not a code gate. The citation check (`synthesize.ts:186`) verifies the cited id EXISTS — not that the outcome was verified.

**Live proof:** rec `7b199dff` ("PSRx: Aladeyemi Osho", lead_triage) has `outcome_recorded_at = 2026-07-23 09:00:27.372+00` — 0.28s after `dream_run_at = 2026-07-23 09:00:27.093+00`. Proposals `f8ade693` (#3) and `a0ff92d0` (#5) from that same run cite it as evidence for "low-confidence lead_triage still converts." The loop wrote the evidence and generalized from it minutes later.

**Evidence-quality gate options + survival counts (measured against the live 92 recs, 2026-07-23):**
| Gate | Survivors | Read |
|---|---|---|
| (a) require `blue_verdict` set | **0 / 92** (`blue_verdict` is null on every rec) | The principled gate → learns from nothing until Blue verifies. That is the *correct* state today. |
| (b) exclude outcomes stamped in the current run | **3 / 92** (b7ba7410, 9a1c7923, 9d4bf050 — excludes 7b199dff) | Kills the self-reference (#3/#5) but leaves 3 **unverified task-completions** and does NOT stop #4's "converted" overreach. |
| (c) n floor per category | n≥3 → 1 category (revenue_idea, 3 rows, all task-completions); n≥5 → **0** | Blunt; low floors pass bad data, ~5 reaches zero. |

Supporting facts: real outcomes total **4** (all `outcome='worked'`), **`blue_verdict` = 0/92**, **`outcome_value` = 0/92**. The 4 "worked" are 3 task-completions (drafts sent / CVE patched / rec superseded — none a revenue conversion) + 1 zero-contact artifact. `SINCE_DAYS=60` and the window is on `made_at`, not `outcome_recorded_at`.

**Honest read:** under the principled gate (a), and under (a)+(b) combined, the survivor count is **0** — there is not one externally-verified, dollar-bearing conversion in the entire ledger. The loop should be gated to **propose nothing until real verified outcomes exist**, rather than manufacture patterns from 1–4 unverified, self-generated rows. Recommended design (assessment, not yet built): **(a) require `blue_verdict ∈ {right,mixed}` as the primary gate + (b) never learn from an outcome stamped ≥ the run's own start, as belt-and-suspenders + optional (c) n≥3 as a confidence damper.** Consequence to accept: zero synthesize patterns until the `blue_verdict` channel is actually used (which is also BYP-6 — the verdict is never captured today).

**Implication:** this is upstream of proposal quality — it will keep producing unfounded "patterns" no matter how good individual proposals look, and each becomes seeded self-knowledge (the pattern → prompt injection loop). It is the single most important learning-loop defect found, and it is a *closed self-referential circuit*, not merely thin data.
**Dependency (→ BYP-6):** gate (a) is trivial to implement — a single `.not('blue_verdict','is',null)` filter in `prepareSynthesize` — but it is **blocked by BYP-6**. `blue_verdict` is null on **92/92** recs because no surface ever captures it: `record_outcome` and the scorecard write `outcome` but there is no Blue-verdict control anywhere. So **the verdict channel is the prerequisite, not the gate** — shipping gate (a) before BYP-6 just makes the loop learn from nothing (0/92). Correct sequence: **fix BYP-6 first** (add a Blue right/wrong/mixed control + `recorded_by`, and stop the model writing `blue_verdict`), *then* JUD-11's gate (a) becomes meaningful. Gate (b) — exclude outcomes stamped ≥ the run's own start — is independent of BYP-6 and can ship immediately as a partial mitigation, but on its own it leaves the unverified task-completions (see survival table). See **BYP-6**.
**Effort:** investigation done; fix deferred per Blue. Gate (b) ~1-2h standalone; gate (a) ~1h but gated behind BYP-6 (~0.5 day). No migration needed (all columns exist).

*Counts note: with JUD-11 the register is 146 original + 1 post-audit = 147 findings; BROKEN 62 → 63.*

---

### Portal send governance (PSG-1…5) — discovered 2026-07-23 investigating the revived `automations/run`
*Context: AUT-1 revived 4 dead PSRX portal crons. `automations/run` fired on schedule and wrote 38 `portal_automation_log` rows across 3 members. Investigating that behavior surfaced a governance gap the original audit didn't reach — the audit confirmed the crons were **dead**, not how they'd behave once **alive**. Harmless today only because all 3 members are owner test accounts; **Batch 2 puts real leads into this portal.** All read-only, psrx-nextjs.*

### PSG-1 — compliance nudge tiers are cumulative, not banded · BROKEN · confirmed
`runCheckinCompliance` loops tiers `[7d, 14d, 21d]` and fires each when the last check-in is older than that tier's threshold **or absent** — the thresholds nest, so a member overdue ≥21d (or with no check-in at all, where `lastCheckinAt` is undefined and the skip guard short-circuits) fires **all three in one run**. Per-tier-key dedup gives no cross-tier suppression.
Evidence: `automations.ts:809-813` (tiers), `:831` (`if (lastCheckinAt && lastCheckinAt > thresholdDate) skip`), `:835` (per-tier-key/month dedup); all 3 members have 0 `portal_checkins` rows → each got 7d+14d+21d (measured 3/3/3).
Implication: a member gets 2 emails (7d nudge + 14d warning) + the 21d at-risk path (flags `at_risk`, emails the NP) simultaneously; escalation collapses into a single blast.
Fix (Batch 1.5): band it exactly like `runInactivity30d` (`:649-650` — `.lt(last_login, 30d).gte(last_login, 60d)` makes tiers mutually exclusive) — emit only the highest applicable tier, or escalate one tier per run. **Effort: 1-2h.**

### PSG-2 — `runCheckinCompliance` has no enabled gate · BROKEN · confirmed
Every other runner calls `getSetting(trigger_key)` and returns `{disabled:true}` when `!enabled` (e.g. `runInactivity30d` at `:635-639`); `runCheckinCompliance` (`:796`) never does, so it **cannot be switched off via `portal_automation_settings`** and always fires.
Implication: the one runner that multi-fires (PSG-1) is also the one with no runtime kill-switch. **Effort: 30m (add the gate).**

### PSG-3 — no per-member ceiling, spacing, or cross-runner coordination anywhere · MISSING · confirmed
The orchestrator runs 11 runners + compliance sequentially and concatenates results — no global cap, no per-member budget, no spacing/throttle (grep-confirmed absent). The only dedup, `alreadySent(member_id, trigger_key, period)`, bounds a *key across runs*, not *distinct keys within a run*.
Evidence: `src/app/api/portal/automations/run/route.ts:37-72` (runner loop, no cap); `automations.ts:80-93` (dedup scope). Multi-fire-per-member-per-run runners: compliance (≤3, PSG-1) + replenishment (≤N products, per-product loop `automations.ts:508-562`).
Implication: a member's one-run exposure = the sum over every runner they qualify for — unbounded by design. Measured ~8-10 member-facing emails achievable in one ~90s run. **Effort: see Batch 1.5 (orchestrator ceiling).**

### PSG-4 — backlog-flush: first run after downtime fires everything at once · BROKEN · confirmed
Because dedup keys on `period`, a first run after downtime finds no prior log rows for the current period → nothing dedups → every eligible `(member, key)` fires in one pass.
Evidence: `alreadySent` period semantics (`automations.ts:80-93`); the 2026-07-23 revival run wrote **38 rows / 3 members** in ~90s — the flush in action.
Implication: harmless now (owner test accounts); with real members (Batch 2) the first live run delivers the full accumulated backlog to real inboxes at once. **Effort: covered by the ceiling + a first-run guard (Batch 1.5).**

### PSG-5 — double-logging inflates `portal_automation_log` ~2× for replenishment · BROKEN · confirmed
`sendEmail()` inserts its own `portal_automation_log` row (`trigger_key = emailType`) on top of the runner's `logSend('replenishment_reminder', …)`, so each replenishment send writes **two** rows.
Evidence: `src/lib/email/send.ts:168-170` (`.insert({..., trigger_key: emailType})`) + `automations.ts:560` (`logSend(..., 'replenishment_reminder', ...)`); measured 11 `replenishment` + 11 `replenishment_reminder` rows for ~11 sends.
Implication: `portal_automation_log` overstates real sends — **any per-member cap that counts these rows throttles at half the intended ceiling.** The Batch 1.5 ceiling must count distinct sends (or the double-write must be removed) or the cap is silently wrong. **Effort: 1h.**

*Counts note: register now 146 original + 6 post-audit (JUD-11, PSG-1…5) = **152 findings**; BROKEN 62 → **67**, MISSING 44 → **45**. PSG-1/2/4/5 BROKEN, PSG-3 MISSING.*
