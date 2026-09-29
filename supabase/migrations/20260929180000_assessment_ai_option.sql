-- The assessment covers AI & automation again (it's the 4th service): a visitor can
-- say they need "AI or automation for my business" (need 'ai'), and those answers get
-- their own recommended approach ('ai_automation'). Widens the two checks; every
-- existing row already satisfies them.

begin;

alter table public.project_assessments drop constraint if exists project_assessments_need_check;
alter table public.project_assessments add constraint project_assessments_need_check
  check (need in ('new', 'refresh', 'ai', 'unsure'));

alter table public.project_assessments drop constraint if exists project_assessments_approach_check;
alter table public.project_assessments add constraint project_assessments_approach_check
  check (approach in ('focused', 'capture_booking', 'managed', 'ai_automation'));

commit;

notify pgrst, 'reload schema';
