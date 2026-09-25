-- ============================================================
-- Migration 35 — run this once in Supabase SQL Editor, after 29-34
--
-- Adds examiner scoring to the speaking exam timetable
-- (mock_speaking_slots, migration_29) so a speaking examiner can leave
-- a band + feedback on a completed slot, the same way a writing
-- examiner already does on writing_mock_attempts (migration_34).
--
-- No new tables, no new RLS policies needed: mock_speaking_slots
-- already has "examiner_id = auth.uid() or is_teacher()" on its UPDATE
-- policy (migration_29's speaking_slots_update) and "student_id =
-- auth.uid() or examiner_id = auth.uid() or is_teacher()" on its
-- SELECT policy (speaking_slots_select) — both already cover these new
-- columns, same trust model as every other table in this project
-- (no column-level RLS anywhere else either).
-- ============================================================

alter table public.mock_speaking_slots
  add column if not exists examiner_band numeric,
  add column if not exists examiner_feedback text,
  add column if not exists examiner_reviewed_at timestamptz;

-- In-app notification the moment an examiner leaves a band/feedback —
-- same pattern as notify_writing_mock_review() (migration_34).
create or replace function public.notify_speaking_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.examiner_reviewed_at is not null
     and old.examiner_reviewed_at is distinct from new.examiner_reviewed_at then
    insert into public.notifications(user_id, type, title, body, link)
    values (
      new.student_id,
      'speaking_reviewed',
      'Your speaking exam has been marked',
      case when new.examiner_band is not null
        then format('Band %s — feedback is ready to read.', new.examiner_band)
        else 'Feedback is ready to read.'
      end,
      '/app'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_speaking_review on public.mock_speaking_slots;
create trigger trg_notify_speaking_review
after update on public.mock_speaking_slots
for each row execute function public.notify_speaking_review();

notify pgrst, 'reload schema';
