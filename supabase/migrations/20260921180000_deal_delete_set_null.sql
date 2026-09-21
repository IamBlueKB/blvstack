-- Deleting a janet_deals row failed whenever the deal had a doc or an outcome:
-- those two FKs were ON DELETE NO ACTION, so Postgres blocked the delete (the API
-- 500'd and the UI silently reloaded). Every existing deal had a doc, so NO deal
-- was deletable. The other 2 deal FKs (notepad_sessions, sent_emails) were already
-- SET NULL. Bring these two in line: keep the doc/outcome row, unlink it.
--
-- SET NULL rather than CASCADE on janet_outcomes by decision: an outcome row is
-- scorecard history and must never be silently destroyed by a deal delete.
-- Same fix shape as 20260826170000_client_delete_set_null.sql.

alter table janet_docs drop constraint janet_docs_deal_id_fkey;
alter table janet_docs add constraint janet_docs_deal_id_fkey
  foreign key (deal_id) references janet_deals(id) on delete set null;

alter table janet_outcomes drop constraint janet_outcomes_deal_id_fkey;
alter table janet_outcomes add constraint janet_outcomes_deal_id_fkey
  foreign key (deal_id) references janet_deals(id) on delete set null;

notify pgrst, 'reload schema';
