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
