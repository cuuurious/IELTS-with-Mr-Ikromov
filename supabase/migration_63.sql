-- ============================================================
-- Migration 63 — run this once in Supabase SQL Editor, after 62
--
-- Jasur, 2026-09-29: "i have deleted sitting of mavluda, why there it is
-- not automatically deleted?"
--
-- migration_62's teacher_delete_full_mock_attempt() only removed the
-- section attempts a sitting had LINKED (listening/reading/writing
-- _attempt_id) plus any still-unfinished ones. But an attempt only gets
-- linked when the student presses "Continue" on the "Test submitted"
-- screen — test runs that were closed on that screen, or sat before the
-- linking existed, were left behind as orphan results (the extra 0/40
-- rows in Results).
--
-- This version also removes every attempt this student made on this
-- sitting's own Listening / Reading / Writing exams during the sitting:
-- from the moment it started until the moment their NEXT sitting of the
-- same Full Mock started (or forever, if there's no later one). So it
-- never reaches into a different sitting's results.
-- ============================================================

create or replace function public.teacher_delete_full_mock_attempt(p_full_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full public.full_mock_attempts%rowtype;
  v_set public.full_mock_sets%rowtype;
  v_window_end timestamptz;
  v_rl uuid[];
  v_w uuid[];
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can delete a sitting.';
  end if;

  select * into v_full from public.full_mock_attempts where id = p_full_id;
  if not found then
    return;
  end if;
  select * into v_set from public.full_mock_sets where id = v_full.set_id;

  select min(f.started_at) into v_window_end
    from public.full_mock_attempts f
   where f.student_id = v_full.student_id
     and f.set_id = v_full.set_id
     and f.started_at > v_full.started_at;

  select coalesce(array_agg(a.id), '{}') into v_rl
    from public.mock_attempts a
   where a.user_id = v_full.student_id
     and (
       a.id = v_full.listening_attempt_id
       or a.id = v_full.reading_attempt_id
       or (a.submitted_at is null and a.exam_id in (v_set.listening_exam_id, v_set.reading_exam_id))
       or (
         a.exam_id in (v_set.listening_exam_id, v_set.reading_exam_id)
         and a.started_at >= v_full.started_at
         and (v_window_end is null or a.started_at < v_window_end)
       )
     );

  select coalesce(array_agg(w.id), '{}') into v_w
    from public.writing_mock_attempts w
   where w.student_id = v_full.student_id
     and (
       w.id = v_full.writing_attempt_id
       or (w.submitted_at is null and w.exam_id = v_set.writing_exam_id)
       or (
         w.exam_id = v_set.writing_exam_id
         and w.started_at >= v_full.started_at
         and (v_window_end is null or w.started_at < v_window_end)
       )
     );

  delete from public.full_mock_attempts where id = p_full_id;
  delete from public.mock_answers where attempt_id = any (v_rl);
  delete from public.mock_attempts where id = any (v_rl);
  delete from public.writing_mock_attempts where id = any (v_w);
end;
$$;

grant execute on function public.teacher_delete_full_mock_attempt(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- Sittings you ALREADY deleted before running this can't be re-run —
-- the sitting row is gone, so there's nothing left to tie their leftover
-- results to. Delete those leftovers from Results → Delete (or tick
-- several → Delete selected).
-- ============================================================
