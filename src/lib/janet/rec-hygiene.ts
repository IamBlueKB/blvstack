// Recommendation-hygiene helpers shared by the open-rec nag (prompt injection +
// the daily brief) and the dream's reconcile sweep.
//
// The core correction: a PSRx re-engagement recommendation carries a `review_on`
// date (the next-contact date JANET decided). Its "am I overdue?" signal is that
// review date — NOT how many days ago the rec was made. A rec scheduled for
// 2026-08-04 is not overdue on 2026-07-20; it's scheduled. Nagging about it (and
// ~15 like it) trains Blue to ignore the open-rec mechanism entirely.

/** Pull the "review YYYY-MM-DD" date out of a re-engagement rec's text, if any.
 *  Format is written by nurture.ts: "Re-engage · … · review 2026-07-15". */
export function reviewDateFromRec(text: string | null | undefined): string | null {
  const m = /review\s+(\d{4}-\d{2}-\d{2})/i.exec(text ?? '');
  return m ? m[1] : null;
}

/**
 * Is this OPEN recommendation genuinely an aging one worth chasing? False when:
 *  - it's already flagged (surfaced as ⚠ DUE / RESOLVE — not a silent aging nag), or
 *  - it's a re-engagement scheduled for a FUTURE review date (scheduled, not overdue).
 * Otherwise it ages on made_at as before (>= minDays old).
 *
 * todayStr is an ISO date (YYYY-MM-DD); nowMs is Date.now() at the call site.
 */
export function isAgingOpenRec(
  rec: { recommendation?: string | null; flagged_at?: string | null; made_at: string },
  todayStr: string,
  nowMs: number,
  minDays = 3
): boolean {
  if (rec.flagged_at) return false;
  const rev = reviewDateFromRec(rec.recommendation);
  if (rev && rev > todayStr) return false; // scheduled for a future review — not overdue
  return (nowMs - new Date(rec.made_at).getTime()) / 86_400_000 >= minDays;
}
