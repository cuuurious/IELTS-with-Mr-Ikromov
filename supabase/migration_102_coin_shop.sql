-- migration_102_coin_shop.sql  (2026-11-05)
-- REWARDS SHOP: students swap their coins for real things — books,
-- notebooks, a free mock, anything with a photo.
--   * shop_items: what is on offer (photo, price in coins, optional stock,
--     optional groups; no groups = every student).
--   * shop_orders: a student's order. Coins are taken at once and held;
--     the teacher presses "Handed over" when the item is given, or
--     "Decline" (coins come back). A student can cancel while it waits.
--   * shop bucket: the item photos (public to read, teachers upload).
-- Coins only move through the functions below (coin_add from migration 86).
-- Safe to run twice. Needs migration 86 first.

-- 1. Items ------------------------------------------------------------
create table if not exists public.shop_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  image_url text,
  price integer not null check (price > 0 and price <= 100000),
  stock integer check (stock is null or stock >= 0),
  group_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.shop_items enable row level security;
drop policy if exists shop_items_read on public.shop_items;
create policy shop_items_read on public.shop_items
  for select to authenticated
  using (
    (select public.is_teacher())
    or (is_active and (cardinality(group_ids) = 0 or exists (select 1 from unnest(group_ids) g where public.is_group_member(g))))
  );
drop policy if exists shop_items_teacher on public.shop_items;
create policy shop_items_teacher on public.shop_items
  for all using ((select public.is_teacher())) with check ((select public.is_teacher()));

-- 2. Orders -----------------------------------------------------------
create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.shop_items(id) on delete set null,
  item_title text not null,
  item_image text,
  price integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'given', 'declined', 'cancelled')),
  note text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists shop_orders_user_idx on public.shop_orders (user_id, created_at desc);
create index if not exists shop_orders_status_idx on public.shop_orders (status, created_at);

alter table public.shop_orders enable row level security;
drop policy if exists shop_orders_read on public.shop_orders;
create policy shop_orders_read on public.shop_orders
  for select using (user_id = (select auth.uid()) or (select public.is_teacher()));
-- No insert/update/delete policies: orders move only through the functions.

-- 3. Order, cancel, decide ---------------------------------------------
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
  return public.coin_balance_of(v_uid);
end;
$function$;

-- Coins back and the item back in stock (cancel / decline).
create or replace function public.shop_give_back(p_order public.shop_orders, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.coin_add(p_order.user_id, p_order.price, p_reason, 'shop_refund', p_order.id::text);
  update public.shop_items set stock = stock + 1 where id = p_order.item_id and stock is not null;
end;
$function$;
revoke all on function public.shop_give_back(public.shop_orders, text) from public, anon, authenticated;

create or replace function public.shop_cancel(p_order uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_o public.shop_orders%rowtype;
begin
  select * into v_o from public.shop_orders where id = p_order and user_id = auth.uid() for update;
  if v_o.id is null then
    raise exception 'Order not found.';
  end if;
  if v_o.status <> 'waiting' then
    raise exception 'This order is already %.', v_o.status;
  end if;
  update public.shop_orders set status = 'cancelled', decided_at = now() where id = v_o.id;
  perform public.shop_give_back(v_o, 'Shop order cancelled — coins back: ' || v_o.item_title);
  return public.coin_balance_of(auth.uid());
end;
$function$;

create or replace function public.shop_decide(p_order uuid, p_status text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_o public.shop_orders%rowtype;
begin
  if not public.is_teacher() then
    raise exception 'Teachers only.';
  end if;
  if p_status not in ('given', 'declined') then
    raise exception 'Bad status.';
  end if;
  select * into v_o from public.shop_orders where id = p_order for update;
  if v_o.id is null then
    raise exception 'Order not found.';
  end if;
  if v_o.status <> 'waiting' then
    raise exception 'This order is already %.', v_o.status;
  end if;
  update public.shop_orders
     set status = p_status, note = coalesce(p_note, ''), decided_at = now()
   where id = v_o.id;
  if p_status = 'declined' then
    perform public.shop_give_back(v_o, 'Shop order declined — coins back: ' || v_o.item_title);
  end if;
end;
$function$;

revoke all on function public.shop_order(uuid) from public, anon;
revoke all on function public.shop_cancel(uuid) from public, anon;
revoke all on function public.shop_decide(uuid, text, text) from public, anon;
grant execute on function public.shop_order(uuid) to authenticated;
grant execute on function public.shop_cancel(uuid) to authenticated;
grant execute on function public.shop_decide(uuid, text, text) to authenticated;

grant select on public.shop_items, public.shop_orders to authenticated;
grant insert, update, delete on public.shop_items to authenticated;

-- 4. Photos -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('shop', 'shop', true)
on conflict (id) do update set public = true;

drop policy if exists shop_photos_teacher on storage.objects;
create policy shop_photos_teacher
on storage.objects
for all
using ( bucket_id = 'shop' and public.is_teacher() )
with check ( bucket_id = 'shop' and public.is_teacher() );

notify pgrst, 'reload schema';
