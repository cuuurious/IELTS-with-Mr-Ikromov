-- ============================================================
-- Migration 60 — run this one RIGHT AWAY in Supabase SQL Editor, after 59
--
-- Real bug, reported live 2026-09-27 via a screenshot: creating a Reading
-- exam with a "Yes/No/Not Given" question failed with
--   "new row for relation 'mock_questions' violates check constraint
--   'mock_questions_type_check'"
--
-- Root cause, confirmed by comparing the ORIGINAL standalone app's
-- schema.sql (the source this table was created from, pre-dating this
-- repo's own migration history) against what TeacherMockCenter.jsx
-- actually offers today:
--
--   -- original schema.sql, 2026-09-18:
--   type text not null check (type in
--     ('multiple_choice', 'true_false_ng', 'short_answer'))
--
-- TeacherMockCenter.jsx grew to 6 question types on 2026-09-25/26
-- (multiple_choice, multi_select, true_false_ng, yes_no_ng, matching,
-- short_answer — see QUESTION_TYPE_LABELS) but nothing ever updated the
-- live database's check constraint to match. multiple_choice/
-- true_false_ng/short_answer have quietly worked the whole time;
-- multi_select, yes_no_ng, and matching have been broken at the database
-- level since the day they were added to the UI — every attempt to save
-- one fails with exactly the error in the screenshot. This is a correctness
-- bug (a stale constraint), unrelated to the RLS/security audit in
-- migrations 56-59 — fixing it doesn't touch permissions at all.
-- ============================================================

alter table public.mock_questions
  drop constraint if exists mock_questions_type_check;

alter table public.mock_questions
  add constraint mock_questions_type_check
  check (type in (
    'multiple_choice',
    'multi_select',
    'true_false_ng',
    'yes_no_ng',
    'matching',
    'short_answer'
  ));

notify pgrst, 'reload schema';

-- ============================================================
-- After running this, please re-try saving the exact Reading exam from
-- the screenshot (the Yes/No/Not Given questions about Mars) — it should
-- save cleanly now. Multi-select and Matching/drag-and-drop questions
-- were very likely hitting this exact same error too, even though you
-- may not have tried saving one yet — worth a quick test of those two
-- types as well while you're in there, since this was silently blocking
-- them just as completely.
-- ============================================================
