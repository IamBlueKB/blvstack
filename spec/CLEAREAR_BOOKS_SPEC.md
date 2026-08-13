# Clear Ear Books — Expenses, P&L, Tax Export, and Stripe

Turns Clear Ear from **revenue-only** into real books: money out as well as in, net
profit, tax-ready exports, and card payments that reconcile themselves.

> **Read `CLEAREAR_BOOKS_ADDENDUM.md` alongside this file — it corrects several
> things here that would produce wrong numbers (single "Net" tile, boolean
> deductible, refunds-as-edits, 1099 over-reporting, forward-referenced FK, missing
> mileage + period lock). The addendum wins on any conflict.**

**What exists today:** `clearear_contacts`, `clearear_sessions`, `clearear_invoices`,
`clearear_invoice_lines`, `clearear_payments` (money IN only), `clearear_settings`,
`clearear_payment_methods`. Admin pages: Studio, Accounting, Invoices, Contacts,
Sessions, Services, Settings. Client-facing invoice at `/invoice/[token]`.

**Governing rules (already enforced in this codebase — keep them):**
- Every state-mutating JANET tool declares `mutates`, `idempotent`, `reversal`
  (`scripts/check-tool-contract.mjs` fails the build otherwise).
- Writes route through `guardedCreate` (natural-key idempotent + ledgered + read-back).
- **Collected ≠ billed.** Never blur them. Same discipline now applies to
  **paid vs accrued** expenses and **gross vs net** on card payments.

---

## Phase 1 — Expenses (the core)

### 1.1 Schema

```sql
create table clearear_expense_categories (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,          -- rent, utilities, software, gear, supplies,
                                     -- fees, travel, contractors, marketing, other
  label text not null,
  deductible_default boolean not null default true,
  sort_order int not null default 0,
  active boolean not null default true
);

create table clearear_expenses (
  id uuid primary key default gen_random_uuid(),
  spent_at date not null,
  vendor text not null,
  amount numeric(12,2) not null check (amount > 0),
  category_key text not null references clearear_expense_categories(key),
  method text not null,              -- cash, check, ach, card, cashapp, zelle, other
  reference text,                    -- check #, txn id, last4
  notes text,
  deductible boolean not null default true,
  is_owner_draw boolean not null default false,  -- NOT an expense; excluded from P&L
  receipt_url text,                  -- Supabase Storage path
  recurring_id uuid references clearear_recurring_expenses(id),
  contractor_contact_id uuid references clearear_contacts(id), -- for 1099
  idempotency_key text unique,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on clearear_expenses (spent_at desc);
create index on clearear_expenses (category_key);

create table clearear_recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,
  amount numeric(12,2) not null check (amount > 0),
  category_key text not null references clearear_expense_categories(key),
  method text not null,
  day_of_month int not null check (day_of_month between 1 and 28),
  notes text,
  active boolean not null default true,
  last_generated_on date,            -- guards double-generation
  created_at timestamptz not null default now()
);
```

Seed categories: rent, utilities, software, gear, supplies, fees, travel,
contractors, marketing, other.

### 1.2 Recurring generation
Cron (daily, reuse the existing cron lane + `CRON_SECRET`): for each active
recurring row where `day_of_month <= today` and `last_generated_on` is not in the
current month → create the expense, stamp `last_generated_on`, set `recurring_id`.
Idempotency key: `recurring_expense:{id}:{YYYY-MM}` — a re-run cannot double-post.

### 1.3 Admin UI — `/admin/clearear/expenses`
- List: month filter, category filter, running total; row = date · vendor ·
  category · method · amount, with edit/delete.
- **Log expense** form: date, vendor, amount, category, method, reference, notes,
  deductible toggle, owner-draw toggle, receipt upload.
- **Recurring** panel: add/edit/pause monthly items (rent, utilities), shows
  next-due date and last generated.
- Nav entry under Clear Ear (`active="clearear-expenses"`), mirroring the existing
  `AdminLayout` pattern (add the key to the `active` union + `clearear` children).

### 1.4 Receipts
Supabase Storage bucket `clearear-receipts`, **private**. Upload via an admin API
route (service role); render via signed URLs (1h). Never public — receipts carry
vendor/account detail.

---

## Phase 2 — P&L and reporting

### 2.1 Extend `getStudioIntelligence` (or add `getBooks`)
Return alongside the existing collected/billed/receivables:
```
expenses: { total, by_month: Record<string, number>, by_category: {category, amount}[] }
net: { by_month: Record<string, number>, total }   // collected − deductible expenses
```
**Cash basis** (money in vs money out by date) — matches how a solo studio files.
State the basis on the page so it's never ambiguous.

Rules: `is_owner_draw = true` is EXCLUDED from expenses and P&L (it's a draw, not a
cost). `deductible = false` still counts in cash net but is flagged separately for tax.

### 2.2 Accounting page additions (`/admin/clearear/accounting`)
- Headline gains **Expenses** and **Net profit** tiles next to Collected.
- **P&L by month** table: collected · expenses · net (color net red/green).
- **Expenses by category** breakdown, mirroring "Billed by service".
- Keep the year filter; keep collected/billed labeled distinctly.

---

## Phase 3 — Tax

### 3.1 CSV exports — `/api/admin/clearear/export?type=…&year=…`
- `income` — every payment: date, contact, invoice #, method, gross, fee, net
- `expenses` — date, vendor, category, amount, deductible, method, reference
- `pl` — month, collected, expenses, net
- `1099` — contractors paid ≥ $600 in the year (grouped by
  `contractor_contact_id`), with name/address/total — flags anyone missing a W-9.

### 3.2 1099 tracking
Any expense with `contractor_contact_id` set counts toward that contact's yearly
total. Accounting page surfaces "Contractors at/over $600 — 1099 required".
Add `tax_id_on_file boolean` to `clearear_contacts` so the gap is visible.

---

## Phase 4 — Stripe (card payments)

### 4.1 What Blue must do (I cannot)
1. Create/log into Stripe, activate the account (bank + business details).
2. Get **Secret key** (`sk_live_…`) and **Publishable key** (`pk_live_…`).
3. After the endpoint deploys, add webhook → `https://blvstack.com/api/webhooks/stripe`,
   events: `checkout.session.completed`, `charge.refunded`,
   `charge.dispute.created`. Copy the **signing secret** (`whsec_…`).
4. Put keys in a file (like the Vercel token) — never paste live keys in chat.

Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_STRIPE_PUBLISHABLE_KEY`.

### 4.2 Pay flow
- Client opens `/invoice/[token]` → **Pay this invoice** button (shown only when
  `balance > 0` and status not void/paid).
- `POST /api/invoice/[token]/checkout` creates a **Stripe Checkout Session**:
  amount = current balance, currency USD, `metadata: { invoice_id, contact_id }`,
  `client_reference_id = invoice_id`, success/cancel back to the invoice page.
  Amount is read server-side from the invoice — **never** from the client.
- Redirect to Stripe-hosted checkout (no card data ever touches BLVSTACK — keeps
  PCI scope minimal; do not build a custom card form).

### 4.3 Webhook — `/api/webhooks/stripe`
- **Verify the Stripe signature** against `STRIPE_WEBHOOK_SECRET` before trusting
  anything. Unsigned/failed → 400, log, do nothing.
- On `checkout.session.completed` (and `payment_intent.succeeded` for safety):
  record a payment via the existing `recordPayment` with
  `method: 'stripe'`, `reference: <payment_intent_id>`, and an idempotency key of
  `stripe:{payment_intent_id}` so Stripe's at-least-once retries cannot
  double-post. Invoice status/balance recompute as they already do.
- **Fees:** retrieve the balance transaction → store `fee_amount` and `net_amount`
  on the payment (new nullable columns). Gross funds the invoice; **fee posts as a
  `fees` expense** so P&L is honest. This is item 10 — gross ≠ net.
- On `charge.refunded` → void/negate the payment, recompute.
- On `charge.dispute.created` → flag the invoice + surface it in the briefing.

### 4.4 Schema additions
```sql
alter table clearear_payments
  add column stripe_payment_intent_id text unique,
  add column fee_amount numeric(12,2),
  add column net_amount numeric(12,2);
```

### 4.5 Reconciliation guard
A Stripe payment is only ever created by the **webhook** (never optimistically by
the browser return URL) — the success page just says "processing" and the row
appears when Stripe confirms. No model belief, no client claim, is load-bearing.

---

## Phase 5 — JANET tools (Ring 2, contract-compliant)

| Tool | Ring | Idempotent on | Reversal |
|---|---|---|---|
| `log_clearear_expense` | 2 | vendor+amount+date+category | `hard_delete_guarded` |
| `get_clearear_expenses` | 1 | — | — |
| `set_clearear_recurring_expense` | 2 | vendor+category+day | `soft_delete` (active=false) |
| `get_clearear_pl` | 1 | — | — |

`log_clearear_expense`: amount and category are FACTS — never guessed; if unstated,
ask (same rule that now governs payment method). Category is a strict enum.

---

## Build order

1. **Phase 1** — expenses schema + admin page + recurring cron *(unblocks daily use)*
2. **Phase 2** — P&L on the Accounting page *(the number he actually wants)*
3. **Phase 4** — Stripe *(needs Blue's keys; can run parallel to 3)*
4. **Phase 3** — exports + 1099 *(only matters at tax time)*
5. **Phase 5** — JANET tools *(convenience once the surfaces exist)*

## Verification (per phase)
- `npx astro build` must pass; `node scripts/check-tool-contract.mjs` must pass.
- Cross-check every figure against a direct DB query before declaring it correct —
  the last three revenue bugs were all "summed the wrong table" (sessions instead
  of invoices/payments). Recompute expected totals independently, then compare.
- Stripe: test in **test mode** with card `4242 4242 4242 4242`, confirm exactly ONE
  payment row per checkout, correct fee/net split, and correct invoice balance.
