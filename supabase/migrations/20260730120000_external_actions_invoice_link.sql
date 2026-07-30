-- Link a janet_external_actions row to a Clear Ear invoice, and support
-- retract-don't-overwrite reversal. Backs the mark_sent capability: when Blue
-- sends an invoice himself (Gmail/text/in person), the invoice flips to 'sent'
-- but the provenance lives on the external-action row (system_verified=false),
-- linked by invoice_id so a reported-sent invoice is never indistinguishable
-- from a system-sent one in downstream queries.

alter table janet_external_actions
  add column if not exists invoice_id uuid references clearear_invoices(id),
  add column if not exists note text,
  add column if not exists retracted_at timestamptz,
  add column if not exists retracted_reason text;

-- Query "which sends did the system observe vs which did Blue report" + the
-- idempotent per-invoice lookup both filter on invoice_id.
create index if not exists janet_external_actions_invoice_id_idx
  on janet_external_actions (invoice_id) where invoice_id is not null;

notify pgrst, 'reload schema';
