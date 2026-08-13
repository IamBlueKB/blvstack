# Clear Ear Books — Accounting Addendum

Corrections and additions to `CLEAREAR_BOOKS_SPEC.md`. The base spec's fundamentals
are sound — cash basis stated explicitly, owner draws excluded, gross-vs-net on card
fees, collected-vs-billed kept distinct. This addendum fixes what would produce wrong
numbers.

**Scope note:** this system produces clean records for a tax preparer. It does not
decide what is deductible. The defaults below encode assumptions a CPA should confirm
against how the entity is structured. Have that conversation before the first return.

---

## A1 — BLOCKER: forward reference in schema
`clearear_expenses.recurring_id` references `clearear_recurring_expenses(id)`, but that
table is created afterward. Postgres will fail.
**Fix:** create `clearear_recurring_expenses` **before** `clearear_expenses`, or add the
FK in a follow-up `ALTER TABLE`.

## A2 — Net profit must be two numbers, not one
§2.1 says non-deductible expenses "still count in cash net but are flagged separately."
Correct for cash flow — but the page then shows a single "Net profit" tile a reader
will assume is the tax number. It isn't.
```
net_cash    = collected − ALL expenses (excl. owner draws)
net_taxable = collected − (deductible expenses × their pct)
```
Both on the tile row, both in `getBooks`, both in the `pl` export. **Never render one
labeled just "Net."**

## A3 — deductible must be a percentage, not a boolean
Meals are generally 50% deductible federally. A boolean forces every meal to be logged
as fully deductible (overstates) or not at all (understates).
```sql
alter table clearear_expense_categories
  add column deductible_pct numeric(5,2) not null default 100.00
    check (deductible_pct between 0 and 100);
alter table clearear_expenses
  add column deductible_pct numeric(5,2) not null default 100.00
    check (deductible_pct between 0 and 100);
```
Keep `deductible` boolean as the hard on/off; `deductible_pct` applies when true.
Expenses inherit the category default, overridable per row.

Category seed changes:
| key | deductible_pct | note |
|---|---|---|
| meals | 50 | NEW — split out of travel |
| travel | 100 | transport/lodging only, no meals |
| entertainment | 0 | NEW — generally nondeductible; log it so it appears in net_cash |

`net_taxable = SUM(amount × deductible_pct / 100)` over deductible rows.

## A4 — Mileage is missing and is often the largest deduction
For a solo studio, vehicle mileage is frequently the single biggest deduction, and it
isn't an expense row — it's miles × standard rate.
```sql
create table clearear_mileage (
  id uuid primary key default gen_random_uuid(),
  drove_on date not null,
  purpose text not null,
  miles numeric(10,1) not null check (miles > 0),
  rate_cents int not null,          -- IRS standard rate for that tax year
  start_location text,
  end_location text,
  notes text,
  created_at timestamptz not null default now()
);
create index on clearear_mileage (drove_on desc);
```
Store `rate_cents` per row — the IRS rate changes annually and prior years must not
shift when the rate updates. Mileage deduction flows into `net_taxable` **only**, never
`net_cash` (no cash left the account). Admin: simple log form on the expenses page.
Export: add `type=mileage`.

## A5 — Refunds must be events, not edits
§4.3 says "void/negate the payment." Voiding erases history and silently changes a
prior month's P&L. Closed periods must never move.
**Fix:** a refund is its own row.
```sql
alter table clearear_payments
  add column refund_of_payment_id uuid references clearear_payments(id),
  add column stripe_refund_id text unique;
```
Refund posts as a **negative-amount payment** dated the refund date, referencing the
original. The original row is never modified. Idempotency key:
`stripe_refund:{refund_id}`. Stripe does not return the processing fee on most refunds —
the original `fees` expense stays (reversing it would leave the books off by the fee).
Allow `amount` to be negative on refund rows — the base spec's `check (amount > 0)`
blocks them.

## A6 — Disputes move money; a flag doesn't
§4.3 handles `charge.dispute.created` by flagging. But a dispute withdraws the funds
plus a ~$15 dispute fee. Flagged-only means the invoice still reads paid while the cash
is gone.
| event | action |
|---|---|
| `charge.dispute.created` | flag invoice, surface in briefing — no money movement yet |
| `charge.dispute.funds_withdrawn` | negative payment (as A5) + dispute fee as a `fees` expense |
| `charge.dispute.funds_reinstated` | reversing positive payment; the dispute fee is not returned |

## A7 — 1099 logic will over-report
Two problems with §3.2:
1. Card and third-party network payments are reported by the processor on **1099-K**,
   not by you. Including them double-reports the contractor.
2. Corporations are generally exempt from 1099-NEC.
```sql
alter table clearear_contacts
  add column tax_id_on_file boolean not null default false,
  add column is_corporation boolean not null default false;
```
1099 export filters to: `contractor_contact_id is not null AND method not in
('card','stripe') AND is_corporation = false`, grouped by contact, sum >= 600 for the
year. Surface excluded-but-over-threshold rows **separately** so nothing vanishes
silently.

## A8 — No period lock
Nothing prevents editing a January expense in April after filing. Prior-period figures
must not move.
```sql
-- in clearear_settings
books_closed_through date
```
Reject any insert/update/delete on `clearear_expenses`, `clearear_payments`, or
`clearear_mileage` where the effective date (`spent_at` / `paid_at` / `drove_on`) is on
or before `books_closed_through`. **Enforce server-side, not in the UI.** Corrections to
a closed period post as a current-period adjusting entry referencing the original.

## A9 — Card-expense date convention
Cash basis means the date money left. For credit-card expenses the IRS accepts the
**charge date**, not the date the card statement is paid. Document it: `spent_at =
charge date` for card expenses. One line on the expenses page prevents this being
rediscovered every year.

## A10 — System-generated fee expenses must be protected
The `fees` expense created from a Stripe balance transaction reconciles gross funding
against net deposit. If a human deletes it, the books silently break.
```sql
alter table clearear_expenses
  add column system_generated boolean not null default false;
```
System-generated rows: **not deletable** through the UI or `log_clearear_expense`'s
reversal, visually marked, and only removable by the same webhook path that created
them (on refund/reversal).

## A11 — Vendor credits and negative expenses
`check (amount > 0)` leaves refunds from vendors and credits nowhere to go. Either allow
negative `amount` on rows carrying a `credit_of_expense_id` reference, or add an explicit
credit type. Without it, a returned piece of gear gets logged as a fake income row or not
at all.

---

## Schema summary — all additions
```sql
-- A3
alter table clearear_expense_categories
  add column deductible_pct numeric(5,2) not null default 100.00
    check (deductible_pct between 0 and 100);
alter table clearear_expenses
  add column deductible_pct numeric(5,2) not null default 100.00
    check (deductible_pct between 0 and 100);
-- A5
alter table clearear_payments
  add column refund_of_payment_id uuid references clearear_payments(id),
  add column stripe_refund_id text unique;
-- A7
alter table clearear_contacts
  add column tax_id_on_file boolean not null default false,
  add column is_corporation boolean not null default false;
-- A8
alter table clearear_settings
  add column books_closed_through date;
-- A10
alter table clearear_expenses
  add column system_generated boolean not null default false;
-- A11
alter table clearear_expenses
  add column credit_of_expense_id uuid references clearear_expenses(id);
-- and relax: check (amount <> 0) instead of (amount > 0)
-- A4: new table clearear_mileage (see above)
```

## What the base spec gets right — keep it
- **§4.5** — payments created only by the webhook, never the browser return. The single
  most common source of phantom payments. Hold the line.
- Idempotency key `stripe:{payment_intent_id}`. Correct; Stripe retries are at-least-once.
- Gross funds the invoice, fee posts as an expense. The thing most builds get wrong.
  Right as written.
- Owner draws excluded from P&L. Correct.
- Cash basis stated on the page. Keep it visible, not in a footnote.

## Revised verification (in addition to the base spec's checks)
- Recompute `net_cash` and `net_taxable` by hand for one month against direct SQL before
  trusting the page.
- **Refund test:** full refund in Stripe test mode → confirm two payment rows (original +
  negative), the original unmodified, the `fees` expense still present, and the prior
  month's `net_cash` unchanged.
- **Period-lock test:** set `books_closed_through`, attempt an edit before that date
  through both the API and the JANET tool, confirm both refuse.
- **1099 test:** a contractor paid $700 by card and $700 by check should appear at $700,
  not $1,400.
