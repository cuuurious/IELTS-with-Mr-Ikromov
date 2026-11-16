-- migration_130: explanations (English / Uzbek / Russian) for Reading questions
-- and transcripts for Listening parts, shown to students only in their
-- released results review.
--
-- They live in their OWN tables with no student policy, so a student can never
-- read them during an exam (the explanation says which answer is right).
-- The only way a student reaches them is get_mock_answer_breakdown(), which
-- already refuses anyone whose attempt has not been released.
-- Run once in the Supabase SQL editor.

create table if not exists public.mock_question_explanations (
  question_id uuid primary key references public.mock_questions(id) on delete cascade,
  explanation_en text,
  explanation_uz text,
  explanation_ru text
);

create table if not exists public.mock_section_transcripts (
  section_id uuid primary key references public.mock_sections(id) on delete cascade,
  transcript jsonb not null
);

alter table public.mock_question_explanations enable row level security;
alter table public.mock_section_transcripts enable row level security;

drop policy if exists mock_question_explanations_teacher on public.mock_question_explanations;
create policy mock_question_explanations_teacher on public.mock_question_explanations
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists mock_section_transcripts_teacher on public.mock_section_transcripts;
create policy mock_section_transcripts_teacher on public.mock_section_transcripts
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- Same breakdown as before plus the four new columns (added at the end, so
-- the teacher screens that already use it keep working).
drop function if exists public.get_mock_answer_breakdown(uuid);

create function public.get_mock_answer_breakdown(p_attempt_id uuid)
returns table(
  question_id uuid,
  section_title text,
  section_order integer,
  question_order integer,
  prompt text,
  question_type text,
  correct_answer text,
  student_answer text,
  is_correct boolean,
  accepted_answers text[],
  explanation_en text,
  explanation_uz text,
  explanation_ru text,
  section_transcript jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_released timestamptz;
begin
  select user_id, released_at into v_owner, v_released from public.mock_attempts where id = p_attempt_id;
  if v_owner is null then
    raise exception 'Attempt not found';
  end if;
  if not (public.is_teacher() or (v_owner = auth.uid() and v_released is not null)) then
    raise exception 'Not authorized to view this breakdown';
  end if;

  return query
    select q.id, s.title, s.order_index, q.order_index, q.prompt, q.type, q.correct_answer,
           a.student_answer, a.is_correct, q.accepted_answers,
           e.explanation_en, e.explanation_uz, e.explanation_ru,
           -- the transcript rides on the first question of each part only
           case when q.order_index = min(q.order_index) over (partition by s.id) then t.transcript else null end
      from public.mock_answers a
      join public.mock_questions q on q.id = a.question_id
      join public.mock_sections s on s.id = q.section_id
      left join public.mock_question_explanations e on e.question_id = q.id
      left join public.mock_section_transcripts t on t.section_id = s.id
     where a.attempt_id = p_attempt_id
     order by s.order_index, q.order_index;
end;
$$;

grant execute on function public.get_mock_answer_breakdown(uuid) to authenticated;
