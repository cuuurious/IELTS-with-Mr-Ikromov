-- migration_103_bands_coins_wishlist.sql  (2026-11-05)
--   1. The teacher's own band wins: when Mr Ikromov sets a band on a
--      Writing / Speaking homework (results.teacher), a later AI marking
--      keeps his band.
--   2. Coins for bands: the first try of a Writing / Speaking homework
--      earns coins by its band (7+ top, 6+ good, 5+ ok — the same amounts
--      as scores in Coins & prices). Once per task.
--   3. Shop wishlist: a student stars the reward they are saving for.
-- Safe to run twice. Needs migrations 95, 101 and 102 first.

-- 1. Teacher band stays --------------------------------------------------
create or replace function public.save_speaking_feedback(p_attempt_id uuid, p_band numeric, p_ai jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform set_config('app.homework_grading', 'on', true);
  update public.homework_attempts
     set band = case
                  when nullif(results #>> '{teacher,band}', '') is not null then band
                  else coalesce(p_band, band)
                end,
         results = coalesce(results, '{}'::jsonb) || jsonb_build_object('ai', p_ai)
   where id = p_attempt_id;
  perform set_config('app.homework_grading', 'off', true);
end;
$function$;

revoke all on function public.save_speaking_feedback(uuid, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.save_speaking_feedback(uuid, numeric, jsonb) to service_role;

-- 2. Coins for bands -------------------------------------------------------
create or replace function public.coins_for_task_band()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  s public.coin_settings%rowtype;
  v_amount integer;
  v_title text;
begin
  if new.band is null or new.band is not distinct from old.band then
    return new;
  end if;
  if new.submitted_at is null or new.attempt_no <> 1 or new.score is not null then
    return new;
  end if;

  select * into s from public.coin_settings where id = 1;
  v_amount := case
    when new.band >= 7 then coalesce(s.score_coins_top, 0)
    when new.band >= 6 then coalesce(s.score_coins_good, 0)
    when new.band >= 5 then coalesce(s.score_coins_ok, 0)
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
    'Band ' || to_char(new.band, 'FM9.0') || ' · ' || coalesce(v_title, 'homework task'),
    'task_band',
    new.task_id::text
  );
  return new;
end;
$function$;

revoke all on function public.coins_for_task_band() from public, anon, authenticated;

drop trigger if exists trg_coins_for_task_band on public.homework_attempts;
create trigger trg_coins_for_task_band
  after update of band on public.homework_attempts
  for each row execute function public.coins_for_task_band();

-- 3. Wishlist -------------------------------------------------------------
create table if not exists public.shop_wishes (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  item_id uuid not null references public.shop_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.shop_wishes enable row level security;
drop policy if exists shop_wishes_own on public.shop_wishes;
create policy shop_wishes_own on public.shop_wishes
  for all using (user_id = (select auth.uid()) or (select public.is_teacher()))
  with check (user_id = (select auth.uid()));

grant select, insert, delete on public.shop_wishes to authenticated;

notify pgrst, 'reload schema';
