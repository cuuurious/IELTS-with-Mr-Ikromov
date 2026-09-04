-- Migration 19 — Writing Mock Test homework type
--
-- Adds a new homework type where the teacher can set up a timed IELTS
-- Writing mock (Task 1 only, Task 2 only, or a Full test covering
-- both under one continuous timer). Students type their essay
-- directly inside a full-screen timed window instead of uploading
-- files — pasting disabled, live word count, auto-save, and
-- auto-submit when time runs out.
--
-- Only additive — safe to run more than once.

-- Every homework defaults to 'standard' (the existing file/picture
-- upload flow) so nothing about existing homework changes.
alter table homeworks
  add column if not exists homework_type text not null default 'standard';

-- 'task1' | 'task2' | 'full' — which part(s) of the test this
-- homework covers. Null for standard homework.
alter table homeworks
  add column if not exists mock_task_mode text;

-- How many minutes the student gets, counted continuously from the
-- moment they start (see submissions.mock_essay.started_at below).
alter table homeworks
  add column if not exists mock_time_limit_minutes integer;

alter table homeworks
  add column if not exists mock_task1_prompt text;

-- The chart/graph/table/diagram for Task 1, shown to the student
-- inline in the writing window (no separate tab needed) and passed to
-- the AI grader as image context.
alter table homeworks
  add column if not exists mock_task1_image_url text;

alter table homeworks
  add column if not exists mock_task2_prompt text;

-- Everything about one student's mock attempt lives in this single
-- JSON column on their existing submissions row, rather than a dozen
-- new typed columns — it's all read/written together as one unit by
-- the student-side timer/autosave and the teacher-side review panel:
--   {
--     task_mode: 'task1' | 'task2' | 'full',
--     time_limit_minutes: number,
--     started_at: ISO timestamp,
--     submitted_at: ISO timestamp | null,
--     auto_submitted: boolean,
--     tab_switch_count: number,
--     fullscreen_exit_count: number,
--     task1_text: string,
--     task2_text: string,
--   }
-- started_at is what the countdown timer, auto-submit, and "resume
-- after reload" logic are all anchored to — it is set once, the first
-- time the student confirms they're ready to start, and never reset.
alter table submissions
  add column if not exists mock_essay jsonb;

-- PostgREST (what Supabase's client library talks to) caches the
-- table schema and only notices new columns after being told to
-- reload it.
notify pgrst, 'reload schema';
