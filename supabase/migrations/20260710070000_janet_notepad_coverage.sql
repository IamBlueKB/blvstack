-- JANET notepad: coverage tracking + question topics (Task 3 addition)
--
-- topic: a short tag per prepped question ("budget", "timeline") used for the
--   in-notes coverage marker "✓ budget — covered".
-- coverage: which prepped questions Blue ticked as covered during a call, so
--   JANET can tell covered-but-no-detail from genuinely-not-discussed.

ALTER TABLE janet_question_bank ADD COLUMN IF NOT EXISTS topic text;
ALTER TABLE janet_notepad_sessions ADD COLUMN IF NOT EXISTS coverage jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill topics for the seeded standard + template questions, keyed by
-- (sort, deal_type). NULL deal_type = standard baseline.
UPDATE janet_question_bank q SET topic = v.topic
FROM (VALUES
  (1,  NULL::text,   'core problem'),
  (2,  NULL,         'current state'),
  (3,  NULL,         'decision-maker'),
  (4,  NULL,         'budget'),
  (5,  NULL,         'timeline'),
  (6,  NULL,         'success criteria'),
  (7,  NULL,         'scope'),
  (8,  NULL,         'existing assets'),
  (9,  NULL,         'past vendors'),
  (10, NULL,         'cost of inaction'),
  (1,  'refresh',    'what feels off'),
  (2,  'refresh',    'must not lose'),
  (3,  'refresh',    'rebrand or not'),
  (1,  'new_build',  'primary job'),
  (2,  'new_build',  'inspiration'),
  (1,  'rescue',     'failure cause'),
  (2,  'rescue',     'salvage vs replace')
) AS v(sort, deal_type, topic)
WHERE q.sort = v.sort AND q.deal_type IS NOT DISTINCT FROM v.deal_type;
