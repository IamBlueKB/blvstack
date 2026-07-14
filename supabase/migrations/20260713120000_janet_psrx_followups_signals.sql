-- Learning-loop signals on the follow-up schedule: engagement (opened/clicked,
-- stamped from Brevo events via lead_messages) and the manager's action on the
-- drafted follow-up (approved / edited / rejected). Feeds outcome accumulation.

alter table janet_psrx_followups add column if not exists opened boolean default false;
alter table janet_psrx_followups add column if not exists clicked boolean default false;
alter table janet_psrx_followups add column if not exists manager_action text;
