# BLVSTACK — Backlog

Things we've considered but deliberately deferred. Each entry should have a clear
trigger that says "build this when X happens" — never "someday." If a trigger
isn't met, the entry stays here, not in active work.

---

## Auto-disqualification confidence + review queue

**Status:** Backlog. Don't build until ≥20 real prospect disqualifications exist in production.

**Context:** Researcher exhibits judgment beyond explicit prompt — during phase 9 hand-test, it self-disqualified example.com ("reserved demo domain") and blvstack.com ("our own site"). Both correct calls. The concern: when it makes a defensible-but-wrong call on a real prospect, it currently looks identical to a correct disqualification, and the prospect silently rots in the disqualified pool without review.

**What to build (later):**
- Researcher returns `disqualification_confidence` (0–1) alongside disqualified + reason
- Threshold (likely 0.7–0.85, calibrated against real data) below which UI flags as "Auto-disqualified — review?"
- List view: disqualified prospects below threshold get a yellow indicator + one-click "Override (re-eligible)" button
- Audit log: track every override so we can use the data to retrain the prompt

**Trigger to revisit:** When the disqualified prospect count hits 20+, dump the list, eyeball for false positives, then design the threshold around what we actually see. Not before.

---

## Reply classification layer

**Status:** Backlog. Don't build until ≥20 real replies exist in production.

**Context:** Cloudflare Email Worker currently marks inbound as `replied` but doesn't classify intent. For first 20 sends Blue reads everything manually and tags by hand. Once tagged data exists, that's the training signal for an auto-classifier.

**What to build (later):**
- Reply intent enum on prospects/replies table: `interested`, `not_now`, `unsubscribe`, `objection`, `question`, `referral`, `other`
- Worker calls Claude on inbound, classifies, writes intent + confidence
- UI surfaces intent badge in admin reply view
- Low-confidence classifications flagged for review

**Trigger to revisit:** 20 hand-tagged replies in production.

---

## Rendered-HTML test coverage

**Status:** Backlog. Acceptable risk for now.

**Context:** Phase 9 hand-test caught logic bugs via API but missed a frontmatter reference bug in the find-prospects modal (`liveNiches`/`scaffoldNiches` referenced without being defined). Bug was caught via grep before push. Pattern will repeat — any future Astro template change can silently break SSR while passing API tests.

**What to build (later):**
- Playwright smoke tests for each admin page that render the full HTML and assert no console errors / no ReferenceErrors
- Run on CI before deploy

**Trigger to revisit:** First Astro template bug that ships to prod, OR when we add a second admin author. Whichever first.
