# JANET / BLVSTACK / PSRX — REMEDIATION PLAN

**Source:** `spec/FULL_SYSTEM_AUDIT_2026-07-22_FINDINGS.md` (146 findings) and its synthesis `spec/FULL_SYSTEM_AUDIT_2026-07-22.md`.
**Living file** — update the checkboxes and the "Landed" notes as items ship. Every item carries its finding ID, evidence anchor, effort, and a checkbox.

**Ordering principle:** leverage-to-effort. Batch 1 is trivial high-leverage; each subsequent batch is a coherent, independently-committable body of work. Backlog is everything not yet claimed by a batch, grouped by area.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` landed (committed) · `[D]` deployed/applied to prod · `[—]` no-code / inventory / decision-only.

**Repos:** `blvstack` (Astro, master, GitHub→Vercel) · `psrx-nextjs` (Next, main, GitHub psrxbodyandskin/psrx-nextjs; deploys via `vercel --prod`). DB DDL on blvstack applied via Supabase Management API (partial-index workaround); PSRX DDL via its SQL editor / Management API.

---

## BATCH 1 — trivial high-leverage fixes  ▸ status: IN PROGRESS

Small, unambiguous, independently verifiable. Commit each item or tight group separately.

| ✔ | ID | Fix | Repo | Anchor | Effort | Landed |
|---|---|---|---|---|---|---|
| [ ] | AUT-1 | 4 PSRX portal crons export POST only → Vercel GET → 405, never run. Add GET handlers. Revives protocol reminders, all time-based portal automations, monthly cleanup, Meta lookalike sync. | psrx | protocol/reminder:22, cleanup:20, automations/run:26, meta/lookalike-sync:14; vercel.json:4-18 | 1-2h | |
| [ ] | OCF-1 | `janet_dream_proposals_idem_idx` is PARTIAL → PostgREST can't target it → every proposal write throws 42P10. Drop partial, create plain unique. | blvstack DB | proposals.ts:117; migration 20260721230000:39-40 | ~1h | |
| [ ] | OCF-2 | `dream-verify.test.ts` upserts `onConflict:'id'` not the shipped `'idempotency_key'`. Fix test to exercise the shipped arbiter; confirm it now catches OCF-1's shape. | blvstack | dream-verify.test.ts:91-92 | ~30m | |
| [ ] | MEM-2 | `dream/consolidate` liveDigest queries `connected_sites` (doesn't exist). Rename to `janet_sites`; stop swallowing the error. | blvstack | consolidate.ts:198,202 | minutes | |
| [ ] | AUT-3 | seo-content inserts `meta_description`/`tags`/`seo_keyword` (none exist) → failed every run since March, paying a Sonnet call first. Drop the 3 fields. | psrx | seo-content/route.ts:141-146 | 1h | |
| [ ] | AUT-4 | replenishment + shop-abandonment dedup on `sent_at`; column is `fired_at`. Fix both. | psrx | replenishment:110, shop-abandonment:109 | 30m | |
| [ ] | POL-2 | 13 blvstack `maxDuration` route exports are dead code; @astrojs/vercel honors only an adapter-level option astro.config.mjs doesn't set. Set it. | blvstack | astro.config.mjs:11-14 | minutes | |
| [ ] | SPD-5 | Dream collect ledgers at full Sonnet rates despite the Batch API (~50% off). Apply the discount so the $1 nightly cap means what it says. | blvstack | model.ts:140-142 | <1h | |
| [ ] | ATT-5 | Brevo webhook parses event time as UTC when Brevo sends account-local → 2 of 3 opens recorded before their own send. Fix the parse. **Existing rows cannot be backfilled** (no stored epoch). | psrx | brevo/route.ts:38 | ~1h | |
| [ ] | DAT-3 | 2026-07-22 dream run stuck `submitted`; both batches ENDED, results retrievable. Diagnose why the collector never ran; once OCF-1 lands, collect the run — first real exercise of the two-phase loop. | blvstack | janet-dream-collect.ts; dream_runs row 5406a69a | half day | |

---

## BATCH 2 — funnel repair (assessment → portal bridge)

The 94→0 break. Unlocks the entire built portal + honours the readout email promised to 94 leads.

| ✔ | ID | Fix | Repo | Anchor | Effort |
|---|---|---|---|---|---|
| [ ] | FUN-1 | assessment-nurture filters 5 columns that don't exist → 0 leads processed, 6 no-op runs/day. Migration adding the columns (or rewrite against existing) + stop swallowing the query error. | psrx | assessment-nurture/route.ts:36-42 | 2-3h |
| [ ] | FUN-2 | Completion screen offers only external AP booking + Return Home — add a portal CTA at peak intent. | psrx | SkinAssessmentForm.tsx:245-287 | 1-2h |
| [ ] | FUN-3 | The promised "your skin profile will arrive by email" never sends to the lead (only staff). Build the readout email + send it. | psrx | assessment/route.ts:88-92; SkinAssessmentForm.tsx:256 | hours |
| [ ] | FUN-4 | Admin portal-funnel dashboard omits the assessment step → the break is invisible. Add a "Completed assessment" step from assessment_leads. | psrx | portal-funnel/route.ts:4-9,91-95 | hours |

---

## BATCH 3 — attribution evidence chain

The only path to a recovered-revenue number that survives diligence. (ATT-5 TZ-parse fix ships in Batch 1 as its prerequisite.)

| ✔ | ID | Fix | Repo | Anchor | Effort |
|---|---|---|---|---|---|
| [ ] | ATT-8 | No holdout/control anywhere → recovered number is precedence, not lift. Randomly hold out ~25% of qualifying followups at creation, exclude from release, report touched-vs-heldout. | blvstack | nurture.ts:332-356; recovered.ts | 3-5h |
| [ ] | ATT-3 | 9 of 10 converted leads leave no attribution row (manual status dropdown). Make the status route write a `janet_conversions` row (source='staff', recovered=false) so the background rate becomes measurable. | psrx | status/route.ts:15 | 1-2h |
| [ ] | ATT-4 | The one 'converted' followup outcome is a zero-contact correlation. Add a distinct `converted_untouched` outcome when released_at null / no sent draft preceded. | blvstack | nurture.ts:375-377 | 2-3h |
| [ ] | ATT-6 | engaged=1 is almost certainly a proxy open (6s post-send, proxy_open counted). Segment proxy_open / sub-30s opens out of the engagement signal. | psrx | brevo/route.ts:26 | ~1h |
| [—] | ATT-9 | The diligence bar itself (≥150-300 sends/≥90d, windows closed ~Aug 28, holdout, treatment_value). Tracking item; closes on calendar + volume once the above land. | — | attribution.md | calendar |

---

## BATCH 4 — cron-output watchdog

The audit's clearest pattern: capability shipped ahead of observability. Five revenue mechanisms died silently. Build the reconcile pattern (already used for recs) pointed at cron outputs.

| ✔ | ID | Fix | Repo | Anchor | Effort |
|---|---|---|---|---|---|
| [ ] | WATCH-1 | New: a daily check that every scheduled surface produced its expected artifact (row written / event logged) within its window; alert on the ones that didn't. Would have caught FUN-1, AUT-3, AUT-1, FUN-5, DAT-1 within a week each. | both | new (model on invariants.ts pattern) | ~1 day |
| [ ] | BYP-9 | outbound + booker crons return HTTP 200 {ok:true} even when both sub-jobs threw. Return 500 (or ok:false) on total failure. | blvstack | outbound.ts:24-36; booker.ts:29-35 | 1h |
| [ ] | BYP-16 | assessment-nurture/winback/shop-abandonment report ok:true / conflate skipped with failed. Distinguish healthy-quiet from broken. | psrx | assessment-nurture:145; winback:167-173 | 1-2h |

---

## BATCH 5 — verification harness (make the whole finding-class un-shippable)

Turn the three defect classes this audit found into build-time failures.

| ✔ | ID | Fix | Repo | Anchor | Effort |
|---|---|---|---|---|---|
| [ ] | HARN-1 | Validate every `onConflict` target against the live index catalog at build/CI (partial → fail). Closes the OCF-1/janet_conversions class permanently. | both | onconflict.md | ~half day |
| [ ] | HARN-2 | Generate Supabase types and type the query layer so a query on a nonexistent column fails to compile. Closes FUN-1/AUT-3/AUT-4/MEM-2 class. | both | data.md; automation.md | ~1 day |
| [ ] | TOO-5 | Contract gate is a regex over declarations; a tool declaring mutates:false with bare inserts passes. Add a handler-body insert/update/delete scan. | blvstack | check-tool-contract.mjs:94-142 | 2-4h |
| [ ] | OCF-3 | 9 upsert sites never read the supabase-js error. Destructure + log/propagate (token-save pair riskiest). Pairs with HARN-1. | both | instagram.ts:53-60; meta.ts:71-78; +5 blvstack | 2-4h |

---

## BATCH 6 — governance paydown (the dangerous 12)

Flip governance from ~20% of the mutating surface to the consequential surface.

| ✔ | ID | Fix | Repo | Anchor | Effort |
|---|---|---|---|---|---|
| [ ] | TOO-1 | `booker_mark_booked` raw-inserts a success-fee, no key/ledger/reversal. Route through guardedCreate, declare contract, add reversal. | blvstack | booker.ts:385-401 | 2-4h |
| [ ] | TOO-3 | `file_records` fan-out has no inner idempotency / no all-or-nothing. Key each record or make the tool idempotent on an approval-scoped key. | blvstack | docs.ts:143-151 | 0.5d |
| [ ] | TOO-4 | Post-send bookkeeping runs raw on the dedup path → books can double-record. Branch on `result.dedup` / move into the executor log callback. | blvstack | executor.ts:88-94; ring3.ts:237-261 | 2-3h |
| [ ] | TOO-6 | `generate_psrx_brief` bypasses rec dedup + no unique on (client_key, week_of) → dup recs + dup brief + double Opus. Route through log_recommendation, guard on week_of. | blvstack | brief.ts:154-171 | 2h |
| [ ] | BYP-5 | Nurture cross-DB writes have no natural key — dup class already occurred (3 leads). Unique index lead_id+follow_up_number + dedup-before-insert; declare contract. | blvstack | nurture.ts:278-282 | 0.5-1d |
| [ ] | BYP-3 | Draft-approval route reads-then-acts + /email/send has no idempotency → double-send. CAS on status (.eq('status','pending') + check affected). | psrx | queue/[draftId]/route.ts:39,55-74 | 2-4h |
| [ ] | TOO-2 | send_outbound_batch fans one approval to N cold sends whose content is read at run time. Snapshot ids+draft hashes into the approval card; send only that. | blvstack | engine.ts:69,35-45; ring3.ts:173-182 | 0.5-1d |

---

## BATCH 7 — ledger fix (minimal-workable-rec)

Turn the rec ledger from memorial to queue. Prerequisite for the scorecard ever meaning anything. LED-9 subsumes LED-1/2/3/4/5/8.

| ✔ | ID | Fix | Repo | Anchor | Effort |
|---|---|---|---|---|---|
| [ ] | LED-9 | (1) nurture rec born-resolved (empties 69/81); (2) add next_action/review_on/value_estimate (copy janet_deals); (3) order every surface by (value desc, review_on asc), point rec-hygiene at the column not the regex, add a client/site reconcile sweep. | blvstack | nurture.ts:238-243; prompt.ts:104; reconcile.ts:143-190 | half day |
| [ ] | LED-8/MEM-6 | heartbeat computes rec "today" in UTC vs prompt's Chicago day. Use localDateISO in gatherLedger. (Folds in with LED-9.) | blvstack | heartbeat.ts:201 | 15m |

---

## BACKLOG — everything else, grouped by area

Not yet claimed by a batch. `[—]` = inventory / decision-only (no code). Cross-refs note where a finding is a different lens on a batched item.

### Judgment / learning loop
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | JUD-3 | Hook `log_prediction` into the approval flow (0 predictions ever → starves the whole loop). | hours |
| [ ] | JUD-4 | Add a scorer for reconcile-staged predictions (deferred to a pass that doesn't exist). | 0.5-1d |
| [ ] | JUD-7 | Drop the orphan `janet_outcomes` table (0 rows, 0 refs, misleads audits) — or wire it. | minutes |
| [ ] | JUD-8 | Inject learned patterns/graveyard into nurture/triage prompts so outcomes change behavior (no-load-bearing-belief). | 1-2d/pipeline |
| [—] | JUD-1,2,5,6,9,10 | Verdict/starved/inventory — resolve as the loop's inputs (predictions, outcomes) start flowing. | — |
| [ ] | DAT-11 | Same as JUD-3 (janet_predictions 0 rows) — prompt-level nudge. | hours |

### Funnel / acquisition
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | FUN-5 | shop-abandonment never fired — instrument + fix root cause (PostHog event wiring or guest filter). | hours+ |
| [ ] | FUN-7 | Popup converts 0.07% — offer/creative rework (largest measured leak). Fix DAT-1 stats first. | days |
| [ ] | DAT-1 | Popup A/B stats computed on ~1,000 of 12,309 rows — aggregate server-side. | 1-2h |
| [ ] | DAT-2 | popup_metrics has no retention job — add cleanup cron. | 1h |
| [—] | FUN-6,8,9,10 | Downstream of the portal bridge (Batch 2) / inventory. | — |

### Attribution (beyond Batch 3)
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | BYP-7 | Staff attribute-conversion inflates the recovered headline + no idempotency. Split verified vs staff-asserted $; per-lead-per-day key. (Pairs with ATT-3.) | 0.5d |
| [ ] | BYP-6 | Scorecard hit-rate is model-asserted. Add recorded_by; split Blue-verified vs JANET-asserted; block model writes to blue_verdict. | 0.5d |
| [ ] | BYP-13 | record_external_action provenance never rendered — show an "unverified/reported" badge on the deal timeline. | 0.5-1d |
| [—] | ATT-1,2,7 | Inventory/framing — resolve on volume. | — |

### Tools / governance (beyond Batch 6)
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | TOO-9 | Legacy paydown of the remaining dangerous-exempt tools + policy (not just "when touched"). | 2-3d |
| [—] | TOO-7,8,10 | Confirmations (send-path consolidation, PSRx write lane, hidden tools contained). | — |
| [ ] | BYP-14 | Broader raw-mutation paydown (132 raw sites) — track as TOO-9 progresses. | ongoing |

### Bypass / integrity (beyond batched)
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | BYP-1 | shop-abandonment marks failed sends as sent forever — await + log-on-success only. | 1-2h |
| [ ] | BYP-2 | All PSRx agent crons send-then-mark, no idempotency — sendOnce(key) wrapper. | 1-2d |
| [ ] | BYP-4 | Verify why janet_action_ledger is empty (deploy timeline vs bypass); exercise one write. | 1h |
| [ ] | BYP-8 | PSRx Brevo webhook swallows failed events → false no_response outcomes. Log + dead-letter. | 1-2h |
| [ ] | BYP-10 | Instagram fail-forward cooldown — throw/requeue when both sends fail. | 2-4h |
| [ ] | BYP-11 | sendVerified proceeds unledgered when the ledger insert fails → retry re-sends. Refuse to send. | 1-2h |
| [ ] | BYP-12 | Ring3 post-send bookkeeping refires on dedup (latent; = TOO-4 lens). | 0.5d |
| [ ] | BYP-15 | Recurring-invoice crash window — key on recurring_id+period not creation date. | 2-4h |

### Automation / crons (beyond batched)
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | AUT-6 | Register + verify the two BLVSTACK Resend delivery webhooks (0 events ever). | 1h |
| [ ] | AUT-7 | lead-followup inputs never set (0/94 have follow_up_due_at) — build the assignment flow. | half day |
| [ ] | AUT-8 | Confirm Shopify orders/paid webhook registration (0 rows ever). | 30m |
| [ ] | AUT-10 | Watch refresh-tokens window (both tokens expire 2026-07-30) — re-check ~07-26. | 5m |
| [—] | AUT-2/POL-1 | = FUN-1 (Batch 2). AUT-5,9,11,12,13,14 inventory. | — |

### Data assets
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | DAT-4 | Observations dead loop — wire getFreshObservations into the grounding path. | half day |
| [ ] | DAT-5 | janet_action_ledger 0 rows — trace one Ring-2 write (= BYP-4). | 1-2h |
| [ ] | DAT-6 | meta_campaigns has no ingest — Meta Ads API ingest cron (unlocks source-ranking). | 1-2d |
| [ ] | DAT-9 | referrals + portal_consent_versions read-never-written (referrals query also hits nonexistent cols). | hours each |
| [ ] | DAT-7,8 | Drop schema orphans (8 PSRX + 3 BLV) — needs Blue's approval. | [—] |
| [—] | DAT-10,12,13 | Booker data idle / portal flatline / assessment gap — inventory + one test submission. | — |

### Integrations
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | INT-1 | Register the Resend delivery webhook in both accounts (= AUT-6). | <1h |
| [ ] | INT-2 | Refresh .env.vercel.prod snapshot (AESTHETICSPRO/BREVO secrets are prod-only). | <1h |
| [ ] | INT-3 | Re-auth the stale Instagram token + add an IG health check. | 1-2h |
| [ ] | INT-7 | Add health checks for Recharge / Instagram / AestheticsPro. | 2-3h |
| [ ] | INT-4 | Delete Klaviyo dead lib + 4 env keys (or leave). | 1h |
| [ ] | INT-10 | Confirm HEALTHCHECKS_* keys are in prod Vercel env (dead-man may be unarmed). | 30m |
| [—] | INT-5,6,8,9,11 | Inventory. | — |

### Spend
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | SPD-2 | Add a client/context tag to logTurnCost (PSRx share currently unknowable). | hours |
| [ ] | SPD-3 | Costed-client wrapper for the entire psrx-nextjs Anthropic surface (unledgered). | ~1d |
| [ ] | SPD-4 | Route the 20+ unledgered blvstack call sites through one costed client. | ~1d |
| [ ] | SPD-6 | draft_lead_reply model call bypasses the cost breaker — add ctx.onCost. | <1h |
| [ ] | SPD-9 | usdCostOf fail-loud on unknown model family (rate-table drift). | hours |
| [—] | SPD-1,7,8 | Inventory. | — |

### Product / multi-client (all decision-gated on client #2 intent)
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [—] | PRD-1…10 | Tenancy work: connection registry (PRD-2), followups client_id (PRD-3), subject FK not string (PRD-4), approver routing (PRD-9), brand config extraction (PRD-7). All aspirational until client #2 is scoped; PRD-10 is the estimate. | 20-30 eng-days |

### Memory / self-knowledge
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | MEM-1 | Reconcile sweep 4 for client/site-subject recs (the CVE-nag general shape). | 1-2d |
| [ ] | MEM-3 | Memory TTL / freshness annotation (asymmetric-trust gap). | hours |
| [ ] | MEM-5 | Sanctioned "capability changelog → system memory" deploy step + deprecation. | hours |
| [—] | MEM-4,6,7 | = DAT-3 (Batch 1) / LED-8 (Batch 7) / inventory. | — |

### Polling / ceilings (beyond batched)
| ✔ | ID | Item | Effort |
|---|---|---|---|
| [ ] | POL-3 | PSRx release mid-batch kill — copy the booker time-budget pattern + swap write order. | hours |
| [ ] | POL-4 | Lighthouse null → phantom regressions; also delete the dead SEO/accessibility mapping. | hours |
| [ ] | POL-5 | Sweep truncation unreported — emit eligible_total + remaining. | <1h |
| [ ] | POL-6 | Send-then-mark duplicate emails (3 PSRx agents) + Shopify fetch timeout. | hours |
| [ ] | POL-7 | shop-abandonment single PostHog page — paginate or HogQL aggregate. | hours |
| [ ] | POL-8 | Instagram processing-jobs reaper. | <1h |
| [ ] | POL-9 | Morning-queue silent catch{continue} — emit a 'blocked' decision. | <1h |
| [ ] | POL-10 | Meta pagination unbounded — page cap + AbortSignal. | <1h |
| [ ] | POL-11 | Brevo fail-open on missing key + no timeout — throw/record + timeout. | hours |
| [ ] | POL-12 | reconcile cap unordered (limit 400 no order) — order + set-based lookups at volume. | hours |
| [—] | POL-13 | Implicit ~1000-row cap — awareness; add limits as tables grow. | — |

---

## CHANGELOG
- 2026-07-23 — Plan created from the 146-finding register. Batch 1 execution begins.
