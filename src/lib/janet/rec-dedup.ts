// Recommendation de-duplication. The weekly PSRx brief re-raises the same advice
// each run, reworded — "Ingest Google reviews…" becomes "Ingest Google Places
// reviews…", "Fix the assessment→portal handoff" becomes "Unblock the
// assessment→portal funnel". Splitting one recurring call across four rows
// destroys the signal that it's been open four weeks. So a re-raise BUMPS the
// existing rec (repeat_count + last_seen_at) instead of inserting a duplicate.
//
// The match is NOT exact normalized text — that misses rewordings (the funnel
// pair scores only 0.36 Jaccard yet shares 5 distinctive tokens). It's scoped to
// the SAME subject + category, then: high token overlap OR enough shared
// distinctive tokens. Favors merging (a re-raise is signal) and is reversible
// (record_outcome status='superseded' un-does it), so an occasional over-merge is
// visible (the tool returns dedup:true + the matched rec) and cheap to split.

const STOP = new Set(
  ('the a an to for of in on and or is at be it so up off into as by with your you their they i we our its this ' +
    'that from before after within are can no not new one two get make made will would should could than then them ' +
    'these those what when how why who — - · & + = / , . ( )').split(/\s+/)
);

/** Significant tokens: lowercased, punctuation-stripped, ≥3 chars, non-stopword. */
export function sigTokens(text: string): string[] {
  return [...new Set(String(text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** Distinctive tokens: ≥4 chars (drops generic verbs like fix/add/use), the ones
 *  that actually identify the topic — google, assessment, funnel, treatment —
 *  MINUS any token carried by the rec's own subject/category. Subject-scoping
 *  already forces every rec in a scope to share those, so counting them as
 *  "distinctive" double-counts a variable we've already controlled for. */
function distinctive(tokens: string[], exclude?: Set<string>): string[] {
  return tokens.filter((t) => t.length >= 4 && !(exclude && exclude.has(t)));
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

export function sharedDistinctiveCount(a: string[], b: string[], exclude?: Set<string>): number {
  const B = new Set(distinctive(b, exclude));
  return distinctive(a, exclude).filter((t) => B.has(t)).length;
}

export type RecScope = { category?: string | null; subject_type?: string | null; subject_id?: string | null; subject_label?: string | null };

/** The tokens a rec's subject + category contribute — stripped from the
 *  distinctive set (see `distinctive`). Built from the same fields `subjectScope`
 *  keys on, so the strip is exactly the variable scoping already pinned. */
export function scopeTokens(scope?: RecScope): Set<string> {
  if (!scope) return new Set();
  return new Set(sigTokens([scope.category, scope.subject_type, scope.subject_id, scope.subject_label].filter(Boolean).join(' ')));
}

export type DedupSignal = { same: boolean; jaccard: number; shared_distinctive: number; shared: string[] };

/** Are two recommendation texts the same call (assuming already same subject +
 *  category)? High overlap OR enough shared distinctive tokens — but the
 *  distinctive-token branch also requires a jaccard FLOOR (≥0.25). Without it,
 *  two recs that merely name the same subject in their text (psrx-nextjs preview
 *  environment) can share ≥3 distinctive tokens at near-zero real overlap and
 *  falsely merge. The floor keeps genuine low-overlap rewordings (the funnel pair
 *  at 0.36) while rejecting subject-name coincidences (the preview pair at 0.17).
 *  Pass the rec's scope so subject/category tokens are stripped from the count. */
export function sameRecommendation(textA: string, textB: string, scope?: RecScope): DedupSignal {
  const exclude = scopeTokens(scope);
  const a = sigTokens(textA), b = sigTokens(textB);
  const j = jaccard(a, b);
  const sd = sharedDistinctiveCount(a, b, exclude);
  const Bd = new Set(distinctive(b, exclude));
  const shared = distinctive(a, exclude).filter((t) => Bd.has(t));
  return { same: j >= 0.5 || (sd >= 3 && j >= 0.25), jaccard: Math.round(j * 100) / 100, shared_distinctive: sd, shared };
}

/** The subject scope a rec dedups within: exact record when it has one, else the
 *  human label. Two recs only ever merge inside the same (category, subject). */
export function subjectScope(r: { category: string; subject_type?: string | null; subject_id?: string | null; subject_label?: string | null }): string {
  return `${r.category}|${r.subject_type ?? ''}|${r.subject_id || r.subject_label || ''}`;
}
