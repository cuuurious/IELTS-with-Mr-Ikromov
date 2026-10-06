-- migration_73_parent_report.sql
-- Parent report: count homework as done when the student handed it in
-- at any point (homework_completions), not only when the current
-- submissions row is 'done'. A teacher reset sets the submission back
-- to 'pending' but keeps the completion record, which made finished
-- homework show as 0% done.
-- Also: homework set shortly before a student joined the group is
-- included when the student actually worked on it.

create or replace function public.get_parent_report(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_student uuid;
  v_result jsonb;
begin
  select student_id into v_student from public.parent_report_links where token = p_token and enabled;
  if v_student is null then
    return null;
  end if;

  select jsonb_build_object(
    'student', (select jsonb_build_object('full_name', p.full_name, 'target_band', p.target_band, 'avatar_url', p.avatar_url)
                  from public.profiles p where p.id = v_student),
    'groups', coalesce((select jsonb_agg(g.name order by g.name)
                  from public.group_members gm join public.groups g on g.id = gm.group_id
                 where gm.student_id = v_student), '[]'::jsonb),
    'homework', (
      with base as (
        select h.id, h.title, h.due_date, h.created_at, gm.created_at as joined_at,
               s.status, s.submitted_at,
               (select min(c.completed_at) from public.homework_completions c
                 where c.homework_id = h.id and c.student_id = v_student) as completed_at
          from public.homeworks h
          join public.group_members gm on gm.group_id = h.group_id and gm.student_id = v_student
          left join public.submissions s on s.homework_id = h.id and s.student_id = v_student
         where h.created_at > now() - interval '60 days'
      ),
      hw as (
        select id, title, due_date, created_at,
               (status = 'done' or completed_at is not null) as is_done,
               coalesce(case when status = 'done' then submitted_at end, completed_at, submitted_at) as done_at
          from base
         where created_at >= joined_at - interval '1 day'
            or status = 'done' or submitted_at is not null or completed_at is not null
      )
      select jsonb_build_object(
        'assigned', count(*),
        'done', count(*) filter (where is_done),
        'late', count(*) filter (where is_done and due_date is not null and done_at > due_date),
        'missed', count(*) filter (where not is_done and due_date is not null and due_date < now()),
        'recent', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
            select jsonb_build_object('title', title, 'created_at', created_at, 'due_date', due_date,
                     'state', case when is_done and due_date is not null and done_at > due_date then 'late'
                                   when is_done then 'done'
                                   when due_date is not null and due_date < now() then 'missed'
                                   else 'open' end) as x
              from hw order by created_at desc limit 12) t), '[]'::jsonb)
      ) from hw
    ),
    'words', jsonb_build_object(
        'quizzes_30d', (select count(*) from public.wordlist_attempts where student_id = v_student and created_at > now() - interval '30 days'),
        'avg_score_30d', (select round(avg(percentage)) from public.wordlist_attempts where student_id = v_student and created_at > now() - interval '30 days'),
        'words_learned', (select count(*) from public.word_progress where student_id = v_student and box >= 3),
        'words_practised', (select count(*) from public.word_progress where student_id = v_student),
        'reviews_30d', (select count(*) from public.word_review_sessions where student_id = v_student and created_at > now() - interval '30 days')
    ),
    'mocks', jsonb_build_object(
        'listening', (select a.band from public.mock_attempts a join public.mock_exams e on e.id = a.exam_id
                       where a.user_id = v_student and e.module = 'listening' and a.released_at is not null and a.band is not null
                       order by a.submitted_at desc limit 1),
        'reading', (select a.band from public.mock_attempts a join public.mock_exams e on e.id = a.exam_id
                     where a.user_id = v_student and e.module = 'reading' and a.released_at is not null and a.band is not null
                     order by a.submitted_at desc limit 1),
        'writing', (select w.examiner_band from public.writing_mock_attempts w
                     where w.student_id = v_student and w.released_at is not null and w.examiner_band is not null
                     order by w.submitted_at desc limit 1),
        'speaking', (select s.examiner_band from public.mock_speaking_slots s
                      where s.student_id = v_student and s.released_at is not null and s.examiner_band is not null
                      order by s.scheduled_at desc limit 1)
    ),
    'generated_at', now()
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_parent_report(uuid) from public;
grant execute on function public.get_parent_report(uuid) to anon, authenticated;
