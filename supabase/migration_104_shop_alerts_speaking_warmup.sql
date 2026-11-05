-- migration_104_shop_alerts_speaking_warmup.sql  (2026-11-05)
--   1. Shop orders tell the teachers: a notification (the bell, and
--      Telegram for teachers who linked it) for every new order.
--   2. Daily speaking warm-up: 3 Part 1 questions a day from the speaking
--      sets. coin_settings.speaking_warmup turns it on/off for students;
--      finishing it pays warmup_coins once a day.
-- Safe to run twice. Needs migrations 101 and 102 first.

-- 1. Shop order alert ------------------------------------------------------
create or replace function public.shop_order(p_item uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_item public.shop_items%rowtype;
  v_order uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;
  perform pg_advisory_xact_lock(hashtext('coins:' || v_uid::text));
  select * into v_item from public.shop_items where id = p_item for update;
  if v_item.id is null or not v_item.is_active then
    raise exception 'This reward is not available any more.';
  end if;
  if cardinality(v_item.group_ids) > 0 and not exists (select 1 from unnest(v_item.group_ids) g where public.is_group_member(g)) then
    raise exception 'This reward is not for your group.';
  end if;
  if v_item.stock is not null and v_item.stock <= 0 then
    raise exception 'Sold out.';
  end if;
  if public.coin_balance_of(v_uid) < v_item.price then
    raise exception 'You need % coins for this.', v_item.price using errcode = 'P0001';
  end if;

  insert into public.shop_orders (item_id, item_title, item_image, price, user_id)
  values (v_item.id, v_item.title, v_item.image_url, v_item.price, v_uid)
  returning id into v_order;
  perform public.coin_add(v_uid, -v_item.price, 'Shop: ' || v_item.title, 'shop', v_order::text);
  if v_item.stock is not null then
    update public.shop_items set stock = stock - 1 where id = v_item.id;
  end if;

  -- Tell the teachers (the bell, and Telegram for those who linked it).
  select coalesce(full_name, 'A student') into v_name from public.profiles where id = v_uid;
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'shop_order', 'New shop order', v_name || ' wants “' || v_item.title || '” (' || v_item.price || ' coins). Hand it over, then press “Handed over” in Coins & Rewards.', null
    from public.profiles p
   where p.role = 'teacher';

  return public.coin_balance_of(v_uid);
end;
$function$;


revoke all on function public.shop_order(uuid) from public, anon;
grant execute on function public.shop_order(uuid) to authenticated;

-- 2. Speaking warm-up --------------------------------------------------------
alter table public.coin_settings add column if not exists speaking_warmup boolean not null default true;
alter table public.coin_settings add column if not exists warmup_coins integer not null default 1;

create or replace function public.claim_warmup_coins()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  s public.coin_settings%rowtype;
  v_day text := to_char(now() at time zone 'Asia/Tashkent', 'YYYY-MM-DD');
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;
  select * into s from public.coin_settings where id = 1;
  if not coalesce(s.speaking_warmup, false) or coalesce(s.warmup_coins, 0) <= 0 then
    return public.coin_balance_of(v_uid);
  end if;
  perform public.coin_add(v_uid, s.warmup_coins, 'Speaking warm-up · ' || v_day, 'warmup', v_day);
  return public.coin_balance_of(v_uid);
end;
$function$;

revoke all on function public.claim_warmup_coins() from public, anon;
grant execute on function public.claim_warmup_coins() to authenticated;

notify pgrst, 'reload schema';
