# Known debt — deliberate, logged, not forgotten

Things we chose not to do, with the reason and what would make them worth doing.
Add to this rather than letting a decision live only in a chat thread.

---

## 1. `clearear_*` tables now hold BLVSTACK rows (misleading names)

**Logged:** 2026-08-13 · **Status:** open · **Risk:** low functional, medium comprehension

When the books went multi-business (`a902818`), every money table gained a
`business` column (`clearear` | `blvstack`) instead of being renamed. So
`clearear_invoices`, `clearear_payments`, `clearear_expenses`,
`clearear_invoice_lines`, `clearear_recurring`, `clearear_recurring_expenses`,
`clearear_mileage`, `clearear_sessions`, `clearear_settings`, and
`clearear_invoice_counters` all hold **both** businesses' rows.

**Why not renamed now:** ~150 query sites across 22 files, including the live
Stripe webhook path (which had already produced three silent bugs — a
non-existent `idempotency_key` column, an unresolved nested `expand`, and a
balance-transaction race). A cosmetic rename touching that path is a real risk for
zero functional gain.

**Why it's still debt:** the names imply single-tenancy. The predictable future bug
is someone reading `clearear_expenses` as "Clear Ear's expenses" and writing an
aggregate without a `business` filter. The type system guards the *library* calls
(business is a required param), but a raw `supabaseAdmin.from('clearear_expenses')`
in a new page has no such guard.

**What it would take:** rename to `books_*` (e.g. `books_invoices`,
`books_payments`, `books_expenses`), with views under the old names during a
transition, then update call sites and drop the views. Best done when the Stripe
path is quiet and there's appetite for a full re-verification pass — not alongside
other work.

**Trigger to do it:** next time the money layer needs a substantial change anyway,
or the first time someone is genuinely confused by the naming.

**Mitigation in the meantime:** `business` is NOT NULL with no default on every
money table, and the lib functions require the parameter — so an unscoped
*library* call is a compile error, not a wrong number.

---

## 2. Same-title dedup on `create_doc` is exact-match only

**Logged:** 2026-07-30 · **Status:** open · **Risk:** low

`create_doc` refuses a duplicate title, but only on an exact string match. The three
duplicate "Justin Tiggs" docs that caused the `/jtgrease` incident were *reworded*
("Fix the assessment→portal handoff" vs "Unblock the assessment→portal funnel"), so
this guard would not have caught them.

**Why not fixed:** fuzzy/normalized matching fails the hard case anyway — a
threshold loose enough to catch "fix the handoff" ≈ "unblock the funnel" would start
collapsing genuinely different ideas. Wrong trade.

**What it would take:** give each doc a stable `dedup_key` at creation from a small
controlled vocabulary, and dedup on that instead of the title.

**Trigger:** if duplicate docs recur in practice.
