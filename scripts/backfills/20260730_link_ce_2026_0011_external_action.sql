-- One-off backfill. CE-2026-0011 was flipped to 'sent' by hand and its external
-- action (cd47a98b — Blue's manual send, recorded before mark_sent existed) was
-- orphaned from the invoice. Link it so the query "which sends did the system
-- observe vs which did Blue report" resolves this historical row too.
update janet_external_actions
set invoice_id = (select id from clearear_invoices where invoice_number = 'CE-2026-0011')
where id = 'cd47a98b-c635-4cec-be14-8d63332cb80d' and invoice_id is null;
