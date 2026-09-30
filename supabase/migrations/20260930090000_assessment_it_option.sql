-- The assessment covers IT & infrastructure (the 5th service): a visitor can say they
-- need "IT or infrastructure for my business" (need 'it'), and IT answers get their own
-- approaches — 'it_managed' (tech only) and 'web_it' (site + tech). Widens the two
-- checks; every existing row already satisfies them.

begin;

alter table public.project_assessments drop constraint if exists project_assessments_need_check;
alter table public.project_assessments add constraint project_assessments_need_check
  check (need in ('new', 'refresh', 'ai', 'it', 'unsure'));

alter table public.project_assessments drop constraint if exists project_assessments_approach_check;
alter table public.project_assessments add constraint project_assessments_approach_check
  check (approach in ('focused', 'capture_booking', 'managed', 'ai_automation', 'it_managed', 'web_it'));

commit;

notify pgrst, 'reload schema';
