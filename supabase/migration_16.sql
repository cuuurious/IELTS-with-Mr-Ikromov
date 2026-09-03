-- Migration 16 — AI grading: writing & speaking evaluation
--
-- What this adds:
--  1. grading_criteria — one row for 'writing' and one for 'speaking',
--     holding the text pulled out of the PDF rubric you upload from the
--     new "AI Grading" tab. Teacher-only.
--  2. A private storage bucket ("grading-criteria") for the PDF files
--     themselves, so you can always see/re-download what you uploaded.
--  3. homeworks.ai_eval_enabled — a per-homework on/off switch (a
--     checkbox when you post or edit homework) for whether AI grading
--     runs on that assignment at all. Off by default — most homework
--     (vocab sheets, reading tasks, etc.) isn't an essay or a speaking
--     task, so this stays opt-in per assignment rather than running on
--     everything.
--  4. submissions gets four new columns the ai-grading Edge Function
--     writes to: ai_status ('processing' | 'done' | 'error'),
--     ai_result (the band score + feedback, as JSON), ai_evaluated_at,
--     and ai_error (only set when something went wrong, so you can see
--     why in the grading view).
--  5. submissions is added to realtime, so the AI's result appears for
--     both you and the student automatically, without refreshing —
--     matching how chat messages already update live.
--
-- Additive only, safe to run more than once.

-- ---------------------------------------------------------------
-- Grading criteria (your uploaded rubric, as text)
-- ---------------------------------------------------------------

create table if not exists public.grading_criteria (
  skill text primary key check (skill in ('writing', 'speaking')),
  file_name text,
  file_path text,
  criteria_text text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.grading_criteria enable row level security;

drop policy if exists grading_criteria_select_teacher on public.grading_criteria;
create policy grading_criteria_select_teacher
on public.grading_criteria
for select
using ( public.is_teacher() );

drop policy if exists grading_criteria_insert_teacher on public.grading_criteria;
create policy grading_criteria_insert_teacher
on public.grading_criteria
for insert
with check ( public.is_teacher() );

drop policy if exists grading_criteria_update_teacher on public.grading_criteria;
create policy grading_criteria_update_teacher
on public.grading_criteria
for update
using ( public.is_teacher() )
with check ( public.is_teacher() );

-- ---------------------------------------------------------------
-- Storage for the uploaded rubric PDFs — private; teacher only.
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('grading-criteria', 'grading-criteria', false)
on conflict (id) do nothing;

drop policy if exists grading_criteria_storage_all_teacher on storage.objects;
create policy grading_criteria_storage_all_teacher
on storage.objects
for all
using ( bucket_id = 'grading-criteria' and public.is_teacher() )
with check ( bucket_id = 'grading-criteria' and public.is_teacher() );

-- ---------------------------------------------------------------
-- Per-homework AI grading switch
-- ---------------------------------------------------------------

alter table public.homeworks
  add column if not exists ai_eval_enabled boolean not null default false;

-- ---------------------------------------------------------------
-- Where the AI's result lands on a submission
-- ---------------------------------------------------------------

alter table public.submissions
  add column if not exists ai_status text check (ai_status in ('processing', 'done', 'error')),
  add column if not exists ai_result jsonb,
  add column if not exists ai_evaluated_at timestamptz,
  add column if not exists ai_error text;

-- ---------------------------------------------------------------
-- Realtime — so the AI's result shows up live, the same way chat
-- messages already do, instead of needing a page refresh.
-- ---------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'submissions'
  ) then
    alter publication supabase_realtime add table submissions;
  end if;
end $$;
