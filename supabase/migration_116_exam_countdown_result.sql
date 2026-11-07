-- migration_116_exam_countdown_result.sql (2026-11-07)
-- Exam countdown on every student page:
--   * after the exam the student enters the real overall band
--     (profiles.exam_result, kept with the exam date it belongs to);
--   * the parent report shows the exam date and the real result.
-- The exam date itself is from migration_108 (set_my_exam_date).
-- Safe to run more than once.

set lock_timeout = '8s';

alter table public.profiles add column if not exists exam_result numeric(2,1);
alter table public.profiles add column if not exists exam_result_for date;

-- 1. The student enters the real result (only once the exam date has passed).
create or replace function public.set_my_exam_result(p_band numeric)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_date date;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;
  select exam_date into v_date from public.profiles where id = auth.uid();
  if v_date is null or v_date > current_date then
    raise exception 'You can add the result after your exam.';
  end if;
  if p_band is not null and (p_band < 1 or p_band > 9 or p_band * 2 <> round(p_band * 2)) then
    raise exception 'Pick a band from 1.0 to 9.0.';
  end if;
  update public.profiles
     set exam_result = p_band,
         exam_result_for = case when p_band is null then null else v_date end
   where id = auth.uid();
end;
$function$;
revoke all on function public.set_my_exam_result(numeric) from public, anon;
grant execute on function public.set_my_exam_result(numeric) to authenticated;

-- 2. Parent report: add exam date + real result to the student block.
do $do$
declare
  d text := pg_get_functiondef('public.get_parent_report(uuid)'::regprocedure);
begin
  if position('exam_date' in d) = 0 then
    d := replace(d, '''target_band'', p.target_band,',
                    '''target_band'', p.target_band, ''exam_date'', p.exam_date, ''exam_result'', p.exam_result, ''exam_result_for'', p.exam_result_for,');
    if position('exam_date' in d) = 0 then
      raise exception 'get_parent_report looks different than expected — nothing changed.';
    end if;
    execute d;
  end if;
end;
$do$;

notify pgrst, 'reload schema';

-- Check: expect true | true
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'exam_result') as has_result_column,
  position('exam_date' in pg_get_functiondef('public.get_parent_report(uuid)'::regprocedure)) > 0 as parent_report_has_exam;
