-- migration_95_score_coins.sql (2026-11-05)
--
-- Coins for the score inside an in-site homework task (a teacher asked:
-- "give coins by the points inside"). Only the FIRST try of each task
-- counts, so retakes can't farm coins. Tiers are set by the teacher in
-- Coins & Courses → Prices:
--   90% or more  → score_coins_top  (default 5)
--   70% or more  → score_coins_good (default 3)
--   50% or more  → score_coins_ok   (default 1)
-- Each task pays once per student (coin_ledger unique ref 'task_score').
-- Safe to run more than once.

alter table public.coin_settings add column if not exists score_coins_top integer not null default 5;
alter table public.coin_settings add column if not exists score_coins_good integer not null default 3;
alter table public.coin_settings add column if not exists score_coins_ok integer not null default 1;

create or replace function public.coins_for_task_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  s public.coin_settings%rowtype;
  v_pct numeric;
  v_amount integer;
  v_title text;
begin
  if new.submitted_at is null or old.submitted_at is not null then
    return new;
  end if;
  if new.attempt_no <> 1 or new.score is null or coalesce(new.max_score, 0) <= 0 then
    return new;
  end if;

  select * into s from public.coin_settings where id = 1;
  v_pct := 100.0 * new.score / new.max_score;
  v_amount := case
    when v_pct >= 90 then coalesce(s.score_coins_top, 0)
    when v_pct >= 70 then coalesce(s.score_coins_good, 0)
    when v_pct >= 50 then coalesce(s.score_coins_ok, 0)
    else 0
  end;
  if v_amount <= 0 then
    return new;
  end if;

  select coalesce(nullif(t.title, ''), 'homework task') into v_title
    from public.homework_tasks t where t.id = new.task_id;

  perform public.coin_add(
    new.user_id,
    v_amount,
    'Score ' || new.score || '/' || new.max_score || ' · ' || coalesce(v_title, 'homework task'),
    'task_score',
    new.task_id::text
  );
  return new;
end;
$function$;

revoke all on function public.coins_for_task_score() from public, anon, authenticated;

drop trigger if exists trg_coins_for_task_score on public.homework_attempts;
create trigger trg_coins_for_task_score
  after update of submitted_at on public.homework_attempts
  for each row execute function public.coins_for_task_score();
