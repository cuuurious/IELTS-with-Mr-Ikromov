-- ============================================================
-- Migration 49 — run this once in Supabase SQL Editor, after 29-48
--
-- Jasur, 2026-09-26 (verbatim gist, from the Student Profile modal
-- screenshot with the empty Reading/Listening/Writing/Speaking boxes):
-- those band boxes should be clickable and show real detail behind
-- them. For Writing that means the examiner's full report — the four
-- IELTS criteria marks, not just one overall band — plus the essay
-- itself (already stored, already viewable — see StudentProfileModal's
-- existing "View essay" toggle). For Speaking, the same: the four
-- criteria marks and the examiner's feedback. Today writing_mock_
-- attempts and mock_speaking_slots only ever store ONE overall
-- examiner_band — there's no space for an examiner to record the
-- breakdown at all. This migration adds that space.
--
-- Decision locked with Jasur the same day (AskUserQuestion): the
-- overall band is auto-calculated from the four criteria (the same
-- roundOverallBand() already in src/lib/ieltsBands.js, official IELTS
-- .25-up/.75-up rounding), not typed in separately — one less field,
-- and it can never disagree with the breakdown. The app keeps writing
-- to the existing `examiner_band` column with that computed value, so
-- every place that already reads examiner_band (score report, release
-- gate, Student Progress) needs zero changes.
--
-- Nullable, additive columns only. An attempt/slot marked before this
-- migration keeps its old examiner_band with all four criteria columns
-- null — the app treats that as "no breakdown recorded for this one",
-- not an error. No RLS changes needed: writing_mock_attempts already
-- lets a writing examiner and a teacher UPDATE any column on their
-- rows (migration_34's "no column-level enforcement anywhere else in
-- this project either"), and mock_speaking_slots already does the same
-- for a speaking examiner/teacher (migration_29/35) — this project has
-- never done column-level RLS, and these four new columns per table
-- don't change that.
-- ============================================================

-- ---------- Writing: Task Achievement/Response, Coherence & Cohesion,
-- Lexical Resource, Grammatical Range & Accuracy. One set per whole
-- attempt (not split per task) — matches how this app already treats
-- examiner_band as one holistic number for the whole mock, Task 1 and
-- Task 2 combined, rather than the official two-task weighted
-- calculation a real examiner uses on paper.
alter table public.writing_mock_attempts
  add column if not exists ta_band numeric,
  add column if not exists cc_band numeric,
  add column if not exists lr_band numeric,
  add column if not exists gra_band numeric;

-- ---------- Speaking: Fluency & Coherence, Lexical Resource,
-- Grammatical Range & Accuracy, Pronunciation.
alter table public.mock_speaking_slots
  add column if not exists fc_band numeric,
  add column if not exists lr_band numeric,
  add column if not exists gra_band numeric,
  add column if not exists pron_band numeric;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEP — after running this migration: none. Every
-- already-marked writing/speaking result just keeps its existing
-- overall band with an empty breakdown — nothing to backfill, nothing
-- to reconcile. The next time an examiner opens one of those to edit
-- it and fills in all four criteria, the overall band gets recomputed
-- from them and the breakdown appears everywhere it's shown.
-- ---------------------------------------------------------------------
