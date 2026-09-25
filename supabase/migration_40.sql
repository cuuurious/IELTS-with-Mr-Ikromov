-- ============================================================
-- Migration 40 — run this once in Supabase SQL Editor, after 29-39
--
-- Two small "next level" additions Jasur picked 2026-09-25:
--   1. A place for a speaking examiner to paste the cloud-recording
--      link after a session ("Speaking recording reference" from the
--      original suggestions list).
--   2. (No schema needed for the .ics calendar download — that's
--      generated entirely client-side from data already in
--      mock_speaking_slots. Included in this migration's header only
--      so both "next level" picks from the same round are documented
--      together.)
--
-- No new RLS needed for the new column: mock_speaking_slots' existing
-- UPDATE policy (examiner_id = auth.uid() or is_teacher()) already
-- covers it, same column-level trust model as every other table here.
-- ============================================================

alter table public.mock_speaking_slots
  add column if not exists recording_url text;

notify pgrst, 'reload schema';
