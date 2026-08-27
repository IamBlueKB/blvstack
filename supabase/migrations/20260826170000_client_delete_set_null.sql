-- Deleting a janet_clients row failed whenever the client had any thread, doc, or
-- form response: those three FKs were ON DELETE NO ACTION, so Postgres blocked the
-- delete (the API 500'd and the UI silently did nothing). The other 5 client FKs
-- already SET NULL ("keep the row, unlink"). Bring these three in line so a client
-- can be deleted and its threads/docs/responses are kept but unlinked.

alter table janet_threads drop constraint janet_threads_client_id_fkey;
alter table janet_threads add constraint janet_threads_client_id_fkey
  foreign key (client_id) references janet_clients(id) on delete set null;

alter table janet_docs drop constraint janet_docs_client_id_fkey;
alter table janet_docs add constraint janet_docs_client_id_fkey
  foreign key (client_id) references janet_clients(id) on delete set null;

alter table janet_form_responses drop constraint janet_form_responses_client_id_fkey;
alter table janet_form_responses add constraint janet_form_responses_client_id_fkey
  foreign key (client_id) references janet_clients(id) on delete set null;

notify pgrst, 'reload schema';
